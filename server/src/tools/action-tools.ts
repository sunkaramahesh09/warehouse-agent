/**
 * Mutating tools for the exception workflow. Every tool re-validates its own business
 * rules inside the transaction, so a wrong decision upstream (LLM or guard bug) still
 * cannot produce an illegal state change.
 */
import { z } from 'zod';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { defineTool, ToolError } from './framework.js';
import * as repo from './repo.js';
import { one } from '../db/pool.js';
import { isForward, shipmentFacts, transitionAllowed } from '../domain/rules.js';
import type { Order, OrderStatus } from '../domain/types.js';
import { getPolicy } from '../policy/retrieval.js';
import { emit } from '../events/emit.js';

const OrderId = z.string().regex(/^ORD-\d{4}$/);
const ExcId = z.string().regex(/^EXC-\d{4}$/);
const PolicyId = z.string().regex(/^SOP-[A-Z]{3}-\d{3}$/);

export const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;

async function lockOrder(c: pg.PoolClient, orderId: string): Promise<Order> {
  const o = await one<Order>(c, 'SELECT * FROM orders WHERE order_id = $1 FOR UPDATE', [orderId]);
  if (!o) throw new ToolError('NOT_FOUND', `Order ${orderId} does not exist`);
  return o;
}

async function requirePolicies(c: pg.PoolClient, ids: string[]) {
  for (const id of ids) {
    if (!(await getPolicy(c, id))) throw new ToolError('POLICY_NOT_FOUND', `Cited policy ${id} does not exist; refusing to act on an unsupported citation`);
  }
}

async function authority(c: pg.PoolClient) {
  const p = await getPolicy(c, 'SOP-APR-001');
  if (!p) throw new ToolError('POLICY_NOT_FOUND', 'SOP-APR-001 (action authority) missing; no action is permitted without it');
  return p.params as { autonomous: string[]; approval_required: string[]; prohibited: string[]; approval_ttl_minutes: number };
}

// ------------------------------------------------------------------ hold
export const holdOrder = defineTool({
  name: 'hold_order',
  description: 'Place an order ON_HOLD (reversible) with the blocking exception as reference.',
  kind: 'action',
  roles: ['agent', 'operator', 'system'],
  input: z.object({ order_id: OrderId, exception_id: ExcId, reason: z.string().min(5).max(300), policy_id: PolicyId }),
  idempotencyKey: (i) => `hold:${i.order_id}:${i.exception_id}`,
  run: async (c, i, ctx, note) => {
    const auth = await authority(c);
    if (!auth.autonomous.includes('HOLD_ORDER')) throw new ToolError('NOT_PERMITTED', 'HOLD_ORDER is not an autonomous action under SOP-APR-001');
    await requirePolicies(c, [i.policy_id]);
    const o = await lockOrder(c, i.order_id);
    note.policy_refs = [i.policy_id, 'SOP-APR-001'];
    if (o.status === 'ON_HOLD') {
      note.decision_summary = `Order already ON_HOLD (by ${o.hold_exception_id}); no change`;
      note.outcome = 'NO_CHANGE';
      return { order_id: o.order_id, status: o.status, already_held: true, held_by: o.hold_exception_id };
    }
    if (!transitionAllowed(o.status, 'ON_HOLD')) {
      throw new ToolError('INVALID_TRANSITION', `Cannot hold an order in status ${o.status}`);
    }
    const { sim_now } = await repo.simState(c);
    await c.query(
      `UPDATE orders SET status = 'ON_HOLD', hold_prev_status = $2, hold_reason = $3, hold_exception_id = $4, updated_at = $5 WHERE order_id = $1`,
      [o.order_id, o.status, i.reason, i.exception_id, sim_now],
    );
    note.event_type = 'STATE_CHANGE';
    note.decision_summary = `Order ${o.order_id} placed ON_HOLD: ${i.reason}`;
    note.state_changes = [{ entity: 'order', id: o.order_id, field: 'status', from: o.status, to: 'ON_HOLD' }];
    await emit(c, 'ORDER_HELD', { order_id: o.order_id, exception_id: i.exception_id, previous_status: o.status }, 'hold_order', ctx);
    return { order_id: o.order_id, previous_status: o.status, status: 'ON_HOLD', hold_exception_id: i.exception_id };
  },
});

// ------------------------------------------------------------------ forward status sync
export const syncOrderStatus = defineTool({
  name: 'sync_order_status',
  description: 'Move an order status forward to match authoritative carrier evidence (SOP-SOT-002). Refuses unless every condition is met.',
  kind: 'action',
  roles: ['agent', 'system'],
  input: z.object({ order_id: OrderId, shipment_id: z.string().regex(/^SHP-\d{4}$/), to_status: z.literal('SHIPPED'), exception_id: ExcId, policy_id: PolicyId }),
  idempotencyKey: (i) => `sync:${i.order_id}:${i.to_status}:${i.exception_id}`,
  run: async (c, i, ctx, note) => {
    const auth = await authority(c);
    if (!auth.autonomous.includes('SYNC_ORDER_STATUS_FORWARD')) throw new ToolError('NOT_PERMITTED', 'Forward sync not autonomous under SOP-APR-001');
    await requirePolicies(c, [i.policy_id]);
    const o = await lockOrder(c, i.order_id);
    const s = await repo.getShipmentRow(c, i.shipment_id);
    if (!s) throw new ToolError('NOT_FOUND', `Shipment ${i.shipment_id} does not exist`);
    if (s.order_id !== o.order_id) throw new ToolError('RULE_VIOLATION', `Shipment ${s.shipment_id} is linked to ${s.order_id}, not ${o.order_id}`);
    if (!isForward(o.status, i.to_status) || !transitionAllowed(o.status, i.to_status)) {
      throw new ToolError('INVALID_TRANSITION', `${o.status} -> ${i.to_status} is not an allowed forward transition`);
    }
    const lines = await repo.getLines(c, o.order_id);
    const { sim_now } = await repo.simState(c);
    const f = shipmentFacts(o, lines, s, sim_now);
    const failed = [
      !f.has_pickup_scan && 'no carrier pickup scan',
      !f.all_lines_picked && 'not all lines fully picked',
      !f.destination_match && 'shipment destination differs from order destination',
    ].filter(Boolean);
    if (failed.length) throw new ToolError('RULE_VIOLATION', `SOP-SOT-002 conditions not met: ${failed.join('; ')}`, { facts: f });
    await c.query(`UPDATE orders SET status = $2, updated_at = $3 WHERE order_id = $1`, [o.order_id, i.to_status, sim_now]);
    note.event_type = 'STATE_CHANGE';
    note.policy_refs = [i.policy_id, 'SOP-APR-001'];
    note.decision_summary = `Order ${o.order_id} synced ${o.status} -> ${i.to_status} from carrier evidence on ${s.shipment_id}`;
    note.state_changes = [{ entity: 'order', id: o.order_id, field: 'status', from: o.status, to: i.to_status }];
    await emit(c, 'ORDER_STATUS_SYNCED', { order_id: o.order_id, from: o.status, to: i.to_status }, 'sync_order_status', ctx);
    return { order_id: o.order_id, previous_status: o.status, status: i.to_status, evidence: f };
  },
});

// ------------------------------------------------------------------ approvals
export const requestApproval = defineTool({
  name: 'request_approval',
  description: 'Create a pending approval proposal for an action that SOP-APR-001 marks as approval-required. Does NOT execute anything.',
  kind: 'action',
  roles: ['agent', 'system'],
  input: z.object({
    exception_id: ExcId,
    run_id: z.string(),
    action_type: z.enum(['CANCEL_ORDER', 'RELINK_SHIPMENT', 'ADJUST_INVENTORY', 'RELEASE_HOLD']),
    params: z.record(z.string(), z.any()),
    reason: z.string().min(5),
    effect: z.string().min(5),
    policy_ids: z.array(PolicyId).min(1),
  }),
  idempotencyKey: (i) => `approval:${i.exception_id}:${i.action_type}:${JSON.stringify(i.params)}`,
  run: async (c, i, _ctx, note) => {
    const auth = await authority(c);
    if (auth.prohibited.includes(i.action_type)) throw new ToolError('PROHIBITED', `${i.action_type} is prohibited for agents`);
    if (!auth.approval_required.includes(i.action_type)) throw new ToolError('NOT_APPROVAL_ACTION', `${i.action_type} is not an approval-gated action`);
    await requirePolicies(c, i.policy_ids);
    const exc = await repo.getExceptionRow(c, i.exception_id);
    if (!exc) throw new ToolError('NOT_FOUND', `Exception ${i.exception_id} does not exist`);
    const live = await one(c, `SELECT approval_id FROM approvals WHERE exception_id = $1 AND status IN ('PENDING','APPROVED','EXECUTING')`, [i.exception_id]);
    if (live) throw new ToolError('APPROVAL_ALREADY_PENDING', `Exception already has live approval ${live.approval_id}`);
    const { sim_now } = await repo.simState(c);
    const approval_id = newId('APR');
    const expires = new Date(new Date(sim_now).getTime() + auth.approval_ttl_minutes * 60000).toISOString();
    await c.query(
      `INSERT INTO approvals (approval_id, exception_id, run_id, action_type, params, effect, reason, policy_ids, status, idempotency_key, requested_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10,$11)`,
      [approval_id, i.exception_id, i.run_id, i.action_type, JSON.stringify(i.params), i.effect, i.reason, i.policy_ids, `exec:${approval_id}`, sim_now, expires],
    );
    await c.query(`UPDATE exceptions SET status = 'AWAITING_APPROVAL', outcome = 'AWAITING_APPROVAL' WHERE exception_id = $1`, [i.exception_id]);
    note.event_type = 'APPROVAL_REQUESTED';
    note.approval_state = 'PENDING';
    note.policy_refs = i.policy_ids;
    note.proposed_action = { action_type: i.action_type, params: i.params, effect: i.effect };
    note.decision_summary = `Approval requested: ${i.action_type} — ${i.reason}`;
    note.state_changes = [{ entity: 'exception', id: i.exception_id, field: 'status', from: exc.status, to: 'AWAITING_APPROVAL' }];
    return { approval_id, status: 'PENDING', expires_at: expires };
  },
});

export const decideApproval = defineTool({
  name: 'decide_approval',
  description: 'Operator records an explicit approve/reject decision on a pending proposal. Agents cannot call this.',
  kind: 'action',
  roles: ['operator'],
  input: z.object({ approval_id: z.string().regex(/^APR-[A-Z0-9]{8}$/), decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(500).optional() }),
  run: async (c, i, ctx, note) => {
    const a = await one(c, 'SELECT * FROM approvals WHERE approval_id = $1 FOR UPDATE', [i.approval_id]);
    if (!a) throw new ToolError('NOT_FOUND', `Approval ${i.approval_id} does not exist`);
    if (a.status !== 'PENDING') throw new ToolError('APPROVAL_NOT_PENDING', `Approval is ${a.status}; a decision can only be recorded once`);
    const { sim_now } = await repo.simState(c);
    if (new Date(sim_now) > new Date(a.expires_at)) {
      await c.query(`UPDATE approvals SET status = 'EXPIRED' WHERE approval_id = $1`, [i.approval_id]);
      note.approval_state = 'EXPIRED';
      note.outcome = 'EXPIRED';
      return { approval_id: i.approval_id, status: 'EXPIRED', executed: false };
    }
    const status = i.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await c.query(`UPDATE approvals SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5 WHERE approval_id = $1`, [
      i.approval_id, status, ctx.actor, sim_now, i.note ?? null,
    ]);
    note.event_type = 'APPROVAL_DECISION';
    note.approval_state = status;
    note.policy_refs = a.policy_ids;
    note.decision_summary = `${ctx.actor} ${status.toLowerCase()} ${a.action_type} (${i.approval_id})`;
    note.state_changes = [{ entity: 'approval', id: i.approval_id, field: 'status', from: 'PENDING', to: status }];
    return { approval_id: i.approval_id, status, exception_id: a.exception_id, action_type: a.action_type };
  },
});

export const executeApprovedAction = defineTool({
  name: 'execute_approved_action',
  description: 'Execute an APPROVED proposal exactly once. Fails with APPROVAL_REQUIRED if no approval was recorded.',
  kind: 'action',
  roles: ['operator', 'system'],
  input: z.object({ approval_id: z.string().regex(/^APR-[A-Z0-9]{8}$/) }),
  idempotencyKey: (i) => `exec:${i.approval_id}`,
  run: async (c, i, ctx, note) => {
    const claimed = await one(c, `UPDATE approvals SET status = 'EXECUTING' WHERE approval_id = $1 AND status = 'APPROVED' RETURNING *`, [i.approval_id]);
    if (!claimed) {
      const a = await one(c, 'SELECT status FROM approvals WHERE approval_id = $1', [i.approval_id]);
      if (!a) throw new ToolError('NOT_FOUND', `Approval ${i.approval_id} does not exist`);
      if (a.status === 'PENDING') throw new ToolError('APPROVAL_REQUIRED', 'No explicit approval has been recorded; refusing to execute');
      throw new ToolError('APPROVAL_NOT_EXECUTABLE', `Approval is ${a.status}; nothing executed`);
    }
    const { sim_now } = await repo.simState(c);
    const p = claimed.params as Record<string, string>;
    const changes: unknown[] = [];
    if (claimed.action_type === 'CANCEL_ORDER') {
      const o = await lockOrder(c, p.order_id);
      if (!transitionAllowed(o.status, 'CANCELLED')) throw new ToolError('INVALID_TRANSITION', `Cannot cancel an order in status ${o.status}`);
      if (o.status === 'ON_HOLD' && o.hold_prev_status !== 'PENDING') throw new ToolError('RULE_VIOLATION', `Order was ${o.hold_prev_status} before hold; only unstarted orders may be cancelled`);
      await c.query(`UPDATE orders SET status = 'CANCELLED', hold_prev_status = NULL, hold_reason = NULL, updated_at = $2 WHERE order_id = $1`, [o.order_id, sim_now]);
      changes.push({ entity: 'order', id: o.order_id, field: 'status', from: o.status, to: 'CANCELLED' });
      await emit(c, 'ORDER_CANCELLED', { order_id: o.order_id, approval_id: i.approval_id }, 'execute_approved_action', ctx);
    } else if (claimed.action_type === 'RELEASE_HOLD') {
      const o = await lockOrder(c, p.order_id);
      if (o.status !== 'ON_HOLD') throw new ToolError('INVALID_TRANSITION', `Order ${o.order_id} is not on hold`);
      await c.query(`UPDATE orders SET status = hold_prev_status, hold_prev_status = NULL, hold_reason = NULL, hold_exception_id = NULL, updated_at = $2 WHERE order_id = $1`, [o.order_id, sim_now]);
      changes.push({ entity: 'order', id: o.order_id, field: 'status', from: 'ON_HOLD', to: o.hold_prev_status });
      await emit(c, 'ORDER_RELEASED', { order_id: o.order_id, approval_id: i.approval_id }, 'execute_approved_action', ctx);
    } else if (claimed.action_type === 'RELINK_SHIPMENT') {
      const s = await repo.getShipmentRow(c, p.shipment_id);
      if (!s) throw new ToolError('NOT_FOUND', `Shipment ${p.shipment_id} does not exist`);
      if (!(await repo.getOrderRow(c, p.to_order_id))) throw new ToolError('NOT_FOUND', `Order ${p.to_order_id} does not exist`);
      await c.query('UPDATE shipments SET order_id = $2 WHERE shipment_id = $1', [s.shipment_id, p.to_order_id]);
      changes.push({ entity: 'shipment', id: s.shipment_id, field: 'order_id', from: s.order_id, to: p.to_order_id });
      await emit(c, 'SHIPMENT_RELINKED', { shipment_id: s.shipment_id, from: s.order_id, to: p.to_order_id }, 'execute_approved_action', ctx);
    } else {
      throw new ToolError('NOT_IMPLEMENTED', `${claimed.action_type} has no executor in this prototype`);
    }
    const result = { executed: true, state_changes: changes };
    await c.query(`UPDATE approvals SET status = 'EXECUTED', executed_at = $2, result = $3 WHERE approval_id = $1`, [i.approval_id, sim_now, JSON.stringify(result)]);
    await c.query(`UPDATE exceptions SET status = 'RESOLVED', outcome = 'RESOLVED_WITH_APPROVAL', resolution = $2 WHERE exception_id = $1`, [
      claimed.exception_id, JSON.stringify({ approval_id: i.approval_id, action_type: claimed.action_type, executed_by: ctx.actor, state_changes: changes }),
    ]);
    note.event_type = 'APPROVED_ACTION_EXECUTED';
    note.approval_state = 'EXECUTED';
    note.policy_refs = claimed.policy_ids;
    note.decision_summary = `Executed approved ${claimed.action_type} (${i.approval_id})`;
    note.state_changes = [...changes, { entity: 'exception', id: claimed.exception_id, field: 'status', to: 'RESOLVED' }];
    return { approval_id: i.approval_id, exception_id: claimed.exception_id, action_type: claimed.action_type, ...result };
  },
});

// ------------------------------------------------------------------ escalation / exception status
export const EscalationPayload = z.object({
  exception_id: ExcId,
  order_id: z.string(),
  detected_issue: z.string(),
  evidence_checked: z.array(z.string()),
  tool_results: z.array(z.object({ tool: z.string(), ok: z.boolean(), summary: z.string() })),
  conflicting_facts: z.array(z.string()),
  missing_facts: z.array(z.string()),
  policy_refs: z.array(z.object({ policy_id: z.string(), title: z.string(), excerpt: z.string(), why: z.string() })),
  recommended_human_action: z.string(),
  actions_already_taken: z.array(z.string()),
  current_state: z.record(z.string(), z.any()),
  unresolved_questions: z.array(z.string()),
});
export type EscalationPayload = z.infer<typeof EscalationPayload>;

export const createEscalation = defineTool({
  name: 'create_escalation',
  description: 'Create a structured escalation for a human Exception Reviewer.',
  kind: 'action',
  roles: ['agent', 'operator', 'system'],
  input: z.object({ run_id: z.string(), payload: EscalationPayload }),
  idempotencyKey: (i) => `escalation:${i.payload.exception_id}:${i.run_id}`,
  run: async (c, i, _ctx, note) => {
    const exc = await repo.getExceptionRow(c, i.payload.exception_id);
    if (!exc) throw new ToolError('NOT_FOUND', `Exception ${i.payload.exception_id} does not exist`);
    const escalation_id = newId('ESC');
    await c.query(`INSERT INTO escalations (escalation_id, exception_id, run_id, payload, status) VALUES ($1,$2,$3,$4,'OPEN')`, [
      escalation_id, exc.exception_id, i.run_id, JSON.stringify(i.payload),
    ]);
    await c.query(`UPDATE exceptions SET status = 'ESCALATED', outcome = 'ESCALATED' WHERE exception_id = $1`, [exc.exception_id]);
    note.event_type = 'ESCALATION_CREATED';
    note.policy_refs = i.payload.policy_refs.map((p) => p.policy_id);
    note.decision_summary = `Escalated ${exc.exception_id}: ${i.payload.detected_issue}`;
    note.state_changes = [{ entity: 'exception', id: exc.exception_id, field: 'status', from: exc.status, to: 'ESCALATED' }];
    return { escalation_id, exception_id: exc.exception_id, status: 'OPEN' };
  },
});

export const updateExceptionStatus = defineTool({
  name: 'update_exception_status',
  description: 'Record the resolver outcome on an exception.',
  kind: 'action',
  roles: ['agent', 'system'],
  input: z.object({
    exception_id: ExcId,
    status: z.enum(['INVESTIGATING', 'RESOLVED', 'FAILED']),
    outcome: z.string(),
    run_id: z.string(),
    resolution: z.record(z.string(), z.any()).optional(),
  }),
  run: async (c, i, _ctx, note) => {
    const exc = await one(c, 'SELECT * FROM exceptions WHERE exception_id = $1 FOR UPDATE', [i.exception_id]);
    if (!exc) throw new ToolError('NOT_FOUND', `Exception ${i.exception_id} does not exist`);
    if (['CLOSED'].includes(exc.status)) throw new ToolError('INVALID_TRANSITION', `Exception is ${exc.status}`);
    await c.query(`UPDATE exceptions SET status = $2, outcome = $3, last_run_id = $4, resolution = COALESCE($5, resolution) WHERE exception_id = $1`, [
      i.exception_id, i.status, i.outcome, i.run_id, i.resolution ? JSON.stringify(i.resolution) : null,
    ]);
    note.event_type = 'EXCEPTION_UPDATED';
    note.state_changes = [{ entity: 'exception', id: i.exception_id, field: 'status', from: exc.status, to: i.status }];
    note.outcome = i.outcome;
    return { exception_id: i.exception_id, previous_status: exc.status, status: i.status };
  },
});

export const resolveEscalation = defineTool({
  name: 'resolve_escalation',
  description: 'Exception Reviewer records a (simulated) resolution for an escalation, optionally releasing the order hold.',
  kind: 'action',
  roles: ['reviewer'],
  input: z.object({ escalation_id: z.string().regex(/^ESC-[A-Z0-9]{8}$/), resolution_note: z.string().min(5).max(1000), release_hold: z.boolean().default(false) }),
  run: async (c, i, ctx, note) => {
    const esc = await one(c, 'SELECT * FROM escalations WHERE escalation_id = $1 FOR UPDATE', [i.escalation_id]);
    if (!esc) throw new ToolError('NOT_FOUND', `Escalation ${i.escalation_id} does not exist`);
    if (esc.status !== 'OPEN') throw new ToolError('ALREADY_RESOLVED', 'Escalation already resolved');
    const { sim_now } = await repo.simState(c);
    const changes: unknown[] = [];
    const exc = await repo.getExceptionRow(c, esc.exception_id);
    if (i.release_hold && exc) {
      const o = await one<Order>(c, 'SELECT * FROM orders WHERE order_id = $1 FOR UPDATE', [exc.order_id]);
      if (!o || o.status !== 'ON_HOLD') throw new ToolError('INVALID_TRANSITION', `Order ${exc.order_id} is not on hold`);
      await c.query(`UPDATE orders SET status = hold_prev_status, hold_prev_status = NULL, hold_reason = NULL, hold_exception_id = NULL, updated_at = $2 WHERE order_id = $1`, [o.order_id, sim_now]);
      changes.push({ entity: 'order', id: o.order_id, field: 'status', from: 'ON_HOLD', to: o.hold_prev_status as OrderStatus });
      await emit(c, 'ORDER_RELEASED', { order_id: o.order_id, escalation_id: i.escalation_id }, 'resolve_escalation', ctx);
    }
    await c.query(`UPDATE escalations SET status = 'RESOLVED', resolved_by = $2, resolution_note = $3, resolved_at = now() WHERE escalation_id = $1`, [
      i.escalation_id, ctx.actor, i.resolution_note,
    ]);
    await c.query(`UPDATE exceptions SET status = 'CLOSED', outcome = 'CLOSED_BY_REVIEWER' WHERE exception_id = $1`, [esc.exception_id]);
    changes.push({ entity: 'exception', id: esc.exception_id, field: 'status', to: 'CLOSED' });
    note.event_type = 'ESCALATION_RESOLVED';
    note.decision_summary = `${ctx.actor}: ${i.resolution_note}`;
    note.state_changes = changes;
    return { escalation_id: i.escalation_id, status: 'RESOLVED', state_changes: changes };
  },
});
