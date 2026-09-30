/**
 * Planner and simulation tools. The planner tool snapshots the SAME tables the resolver
 * writes to (orders.status / hold_exception_id), runs the pure engine, and persists a
 * new plan version. Simulation tools model the passage of shift time and mid-shift changes.
 */
import { z } from 'zod';
import type pg from 'pg';
import { defineTool, ToolError } from './framework.js';
import * as repo from './repo.js';
import { many, one } from '../db/pool.js';
import { buildPlan, type PlanResult, type PrevAssignment } from '../planner/engine.js';
import { computeWorkload, round2 } from '../domain/rules.js';
import type { Order, Picker } from '../domain/types.js';
import { policyParams } from '../policy/retrieval.js';
import { audit } from '../audit/audit.js';
import { newId } from './action-tools.js';

export async function planningSnapshot(c: pg.PoolClient | pg.Pool) {
  const st = await repo.simState(c);
  const pln1 = await policyParams(c, 'SOP-PLN-001');
  const pln2 = await policyParams(c, 'SOP-PLN-002');
  const prevPlan = await one(c, `SELECT * FROM plans WHERE status = 'ACTIVE'`);
  const prevRows = prevPlan ? await many<PrevAssignment>(c, 'SELECT * FROM plan_assignments WHERE plan_version = $1', [prevPlan.version]) : [];
  return {
    simNow: st.sim_now,
    shiftEnd: st.shift_end,
    orders: await repo.allOrders(c),
    lines: await repo.allLines(c),
    skus: await repo.allSkus(c),
    inventory: await repo.inventoryRows(c),
    pickers: (await repo.allPickers(c)) as Array<Picker & { consumed_minutes: number }>,
    openExceptions: await repo.openExceptions(c),
    params: {
      urgency_bucket_minutes: pln1.urgency_bucket_minutes,
      plannable_statuses: pln1.plannable_statuses,
      minutes_per_location: pln2.minutes_per_location,
      minutes_per_extra_zone: pln2.minutes_per_extra_zone,
    },
    previous: prevPlan ? { version: prevPlan.version as number, assignments: prevRows } : null,
  };
}

export const PLAN_TRIGGERS = ['INITIAL', 'MANUAL_REFRESH', 'PICKER_UNAVAILABLE', 'URGENT_ORDER', 'EXCEPTION_HOLD', 'INVENTORY_CHANGED', 'PICKER_AVAILABLE'] as const;

export const generatePlan = defineTool({
  name: 'generate_plan',
  description: 'Run the deterministic planner on current shared state and persist a new plan version (incremental against the active plan).',
  kind: 'action',
  roles: ['agent', 'operator', 'system'],
  input: z.object({ trigger: z.enum(PLAN_TRIGGERS), trigger_detail: z.string().max(300).optional(), run_id: z.string() }),
  run: async (c, i, _ctx, note) => {
    await c.query('LOCK TABLE plans IN EXCLUSIVE MODE'); // serialize plan versioning
    const snap = await planningSnapshot(c);
    const result: PlanResult = buildPlan(snap);
    const version = ((await one<{ v: number }>(c, 'SELECT COALESCE(max(version),0)::int v FROM plans'))!.v) + 1;
    const parent = snap.previous?.version ?? null;
    await c.query(`UPDATE plans SET status = 'SUPERSEDED' WHERE status = 'ACTIVE'`);
    await c.query(
      `INSERT INTO plans (version, status, trigger, trigger_detail, parent_version, run_id, sim_time, summary, change_log)
       VALUES ($1,'ACTIVE',$2,$3,$4,$5,$6,$7,$8)`,
      [version, i.trigger, i.trigger_detail ?? null, parent, i.run_id, snap.simNow,
        JSON.stringify({ ...result.summary, pickers: result.pickers, metrics: result.metrics ?? null }), JSON.stringify(result.change_log)],
    );
    for (const a of result.assignments) {
      await c.query(
        `INSERT INTO plan_assignments (plan_version, order_id, picker_id, sequence, priority_rank, status, workload_minutes, est_start, est_finish,
           deadline, sla_at_risk, inventory_readiness, primary_zone, zones, rationale, block_reason, exception_ref, change_type, change_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [version, a.order_id, a.picker_id, a.sequence, a.priority_rank, a.status, a.workload_minutes, a.est_start, a.est_finish, a.deadline,
          a.sla_at_risk, a.inventory_readiness, a.primary_zone, a.zones, [a.rationale, ...a.warnings.map((w) => `⚠ ${w}`)].join('\n'),
          a.block_reason, a.exception_ref, a.change_type ?? (parent ? null : 'INITIAL'), a.change_reason ?? null],
      );
    }
    // In-progress orders whose picker was invalidated keep their picked quantities but lose the picker link.
    const released: string[] = [];
    for (const a of result.assignments) {
      const o = snap.orders.find((x) => x.order_id === a.order_id)!;
      if (o.status === 'PICKING' && o.assigned_picker_id && a.status !== 'IN_PROGRESS') {
        await c.query('UPDATE orders SET assigned_picker_id = NULL WHERE order_id = $1', [o.order_id]);
        released.push(o.order_id);
      }
    }
    note.event_type = parent ? 'PLAN_CHANGE' : 'PLAN_CREATED';
    note.policy_refs = ['SOP-PLN-001', 'SOP-PLN-002', ...(parent ? ['SOP-PLN-003'] : [])];
    note.decision_summary = `Plan v${version} (${i.trigger}${parent ? `, from v${parent}` : ''}): ${result.summary.assigned} assigned, ${result.summary.in_progress} in progress, ${result.summary.blocked} blocked, ${result.summary.infeasible} infeasible, ${result.summary.sla_at_risk} SLA risk`;
    note.state_changes = { plan_version: version, superseded: parent, change_log: result.change_log, released_picker_links: released };
    return { version, parent_version: parent, trigger: i.trigger, sim_time: snap.simNow, ...result };
  },
});

// ---------------------------------------------------------------- operator / simulation tools
const SIM_ROLES = ['operator', 'system'] as const;

export const setPickerAvailability = defineTool({
  name: 'set_picker_availability',
  description: 'Simulated mid-shift staffing change.',
  kind: 'action',
  roles: [...SIM_ROLES],
  input: z.object({ picker_id: z.string().regex(/^P-\d{2}$/), availability: z.enum(['AVAILABLE', 'UNAVAILABLE']), reason: z.string().min(3).max(200) }),
  run: async (c, i, _ctx, note) => {
    const p = await one<Picker>(c, 'SELECT * FROM pickers WHERE picker_id = $1 FOR UPDATE', [i.picker_id]);
    if (!p) throw new ToolError('NOT_FOUND', `Picker ${i.picker_id} does not exist`);
    if (p.availability === i.availability) throw new ToolError('NO_CHANGE', `${i.picker_id} is already ${i.availability}`);
    await c.query('UPDATE pickers SET availability = $2, unavailable_reason = $3 WHERE picker_id = $1', [i.picker_id, i.availability, i.availability === 'UNAVAILABLE' ? i.reason : null]);
    note.event_type = 'SIM_CHANGE';
    note.decision_summary = `SIMULATED: ${i.picker_id} ${p.availability} → ${i.availability} (${i.reason})`;
    note.state_changes = [{ entity: 'picker', id: i.picker_id, field: 'availability', from: p.availability, to: i.availability }];
    return { picker_id: i.picker_id, from: p.availability, to: i.availability };
  },
});

export const injectUrgentOrder = defineTool({
  name: 'inject_urgent_order',
  description: 'Simulated arrival of a new urgent order.',
  kind: 'action',
  roles: [...SIM_ROLES],
  input: z.object({
    order_id: z.string().regex(/^ORD-\d{4}$/),
    priority: z.number().int().min(1).max(3).default(1),
    due_in_minutes: z.number().int().min(15).max(600),
    customer_ref: z.string().default('CUST-0900'),
    destination_ref: z.string().default('DEST-N-900'),
    lines: z.array(z.object({ sku: z.string().regex(/^SKU-\d{3}$/), qty: z.number().int().positive() })).min(1),
  }),
  idempotencyKey: (i) => `inject:${i.order_id}`,
  run: async (c, i, _ctx, note) => {
    if (await repo.getOrderRow(c, i.order_id)) throw new ToolError('ALREADY_EXISTS', `${i.order_id} already exists`);
    const { sim_now } = await repo.simState(c);
    const deadline = new Date(new Date(sim_now).getTime() + i.due_in_minutes * 60000).toISOString();
    await c.query(
      `INSERT INTO orders (order_id, status, priority, created_at, deadline, customer_ref, destination_ref, updated_at) VALUES ($1,'PENDING',$2,$3,$4,$5,$6,$3)`,
      [i.order_id, i.priority, sim_now, deadline, i.customer_ref, i.destination_ref],
    );
    let n = 1;
    for (const l of i.lines) {
      if (!(await one(c, 'SELECT 1 FROM skus WHERE sku = $1', [l.sku]))) throw new ToolError('NOT_FOUND', `SKU ${l.sku} does not exist`);
      await c.query('INSERT INTO order_lines VALUES ($1,$2,$3,$4,$5,0)', [`${i.order_id}-L${n}`, i.order_id, n, l.sku, l.qty]);
      n++;
    }
    note.event_type = 'SIM_CHANGE';
    note.decision_summary = `SIMULATED: urgent order ${i.order_id} (P${i.priority}, due ${deadline.slice(11, 16)}) arrived`;
    note.state_changes = [{ entity: 'order', id: i.order_id, field: 'created', to: 'PENDING' }];
    return { order_id: i.order_id, deadline };
  },
});

export const adjustInventorySim = defineTool({
  name: 'simulate_inventory_change',
  description: 'Simulated external inventory change (e.g. damage found) — used to test plan/dispatch drift.',
  kind: 'action',
  roles: [...SIM_ROLES],
  input: z.object({ sku: z.string(), location_id: z.string(), on_hand: z.number().int().min(0), reason: z.string().min(3) }),
  run: async (c, i, _ctx, note) => {
    const r = await one(c, 'SELECT * FROM inventory WHERE sku = $1 AND location_id = $2 FOR UPDATE', [i.sku, i.location_id]);
    if (!r) throw new ToolError('NOT_FOUND', `No inventory for ${i.sku} at ${i.location_id}`);
    const { sim_now } = await repo.simState(c);
    const reserved = Math.min(r.reserved, i.on_hand);
    await c.query('UPDATE inventory SET on_hand = $3, reserved = $4, last_updated = $5 WHERE sku = $1 AND location_id = $2', [i.sku, i.location_id, i.on_hand, reserved, sim_now]);
    note.event_type = 'SIM_CHANGE';
    note.decision_summary = `SIMULATED: ${i.sku}@${i.location_id} on_hand ${r.on_hand} → ${i.on_hand} (${i.reason})`;
    note.state_changes = [{ entity: 'inventory', id: `${i.sku}@${i.location_id}`, field: 'on_hand', from: r.on_hand, to: i.on_hand }];
    return { sku: i.sku, location_id: i.location_id, from: r.on_hand, to: i.on_hand };
  },
});

export const injectFault = defineTool({
  name: 'inject_fault',
  description: 'Make the next N calls of a tool fail (TIMEOUT or ERROR) to exercise failure handling.',
  kind: 'action',
  roles: [...SIM_ROLES],
  input: z.object({ tool_name: z.string(), mode: z.enum(['TIMEOUT', 'ERROR']), count: z.number().int().min(1).max(5).default(1) }),
  run: async (c, i, _ctx, note) => {
    await c.query(`UPDATE sim_state SET faults = faults || jsonb_build_object($1::text, jsonb_build_object('mode', $2::text, 'remaining', $3::int)) WHERE id = 1`, [i.tool_name, i.mode, i.count]);
    note.event_type = 'SIM_CHANGE';
    note.decision_summary = `SIMULATED FAULT: next ${i.count} call(s) of ${i.tool_name} → ${i.mode}`;
    return i;
  },
});

/**
 * Advance the simulated clock. Available pickers work through their active-plan queue:
 * each ASSIGNED item is dispatched (inventory re-checked at dispatch time), progress is
 * applied, completed orders become PICKED, inventory is decremented. Pending approvals
 * past their expiry become EXPIRED.
 */
export const advanceClock = defineTool({
  name: 'advance_clock',
  description: 'Simulate shift time passing: pickers execute planned work, approvals can expire.',
  kind: 'action',
  roles: [...SIM_ROLES],
  input: z.object({ minutes: z.number().int().min(1).max(480) }),
  run: async (c, i, ctx, note) => {
    const st = await repo.simState(c);
    const newNow = new Date(new Date(st.sim_now).getTime() + i.minutes * 60000).toISOString();
    const plan = await one(c, `SELECT * FROM plans WHERE status = 'ACTIVE'`);
    const skus = await repo.allSkus(c);
    const p2 = await policyParams(c, 'SOP-PLN-002');
    const events: unknown[] = [];
    if (plan) {
      const pickers = await repo.allPickers(c);
      for (const p of pickers.filter((x) => x.availability === 'AVAILABLE')) {
        let budget = i.minutes;
        const rows = await many(c, `SELECT * FROM plan_assignments WHERE plan_version = $1 AND picker_id = $2 AND status IN ('IN_PROGRESS','ASSIGNED') ORDER BY sequence`, [plan.version, p.picker_id]);
        for (const row of rows) {
          if (budget <= 0) break;
          const o = await one<Order>(c, 'SELECT * FROM orders WHERE order_id = $1 FOR UPDATE', [row.order_id]);
          if (!o) continue;
          const lines = await repo.getLines(c, o.order_id);
          const inv = await repo.inventoryRows(c);
          if (row.status === 'ASSIGNED') {
            // dispatch-time re-validation (failure mode F7)
            const problems: string[] = [];
            if (!['PENDING', 'PICKING'].includes(o.status)) problems.push(`order is ${o.status}`);
            for (const l of lines) {
              const rem = l.requested_qty - l.picked_qty;
              const avail = inv.filter((r) => r.sku === l.sku).reduce((s, r) => s + r.available, 0);
              if (rem > avail) problems.push(`${l.sku} needs ${rem}, only ${avail} available now`);
            }
            if (problems.length) {
              const reason = `DISPATCH_BLOCKED: state changed since plan v${plan.version} was generated — ${problems.join('; ')}`;
              await c.query(`UPDATE plan_assignments SET status = 'BLOCKED', block_reason = $3 WHERE plan_version = $1 AND order_id = $2`, [plan.version, o.order_id, reason]);
              await audit(c, { run_id: ctx.runId, workflow: 'SHIFT_PLANNER', actor: 'dispatcher', event_type: 'DISPATCH_BLOCKED', tool_name: 'advance_clock', decision_summary: `${o.order_id}: ${reason}`, policy_refs: ['SOP-PLN-002'], outcome: 'BLOCKED' });
              events.push({ order_id: o.order_id, event: 'DISPATCH_BLOCKED', reason });
              continue;
            }
            await c.query(`UPDATE orders SET status = 'PICKING', assigned_picker_id = $2, updated_at = $3 WHERE order_id = $1`, [o.order_id, p.picker_id, st.sim_now]);
            await c.query(`UPDATE plan_assignments SET status = 'IN_PROGRESS' WHERE plan_version = $1 AND order_id = $2`, [plan.version, o.order_id]);
            events.push({ order_id: o.order_id, event: 'DISPATCHED', picker_id: p.picker_id });
          }
          const wl = computeWorkload(lines, skus, inv, p2 as any);
          const fraction = wl.minutes <= budget ? 1 : budget / wl.minutes;
          const spent = Math.min(budget, wl.minutes);
          for (const l of lines) {
            const rem = l.requested_qty - l.picked_qty;
            const qty = fraction === 1 ? rem : Math.floor(rem * fraction);
            if (qty <= 0) continue;
            await c.query('UPDATE order_lines SET picked_qty = picked_qty + $2 WHERE line_id = $1', [l.line_id, qty]);
            let left = qty;
            for (const r of inv.filter((x) => x.sku === l.sku).sort((a, b) => b.available - a.available)) {
              const take = Math.min(left, r.available);
              if (take <= 0) continue;
              await c.query('UPDATE inventory SET on_hand = on_hand - $3, last_updated = $4 WHERE sku = $1 AND location_id = $2', [r.sku, r.location_id, take, newNow]);
              r.available -= take;
              left -= take;
            }
          }
          await c.query('UPDATE pickers SET consumed_minutes = consumed_minutes + $2 WHERE picker_id = $1', [p.picker_id, round2(spent)]);
          budget -= spent;
          if (fraction === 1) {
            await c.query(`UPDATE orders SET status = 'PICKED', updated_at = $2 WHERE order_id = $1`, [o.order_id, newNow]);
            await c.query(`UPDATE plan_assignments SET status = 'COMPLETED' WHERE plan_version = $1 AND order_id = $2`, [plan.version, o.order_id]);
            events.push({ order_id: o.order_id, event: 'COMPLETED', picker_id: p.picker_id, minutes: round2(spent) });
          } else {
            events.push({ order_id: o.order_id, event: 'PROGRESS', picker_id: p.picker_id, minutes: round2(spent), pct: Math.round(fraction * 100) });
          }
        }
      }
    }
    // approvals not received in time
    const expired = await many(c, `UPDATE approvals SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at <= $1 RETURNING approval_id, exception_id, action_type`, [newNow]);
    for (const a of expired) {
      await c.query(`UPDATE exceptions SET status = 'ESCALATED', outcome = 'APPROVAL_EXPIRED' WHERE exception_id = $1`, [a.exception_id]);
      await c.query(`INSERT INTO escalations (escalation_id, exception_id, run_id, payload, status) VALUES ($1,$2,$3,$4,'OPEN')`, [
        newId('ESC'), a.exception_id, ctx.runId,
        JSON.stringify({ exception_id: a.exception_id, detected_issue: `Approval ${a.approval_id} for ${a.action_type} was not received before expiry`, recommended_human_action: 'Review the proposal and decide manually; nothing was executed.', actions_already_taken: ['Proposal expired; no action executed'], unresolved_questions: ['Should the proposed action still be taken?'] }),
      ]);
      events.push({ approval_id: a.approval_id, event: 'APPROVAL_EXPIRED', exception_id: a.exception_id });
    }
    await c.query('UPDATE sim_state SET sim_now = $1 WHERE id = 1', [newNow]);
    note.event_type = 'SIM_CHANGE';
    note.decision_summary = `SIMULATED: clock ${st.sim_now.slice(11, 16)} → ${newNow.slice(11, 16)}; ${events.length} execution event(s)`;
    note.state_changes = events;
    return { from: st.sim_now, to: newNow, events };
  },
});
