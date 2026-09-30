/**
 * Deterministic assessment of an exception from the evidence ledger (pure; no I/O).
 *
 * Two jobs:
 *  1. Say which evidence is still missing (the deterministic investigator follows this;
 *     the guard uses it to reject an LLM decision made on incomplete evidence).
 *  2. Once evidence is complete, compute facts and the policy-permitted decision.
 *
 * Every number and comparison here comes from tool results — never from model text.
 */
import type { ExceptionRecord } from '../../domain/types.js';
import { keyOf, type Ledger } from './ledger.js';

export type DecisionKind = 'AUTO_ACTION' | 'REQUEST_APPROVAL' | 'ESCALATE' | 'NO_ACTION_NEEDED';
export const CONSERVATISM: Record<DecisionKind, number> = { NO_ACTION_NEEDED: 0, AUTO_ACTION: 1, REQUEST_APPROVAL: 2, ESCALATE: 3 };

export interface PlannedAction { type: 'HOLD_ORDER' | 'SYNC_ORDER_STATUS_FORWARD'; params: Record<string, string> }
export interface EvidenceNeed { tool: string; input: Record<string, unknown>; why: string }

export interface Assessment {
  complete: boolean;
  missing_evidence: EvidenceNeed[];
  detected_issue: string;
  findings: string[];
  conflicting_facts: string[];
  missing_facts: string[];
  required_policies: string[];
  policy_why: Record<string, string>;
  decision: DecisionKind;
  actions: PlannedAction[];
  approval?: { action_type: 'CANCEL_ORDER' | 'RELINK_SHIPMENT' | 'ADJUST_INVENTORY' | 'RELEASE_HOLD'; params: Record<string, string>; effect: string; reason: string };
  escalate: boolean;
  outcome_label: 'AUTO_RESOLVED' | 'HELD_AND_ESCALATED' | 'ESCALATED' | 'AWAITING_APPROVAL' | 'NO_ACTION_NEEDED';
  recommended_human_action: string;
  unresolved_questions: string[];
}

const TRANSIENT = new Set(['TIMEOUT', 'UPSTREAM_ERROR', 'INTERNAL_ERROR']);
const HOLDABLE = new Set(['PENDING', 'PICKING', 'PICKED', 'PACKED']);

class Ctx {
  missing: EvidenceNeed[] = [];
  missingFacts: string[] = [];
  constructor(public ledger: Ledger) {}

  /** Returns data if available; registers a need otherwise. `null` = definitively unavailable. */
  need<T = any>(tool: string, input: Record<string, unknown>, why: string): T | null | undefined {
    const d = this.ledger.get<T>(tool, input);
    if (d !== undefined) return d;
    const fails = this.ledger.entries.filter((e) => !e.ok && keyOf(e.tool, e.input) === keyOf(tool, input));
    const last = fails.at(-1);
    if (last && (!TRANSIENT.has(last.error!.code) || fails.length >= 2)) {
      this.missingFacts.push(`${tool}(${Object.values(input).join(', ')}) → ${last.error!.code}: ${last.error!.message}`);
      return null;
    }
    this.missing.push({ tool, input, why });
    return undefined;
  }

  /** Ensure policies were actually retrieved in this run (search first, then direct fetch). */
  policies(ids: string[], query: string) {
    const got = this.ledger.retrievedPolicies();
    if (ids.every((id) => got.has(id))) return;
    if (!this.ledger.has('search_policies', { query })) {
      this.missing.push({ tool: 'search_policies', input: { query }, why: `retrieve governing SOP (${ids.join(', ')})` });
      return;
    }
    for (const id of ids) if (!got.has(id)) this.need('get_policy', { policy_id: id }, `fetch ${id}, not returned by search`);
  }
}

const base = (): Omit<Assessment, 'complete' | 'missing_evidence'> => ({
  detected_issue: '', findings: [], conflicting_facts: [], missing_facts: [], required_policies: [], policy_why: {},
  decision: 'ESCALATE', actions: [], escalate: true, outcome_label: 'ESCALATED', recommended_human_action: '', unresolved_questions: [],
});

function incomplete(c: Ctx, partial: Partial<Assessment> = {}): Assessment {
  return { ...base(), ...partial, complete: false, missing_evidence: c.missing, missing_facts: c.missingFacts };
}

function holdOrEscalate(a: Assessment, order: any, excId: string, reason: string, policy: string) {
  if (order && HOLDABLE.has(order.status)) {
    a.actions.push({ type: 'HOLD_ORDER', params: { order_id: order.order_id, exception_id: excId, reason, policy_id: policy } });
    a.outcome_label = 'HELD_AND_ESCALATED';
  } else {
    a.outcome_label = 'ESCALATED';
  }
  a.decision = 'ESCALATE';
  a.escalate = true;
}

export function assess(exc: ExceptionRecord, ledger: Ledger): Assessment {
  const c = new Ctx(ledger);
  const E = exc.exception_id;
  const O = exc.order_id;

  const excData = c.need('get_exception', { exception_id: E }, 'load the exception');
  if (excData === undefined) return incomplete(c);
  const order = c.need('get_order', { order_id: O }, 'load the order under investigation');
  if (order === undefined) return incomplete(c);

  const a: Assessment = { ...base(), complete: true, missing_evidence: [], missing_facts: c.missingFacts };

  // ---- F1: missing record ---------------------------------------------------------
  if (order === null) {
    c.policies(['SOP-EXC-003'], 'missing record invalid malformed data');
    if (c.missing.length) return incomplete(c);
    a.detected_issue = `Exception ${E} references order ${O}, which cannot be loaded`;
    a.findings.push(...c.missingFacts);
    a.required_policies = ['SOP-EXC-003'];
    a.policy_why['SOP-EXC-003'] = 'A referenced record is missing; values must not be invented, so the case goes to a human.';
    a.recommended_human_action = `Check whether ${O} exists under another id or was deleted upstream; correct the exception reference.`;
    a.unresolved_questions.push(`Which order was ${E} meant to reference?`);
    return a;
  }

  switch (exc.type) {
    // ================================================================= INVENTORY
    case 'INVENTORY_SHORTFALL': {
      const lines = c.need('get_order_lines', { order_id: O }, 'requested vs picked quantities');
      if (lines === undefined) return incomplete(c);
      const need = new Map<string, number>();
      for (const l of lines?.lines ?? []) {
        const rem = l.requested_qty - l.picked_qty;
        if (rem > 0) need.set(l.sku, (need.get(l.sku) ?? 0) + rem);
      }
      const inv = new Map<string, any>();
      for (const sku of need.keys()) inv.set(sku, c.need('get_inventory', { sku }, `stock and cycle counts for ${sku}`));
      if (c.missing.length) return incomplete(c);
      if (['PICKED', 'PACKED', 'SHIPPED', 'CANCELLED'].includes(order.status)) {
        c.policies(['SOP-EXC-001'], 'inventory shortfall cycle count stock hold');
        if (c.missing.length) return incomplete(c);
        Object.assign(a, { decision: 'NO_ACTION_NEEDED', escalate: false, outcome_label: 'NO_ACTION_NEEDED' });
        a.detected_issue = `Order ${O} is already ${order.status}; it no longer needs stock`;
        a.required_policies = ['SOP-EXC-001'];
        a.policy_why['SOP-EXC-001'] = 'Shortfall handling applies only to orders that still need to be picked.';
        return a;
      }
      const shortages: string[] = [];
      for (const [sku, n] of need) {
        const d = inv.get(sku);
        if (d === null) continue; // recorded in missing_facts by need()
        const av = d.availability;
        if (!av) { shortages.push(`${sku}: no inventory location record (MISSING_LOCATION)`); continue; }
        a.findings.push(`${sku}: order needs ${n}; system on_hand ${av.system_on_hand}, system available ${av.system_available}` +
          (av.latest_count ? `; cycle count ${av.latest_count.count_id} at ${av.latest_count.counted_at} found ${av.latest_count.counted_qty}` : '') +
          `; effective available ${av.effective_available} (${av.basis})`);
        if (av.count_supersedes_system) a.conflicting_facts.push(`${sku}: system on_hand ${av.system_on_hand} vs physical count ${av.latest_count.counted_qty} (count is newer)`);
        if (n > av.effective_available) shortages.push(`${sku}: needs ${n}, effective available ${av.effective_available} (short ${n - av.effective_available})`);
      }
      c.policies(['SOP-EXC-001', 'SOP-SOT-001'], 'inventory shortfall cycle count stock hold');
      if (shortages.length) c.policies(['SOP-APR-001'], 'approval authority autonomous action boundary');
      if (c.missing.length) return incomplete(c);
      a.required_policies = ['SOP-EXC-001', 'SOP-SOT-001', ...(shortages.length ? ['SOP-APR-001'] : [])];
      a.policy_why['SOP-SOT-001'] = 'A cycle count newer than the inventory record supersedes system on_hand, so the lower counted value is the effective stock.';
      if (!shortages.length && !a.missing_facts.length) {
        Object.assign(a, { decision: 'NO_ACTION_NEEDED', escalate: false, outcome_label: 'NO_ACTION_NEEDED' });
        a.detected_issue = `No shortfall: effective available stock covers every line of ${O}`;
        a.policy_why['SOP-EXC-001'] = 'Hold is only required when confirmed stock is below the remaining quantity.';
        return a;
      }
      a.detected_issue = `Inventory shortfall on ${O}: ${shortages.join('; ') || 'inventory could not be verified'}`;
      a.policy_why['SOP-EXC-001'] = 'Confirmed stock is below the remaining quantity: the order must be held (reversible) and escalated; quantities are not reduced and stock is not invented.';
      a.policy_why['SOP-APR-001'] = 'HOLD_ORDER is on the autonomous list; inventory adjustment is approval-gated so it is left to a human.';
      holdOrEscalate(a, order, E, `Inventory shortfall: ${shortages.join('; ')}`, 'SOP-EXC-001');
      a.recommended_human_action = `Inventory control: recount the affected location(s) and post an adjustment or replenish; then release the hold on ${O} (approval-gated).`;
      a.unresolved_questions.push('Is the physical cycle count correct, or was stock moved to another location?', `Can the gap be replenished before the ${O} deadline (${order.deadline})?`, 'Would the customer accept a partial shipment?');
      return a;
    }

    // ================================================================= DUPLICATE
    case 'DUPLICATE_ORDER': {
      const lines = c.need('get_order_lines', { order_id: O }, 'line items to compare');
      const dup = c.need('find_duplicate_orders', { order_id: O }, 'apply SOP-EXC-002 duplicate criteria');
      if (lines === undefined || dup === undefined) return incomplete(c);
      const probable = (dup?.candidates ?? []).filter((x: any) => x.probable_duplicate);
      for (const p of probable) c.need('get_order', { order_id: p.order_id }, `inspect the other order ${p.order_id}`);
      c.policies(['SOP-EXC-002', 'SOP-APR-001'], 'duplicate order cancel approval');
      if (c.missing.length) return incomplete(c);
      a.required_policies = ['SOP-EXC-002', 'SOP-APR-001'];
      for (const cand of dup?.candidates ?? []) a.findings.push(`${O} vs ${cand.order_id} (${cand.status}): ${cand.criteria.join('; ')} → ${cand.probable_duplicate ? 'PROBABLE DUPLICATE' : 'not a duplicate'}`);
      if (probable.length === 0) {
        Object.assign(a, { decision: 'NO_ACTION_NEEDED', escalate: false, outcome_label: 'NO_ACTION_NEEDED' });
        a.detected_issue = `${O} does not meet the duplicate criteria against any same-customer order`;
        a.policy_why['SOP-EXC-002'] = 'All four criteria (customer, destination, identical lines, 30-minute window) must hold.';
        return a;
      }
      if (probable.length > 1) {
        a.detected_issue = `${O} matches ${probable.length} orders; which one is the original is ambiguous`;
        a.policy_why['SOP-EXC-002'] = 'Cancelling requires approval and a single clear original; multiple matches are escalated.';
        holdOrEscalate(a, order, E, 'Probable duplicate (multiple matches) under review', 'SOP-EXC-002');
        a.recommended_human_action = 'Contact the customer to confirm which submission is intended.';
        a.unresolved_questions.push('Which order is the customer\'s intended one?');
        return a;
      }
      const other = probable[0];
      const suspectId: string = other.later_order;
      const keepId = suspectId === O ? other.order_id : O;
      const suspect = suspectId === O ? order : ledger.get('get_order', { order_id: suspectId });
      const unstarted = suspect.status === 'PENDING' || (suspect.status === 'ON_HOLD' && suspect.hold_prev_status === 'PENDING');
      a.detected_issue = `${suspectId} is a probable duplicate of ${keepId} (${other.criteria.join('; ')})`;
      a.policy_why['SOP-EXC-002'] = `All duplicate criteria hold; the later order ${suspectId} is the suspected duplicate. It may be held autonomously, but cancelling needs explicit operator approval.`;
      a.policy_why['SOP-APR-001'] = 'CANCEL_ORDER is on the approval-required list; HOLD_ORDER is autonomous.';
      if (!unstarted) {
        holdOrEscalate(a, suspect, E, `Probable duplicate of ${keepId}; picking already started`, 'SOP-EXC-002');
        a.recommended_human_action = `Picking already started on ${suspectId}; decide whether to stop and return stock.`;
        a.unresolved_questions.push('Should in-progress work on the duplicate be reversed?');
        return a;
      }
      if (suspect.status !== 'ON_HOLD') a.actions.push({ type: 'HOLD_ORDER', params: { order_id: suspectId, exception_id: E, reason: `Probable duplicate of ${keepId}; cancellation awaiting approval`, policy_id: 'SOP-EXC-002' } });
      a.decision = 'REQUEST_APPROVAL';
      a.escalate = false;
      a.outcome_label = 'AWAITING_APPROVAL';
      a.approval = {
        action_type: 'CANCEL_ORDER',
        params: { order_id: suspectId, duplicate_of: keepId },
        reason: `Duplicate order confirmed by SOP-EXC-002 criteria (${other.criteria.join('; ')})`,
        effect: `${suspectId} moves ${suspect.status === 'ON_HOLD' ? 'ON_HOLD' : 'PENDING → ON_HOLD'} → CANCELLED and is never picked. ${keepId} is unchanged and will be fulfilled. No inventory, shipment or other order records change.`,
      };
      a.recommended_human_action = `Approve cancelling ${suspectId} if the customer placed one order; reject to keep both (hold then stays until a reviewer releases it).`;
      return a;
    }

    // ================================================================= STATUS DESYNC
    case 'STATUS_DESYNC': {
      const lines = c.need('get_order_lines', { order_id: O }, 'are all lines fully picked?');
      const ships = (order.linked_shipment_ids as string[]).map((sid) => c.need('get_shipment', { shipment_id: sid }, `carrier status of ${sid}`));
      if (lines === undefined || ships.some((s) => s === undefined)) return incomplete(c);
      c.policies(['SOP-SOT-002'], 'shipment status desync carrier scan');
      if (c.missing.length) return incomplete(c);
      a.required_policies = ['SOP-SOT-002'];
      const valid = ships.filter(Boolean) as any[];
      if (valid.length !== 1) {
        a.detected_issue = valid.length === 0 ? `${O} has no loadable shipment to compare against` : `${O} has ${valid.length} shipments; authoritative one unclear`;
        a.policy_why['SOP-SOT-002'] = 'Carrier scans are authoritative, but only for a single unambiguous linked shipment.';
        holdOrEscalate(a, order, E, a.detected_issue, 'SOP-SOT-002');
        a.recommended_human_action = 'Identify the correct shipment for this order.';
        a.unresolved_questions.push('Which shipment physically carries this order?');
        return a;
      }
      const s = valid[0];
      const f = s.facts;
      a.findings.push(`Order ${O} status ${order.status}; shipment ${s.shipment.shipment_id} status ${s.shipment.status}`,
        `Carrier pickup scan: ${s.shipment.picked_up_at ?? 'none'}; last scan: ${s.shipment.last_scan_at ?? 'none'}`,
        `All lines fully picked: ${f.all_lines_picked} (${lines.lines.map((l: any) => `${l.sku} ${l.picked_qty}/${l.requested_qty}`).join(', ')})`,
        `Destination match: ${f.destination_match} (order ${order.destination_ref}, shipment ${s.shipment.destination_ref})`);
      if (order.status === 'PACKED' && f.has_pickup_scan && f.all_lines_picked && f.destination_match) {
        c.policies(['SOP-APR-001'], 'approval authority autonomous action boundary');
        if (c.missing.length) return incomplete(c);
        a.required_policies.push('SOP-APR-001');
        a.detected_issue = `${O} is PACKED but carrier evidence shows ${s.shipment.shipment_id} picked up and ${s.shipment.status}`;
        a.policy_why['SOP-SOT-002'] = 'All three conditions hold (pickup scan, all lines picked, destination match), so a forward sync to SHIPPED is justified by carrier evidence, not by the mere existence of a shipment record.';
        a.policy_why['SOP-APR-001'] = 'SYNC_ORDER_STATUS_FORWARD is on the autonomous list.';
        a.decision = 'AUTO_ACTION';
        a.escalate = false;
        a.outcome_label = 'AUTO_RESOLVED';
        a.actions.push({ type: 'SYNC_ORDER_STATUS_FORWARD', params: { order_id: O, shipment_id: s.shipment.shipment_id, to_status: 'SHIPPED', exception_id: E, policy_id: 'SOP-SOT-002' } });
        return a;
      }
      if (order.status === 'SHIPPED' && f.has_pickup_scan) {
        Object.assign(a, { decision: 'NO_ACTION_NEEDED', escalate: false, outcome_label: 'NO_ACTION_NEEDED' });
        a.detected_issue = 'Order and shipment agree (shipped with carrier pickup)';
        a.policy_why['SOP-SOT-002'] = 'Carrier evidence supports the current order status.';
        return a;
      }
      if (order.status === 'SHIPPED') a.conflicting_facts.push(`Order ${O} says SHIPPED, but ${s.shipment.shipment_id} is ${s.shipment.status} with no carrier scan`);
      if (!f.all_lines_picked) a.conflicting_facts.push(`Not all lines are fully picked (${lines.lines.filter((l: any) => l.picked_qty !== l.requested_qty).map((l: any) => `${l.sku} ${l.picked_qty}/${l.requested_qty}`).join(', ')}), so the order cannot have shipped complete`);
      if (!f.destination_match) a.conflicting_facts.push(`Destination mismatch: order ${order.destination_ref} vs shipment ${s.shipment.destination_ref}`);
      if (!f.has_pickup_scan && order.status !== 'SHIPPED') a.conflicting_facts.push('No carrier pickup scan to justify moving the order forward');
      a.detected_issue = `Contradictory status: order ${order.status} vs shipment ${s.shipment.status}`;
      a.policy_why['SOP-SOT-002'] = 'A shipment record alone is not evidence of shipment, and agents may never move a status backwards: the records must be preserved and escalated.';
      holdOrEscalate(a, order, E, a.detected_issue, 'SOP-SOT-002');
      a.recommended_human_action = order.status === 'SHIPPED'
        ? `Physically verify whether ${O} left the building. If not, an authorised user must correct the OMS status (backward change is prohibited for agents) and complete picking of the short line.`
        : 'Verify with the carrier and correct records manually.';
      a.unresolved_questions.push(`Did ${O} physically leave the warehouse?`, 'Who set the order to SHIPPED, and on what evidence?', 'Should the short-picked line be completed before dispatch?');
      return a;
    }

    // ================================================================= INVALID DATA
    case 'INVALID_DATA': {
      const lines = c.need('get_order_lines', { order_id: O }, 'validate quantities and timestamps');
      if (lines === undefined) return incomplete(c);
      const issues = lines?.data_issues ?? [];
      c.policies(['SOP-EXC-003'], 'invalid malformed data quantity timestamp');
      if (issues.length) c.policies(['SOP-APR-001'], 'approval authority autonomous action boundary');
      if (c.missing.length) return incomplete(c);
      a.required_policies = ['SOP-EXC-003', ...(issues.length ? ['SOP-APR-001'] : [])];
      if (!issues.length) {
        Object.assign(a, { decision: 'NO_ACTION_NEEDED', escalate: false, outcome_label: 'NO_ACTION_NEEDED' });
        a.detected_issue = 'All fields pass validation';
        a.policy_why['SOP-EXC-003'] = 'No impossible values found.';
        return a;
      }
      for (const i of issues) a.findings.push(`${i.ref} ${i.field} = ${JSON.stringify(i.value)}: ${i.problem}`);
      a.conflicting_facts.push(...issues.map((i: any) => `${i.field} has impossible value ${JSON.stringify(i.value)}`));
      a.detected_issue = `Malformed data on ${O}: ${issues.map((i: any) => i.problem).join('; ')}`;
      a.policy_why['SOP-EXC-003'] = 'The intended values are unknowable, so nothing is auto-corrected; the order is held and the exact fields are escalated.';
      a.policy_why['SOP-APR-001'] = 'HOLD_ORDER is autonomous; data correction is not an agent action.';
      holdOrEscalate(a, order, E, `Invalid data: ${issues.map((i: any) => `${i.field}=${JSON.stringify(i.value)}`).join('; ')}`, 'SOP-EXC-003');
      a.recommended_human_action = 'Confirm the intended values with the order source system and re-import or correct the order; then release the hold.';
      a.unresolved_questions.push(...issues.map((i: any) => `What is the correct value for ${i.ref} ${i.field}?`));
      return a;
    }

    // ================================================================= STALE SHIPMENT
    case 'STALE_SHIPMENT': {
      const ships = (order.linked_shipment_ids as string[]).map((sid) => c.need('get_shipment', { shipment_id: sid }, `movement history of ${sid}`));
      const pol = c.need('get_policy', { policy_id: 'SOP-EXC-004' }, 'staleness threshold (stale_after_hours)');
      if (ships.some((s) => s === undefined) || pol === undefined) return incomplete(c);
      const threshold = Number(pol?.params?.stale_after_hours ?? 48);
      a.required_policies = ['SOP-EXC-004'];
      const stale = (ships.filter(Boolean) as any[]).filter((s) => s.shipment.status === 'LABEL_CREATED' && !s.shipment.picked_up_at && s.facts && s.facts.label_age_hours > threshold);
      for (const s of ships.filter(Boolean) as any[]) a.findings.push(`${s.shipment.shipment_id}: ${s.shipment.status}, label created ${s.shipment.label_created_at} (${s.facts?.label_age_hours}h ago), pickup scan ${s.shipment.picked_up_at ?? 'none'}; stale threshold ${threshold}h`);
      if (!stale.length) {
        Object.assign(a, { decision: ships.length ? 'NO_ACTION_NEEDED' : 'ESCALATE', escalate: !ships.length, outcome_label: ships.length ? 'NO_ACTION_NEEDED' : 'ESCALATED' });
        a.detected_issue = ships.length ? 'Shipment is moving or within the staleness threshold' : `${O} has no shipment`;
        a.policy_why['SOP-EXC-004'] = `Stale means LABEL_CREATED with no scan for more than ${threshold}h.`;
        return a;
      }
      const s = stale[0];
      a.detected_issue = `${s.shipment.shipment_id} for ${O} has had no carrier scan for ${s.facts.label_age_hours}h (threshold ${threshold}h)`;
      a.policy_why['SOP-EXC-004'] = `Label age ${s.facts.label_age_hours}h exceeds ${threshold}h with no carrier scan; there is no carrier integration, so no status change is made and the case goes to the carrier liaison.`;
      a.decision = 'ESCALATE';
      a.outcome_label = 'ESCALATED';
      a.recommended_human_action = `Carrier liaison: trace ${s.shipment.tracking_ref} with ${s.shipment.carrier}; confirm whether the parcel is still in the dock area and re-tender or re-label if needed.`;
      a.unresolved_questions.push('Is the parcel physically still in the warehouse?', 'Was the pickup missed by the carrier or was the label never tendered?');
      return a;
    }

    // ================================================================= DESTINATION / WRONG LINK
    case 'DESTINATION_CONFLICT': {
      const ships = (order.linked_shipment_ids as string[]).map((sid) => c.need('get_shipment', { shipment_id: sid }, `destination on ${sid}`));
      if (ships.some((s) => s === undefined)) return incomplete(c);
      const mism = (ships.filter(Boolean) as any[]).filter((s) => s.shipment.destination_ref !== order.destination_ref);
      const others = mism.map((s) => c.need('find_orders_by_destination', { destination_ref: s.shipment.destination_ref }, 'does the shipment destination belong to another order?'));
      c.policies(['SOP-EXC-005'], 'conflicting destination shipment linked wrong order');
      if (mism.length) c.policies(['SOP-APR-001'], 'approval authority autonomous action boundary');
      if (others.some((x) => x === undefined) || c.missing.length) return incomplete(c);
      a.required_policies = ['SOP-EXC-005', ...(mism.length ? ['SOP-APR-001'] : [])];
      if (!mism.length) {
        Object.assign(a, { decision: 'NO_ACTION_NEEDED', escalate: false, outcome_label: 'NO_ACTION_NEEDED' });
        a.detected_issue = 'Order and shipment destinations agree';
        a.policy_why['SOP-EXC-005'] = 'No conflicting records.';
        return a;
      }
      const s = mism[0];
      const otherOrders = ((others[0] as any)?.orders ?? []).filter((o: any) => o.order_id !== O);
      a.findings.push(`Order ${O} destination ${order.destination_ref}; linked shipment ${s.shipment.shipment_id} destination ${s.shipment.destination_ref}`,
        otherOrders.length ? `${s.shipment.destination_ref} belongs to ${otherOrders.map((o: any) => `${o.order_id} (${o.status})`).join(', ')}` : `No other order uses ${s.shipment.destination_ref}`);
      a.conflicting_facts.push(`${s.shipment.shipment_id} is linked to ${O} but addressed to ${s.shipment.destination_ref}, not ${order.destination_ref}`);
      if (otherOrders.length) a.conflicting_facts.push(`${s.shipment.destination_ref} is the destination of ${otherOrders.map((o: any) => o.order_id).join(', ')}, which may be the shipment's true order`);
      a.detected_issue = `Ambiguous destination/link conflict between ${O} and ${s.shipment.shipment_id}`;
      a.policy_why['SOP-EXC-005'] = 'No policy says whether the order destination or the shipment destination is authoritative, so the link and both destinations are preserved, the unshipped order is held, and a human decides. Relinking is not proposed because the correct target is uncertain.';
      a.policy_why['SOP-APR-001'] = 'HOLD_ORDER is autonomous; RELINK_SHIPMENT would need approval and is not proposed while ambiguous.';
      holdOrEscalate(a, order, E, `Destination conflict with ${s.shipment.shipment_id}; do not ship until resolved`, 'SOP-EXC-005');
      a.recommended_human_action = `Verify the physical label on ${s.shipment.shipment_id} and the customer address for ${O}${otherOrders.length ? ` and ${otherOrders.map((o: any) => o.order_id).join(', ')}` : ''}; then relink or re-label (approval-gated) and release the hold.`;
      a.unresolved_questions.push(`Was ${s.shipment.shipment_id} linked to the wrong order${otherOrders.length ? ` (should it be ${otherOrders[0].order_id}?)` : ''}?`, `Did ${O}'s delivery address change after the label was created?`, 'Which parcel on the dock carries which label?');
      return a;
    }
  }
  return incomplete(c);
}
