/**
 * Deterministic shift planner (pure function; no I/O, no LLM).
 *
 * Implements SOP-PLN-001 / SOP-PLN-002 / SOP-PLN-003 exactly as written in
 * docs/PHASE_0_DESIGN.md §5. All arithmetic, capacity and feasibility checks live here.
 */
import { computeWorkload, round2, validateOrderData, zoneDistance, type Workload } from '../domain/rules.js';
import type { InventoryRow, Order, OrderLine, Picker, Sku } from '../domain/types.js';

export type AssignmentStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED' | 'INFEASIBLE';

export interface PlanParams {
  urgency_bucket_minutes: number[]; // e.g. [120, 240]
  plannable_statuses: string[];
  minutes_per_location: number;
  minutes_per_extra_zone: number;
}

export interface PrevAssignment {
  order_id: string;
  picker_id: string | null;
  sequence: number | null;
  status: AssignmentStatus;
  workload_minutes: number;
  block_reason: string | null;
}

export interface PlannerInput {
  simNow: string;
  shiftEnd: string;
  orders: Order[];
  lines: OrderLine[];
  skus: Map<string, Sku>;
  inventory: InventoryRow[];
  /** capacity_minutes minus minutes already consumed this shift */
  pickers: Array<Picker & { consumed_minutes: number }>;
  openExceptions: Array<{ exception_id: string; order_id: string; type: string; status: string }>;
  params: PlanParams;
  previous?: { version: number; assignments: PrevAssignment[] } | null;
}

export interface PlannedAssignment {
  order_id: string;
  picker_id: string | null;
  sequence: number | null;
  priority_rank: number;
  status: AssignmentStatus;
  workload_minutes: number;
  est_start: string | null;
  est_finish: string | null;
  deadline: string;
  sla_at_risk: boolean;
  inventory_readiness: string;
  primary_zone: string | null;
  zones: string[];
  rationale: string;
  block_reason: string | null;
  exception_ref: string | null;
  warnings: string[];
  change_type?: string;
  change_reason?: string;
}

export interface PickerSummary {
  picker_id: string;
  availability: string;
  remaining_capacity_minutes: number;
  planned_minutes: number;
  utilization_pct: number;
  orders: string[];
}

export interface PlanResult {
  assignments: PlannedAssignment[];
  pickers: PickerSummary[];
  summary: {
    orders_considered: number;
    assigned: number;
    in_progress: number;
    completed: number;
    blocked: number;
    infeasible: number;
    sla_at_risk: number;
    total_planned_minutes: number;
  };
  change_log: Array<{ order_id: string; change_type: string; from: string; to: string; reason: string }>;
  metrics?: { preserved: number; changed: number };
}

const HHMM = (iso: string) => iso.slice(11, 16);
const addMin = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60000).toISOString();
const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;

export function urgencyBucket(simNow: string, deadline: string, shiftEnd: string, thresholds: number[]): { bucket: number; label: string } {
  const m = minutesBetween(simNow, deadline);
  if (m <= 0) return { bucket: 0, label: 'OVERDUE' };
  if (m <= thresholds[0]) return { bucket: 0, label: `due within ${thresholds[0] / 60}h` };
  if (m <= thresholds[1]) return { bucket: 1, label: `due within ${thresholds[1] / 60}h` };
  if (new Date(deadline) <= new Date(shiftEnd)) return { bucket: 2, label: 'due this shift' };
  return { bucket: 3, label: 'due after shift' };
}

interface Candidate {
  order: Order;
  lines: OrderLine[];
  wl: Workload;
  pinnedPicker: string | null;
  bucket: number;
  bucketLabel: string;
}

export function buildPlan(input: PlannerInput): PlanResult {
  const { simNow, shiftEnd, params } = input;
  const linesBy = new Map<string, OrderLine[]>();
  for (const l of input.lines) linesBy.set(l.order_id, [...(linesBy.get(l.order_id) ?? []), l]);
  const pickerBy = new Map(input.pickers.map((p) => [p.picker_id, p]));
  const prevBy = new Map((input.previous?.assignments ?? []).map((a) => [a.order_id, a]));
  const openExcBy = new Map<string, string[]>();
  for (const e of input.openExceptions) openExcBy.set(e.order_id, [...(openExcBy.get(e.order_id) ?? []), e.exception_id]);

  const out: PlannedAssignment[] = [];
  const candidates: Candidate[] = [];

  const base = (o: Order, wl: Workload | null): Omit<PlannedAssignment, 'status' | 'rationale' | 'priority_rank'> => ({
    order_id: o.order_id, picker_id: null, sequence: null, workload_minutes: wl?.minutes ?? 0, est_start: null, est_finish: null,
    deadline: o.deadline, sla_at_risk: false, inventory_readiness: 'N/A', primary_zone: wl?.primary_zone ?? null, zones: wl?.zones ?? [],
    block_reason: null, exception_ref: null, warnings: [],
  });

  // ---- Step 1: eligibility gates -------------------------------------------------
  for (const o of input.orders) {
    const lines = linesBy.get(o.order_id) ?? [];
    const prev = prevBy.get(o.order_id);
    if (['PICKED', 'PACKED', 'SHIPPED'].includes(o.status)) {
      if (prev) out.push({ ...base(o, null), picker_id: prev.picker_id, sequence: prev.sequence, workload_minutes: prev.workload_minutes, status: 'COMPLETED', priority_rank: 0, inventory_readiness: 'PICKED', rationale: `Picking completed (order ${o.status}); preserved from v${input.previous!.version}.` });
      continue;
    }
    if (o.status === 'CANCELLED') continue;
    if (o.status === 'ON_HOLD') {
      out.push({ ...base(o, null), status: 'BLOCKED', priority_rank: 0, block_reason: `ON_HOLD: ${o.hold_reason ?? 'no reason recorded'}`, exception_ref: o.hold_exception_id, rationale: `Not schedulable: order is on hold${o.hold_exception_id ? ` (blocked by ${o.hold_exception_id})` : ''} per SOP-PLN-001.` });
      continue;
    }
    if (!params.plannable_statuses.includes(o.status)) continue;
    const issues = validateOrderData(o, lines);
    if (issues.length) {
      out.push({ ...base(o, null), status: 'BLOCKED', priority_rank: 0, block_reason: `INVALID_DATA: ${issues.map((i) => `${i.field}=${JSON.stringify(i.value)} (${i.problem})`).join('; ')}`, exception_ref: openExcBy.get(o.order_id)?.[0] ?? null, rationale: 'Not schedulable: malformed order data is never auto-corrected (SOP-EXC-003).' });
      continue;
    }
    const wl = computeWorkload(lines, input.skus, input.inventory, params);
    const pinned = o.status === 'PICKING' && o.assigned_picker_id && pickerBy.get(o.assigned_picker_id)?.availability === 'AVAILABLE' ? o.assigned_picker_id : null;
    const b = urgencyBucket(simNow, o.deadline, shiftEnd, params.urgency_bucket_minutes);
    candidates.push({ order: o, lines, wl, pinnedPicker: pinned, bucket: b.bucket, bucketLabel: b.label });
  }

  // ---- Step 2: priority order ------------------------------------------------------
  candidates.sort((a, b) =>
    (a.pinnedPicker ? 0 : 1) - (b.pinnedPicker ? 0 : 1) ||
    a.bucket - b.bucket ||
    a.order.priority - b.order.priority ||
    a.order.deadline.localeCompare(b.order.deadline) ||
    a.order.created_at.localeCompare(b.order.created_at) ||
    a.order.order_id.localeCompare(b.order.order_id));

  // ---- Step 3: inventory allocation + assignment ------------------------------------
  const stock = new Map<string, number>();
  for (const r of input.inventory) stock.set(r.sku, (stock.get(r.sku) ?? 0) + Math.max(0, r.available));
  const load = new Map<string, number>(input.pickers.map((p) => [p.picker_id, 0]));
  const zoneOf = new Map<string, string>(input.pickers.map((p) => [p.picker_id, p.home_zone]));
  const seq = new Map<string, number>();
  // continue per-picker numbering after completed work so unchanged items keep their sequence
  for (const a of out) if (a.status === 'COMPLETED' && a.picker_id && a.sequence) seq.set(a.picker_id, Math.max(seq.get(a.picker_id) ?? 0, a.sequence));
  const remainingCap = (p: Picker & { consumed_minutes: number }) => Math.max(0, p.capacity_minutes - p.consumed_minutes);

  let rank = 0;
  for (const c of candidates) {
    rank++;
    const o = c.order;
    const warnings: string[] = [];
    const excs = openExcBy.get(o.order_id);
    if (excs?.length) warnings.push(`Open exception ${excs.join(', ')} not yet resolved — order is schedulable only because it is not on hold.`);
    const picked = c.lines.reduce((s, l) => s + l.picked_qty, 0);
    if (picked > 0) warnings.push(`Existing progress preserved: ${picked} unit(s) already picked; only remaining work planned.`);

    // inventory readiness (allocated in priority order)
    const shortages: string[] = [];
    const need = new Map<string, number>();
    for (const l of c.lines) need.set(l.sku, (need.get(l.sku) ?? 0) + Math.max(0, l.requested_qty - l.picked_qty));
    for (const [sku, n] of need) {
      const have = stock.get(sku) ?? 0;
      if (n > have) shortages.push(`${sku} needs ${n}, ${have} available after higher-priority allocations`);
    }
    const head = `Rank ${rank}: ${c.bucketLabel} (${HHMM(o.deadline)}), priority P${o.priority}`;
    if (shortages.length) {
      out.push({ ...base(o, c.wl), status: 'BLOCKED', priority_rank: rank, inventory_readiness: `SHORT: ${shortages.join('; ')}`, block_reason: `INVENTORY_NOT_READY: ${shortages.join('; ')}`, exception_ref: excs?.[0] ?? null, warnings, rationale: `${head}. Not schedulable: inventory not ready (SOP-PLN-002). Raise/resolve an inventory exception before release.` });
      continue;
    }
    for (const [sku, n] of need) stock.set(sku, (stock.get(sku) ?? 0) - n);

    const w = c.wl.minutes;
    const prev = prevBy.get(o.order_id);

    // pinned in-progress work stays with its picker (Step 0)
    if (c.pinnedPicker) {
      const p = pickerBy.get(c.pinnedPicker)!;
      const start = load.get(p.picker_id)!;
      load.set(p.picker_id, start + w);
      seq.set(p.picker_id, (seq.get(p.picker_id) ?? 0) + 1);
      zoneOf.set(p.picker_id, c.wl.primary_zone ?? zoneOf.get(p.picker_id)!);
      const finish = addMin(simNow, start + w);
      const overCap = start + w > remainingCap(p);
      if (overCap) warnings.push(`In-progress work exceeds ${p.picker_id}'s remaining capacity (${remainingCap(p)} min).`);
      out.push({
        ...base(o, c.wl), picker_id: p.picker_id, sequence: seq.get(p.picker_id)!, priority_rank: rank, status: 'IN_PROGRESS',
        est_start: addMin(simNow, start), est_finish: finish, sla_at_risk: finish > o.deadline, inventory_readiness: 'READY', warnings,
        rationale: `${head}. In progress with ${p.picker_id}; kept with the same picker (SOP-PLN-001 / SOP-PLN-003). Remaining ${w} min, est. finish ${HHMM(finish)}${finish > o.deadline ? ' — AFTER deadline (SLA risk)' : ''}.`,
      });
      continue;
    }

    // candidate pickers: available + skilled + capacity (hard constraints)
    const skilled = input.pickers.filter((p) => c.wl.required_skills.every((s) => p.skills.includes(s)));
    const skilledAvail = skilled.filter((p) => p.availability === 'AVAILABLE');
    if (skilledAvail.length === 0) {
      const who = skilled.map((p) => `${p.picker_id} (${p.availability}${p.unavailable_reason ? `: ${p.unavailable_reason}` : ''})`).join(', ') || 'nobody';
      out.push({ ...base(o, c.wl), status: 'INFEASIBLE', priority_rank: rank, inventory_readiness: 'READY', warnings, block_reason: `NO_SKILLED_PICKER: requires ${c.wl.required_skills.join('+')}; held by ${who}`, rationale: `${head}. Infeasible: no available picker has skill ${c.wl.required_skills.join('+')} (SOP-PLN-002).` });
      for (const [sku, n] of need) stock.set(sku, (stock.get(sku) ?? 0) + n); // release allocation
      continue;
    }
    const feasible = skilledAvail.filter((p) => load.get(p.picker_id)! + w <= remainingCap(p));
    if (feasible.length === 0) {
      const best = skilledAvail.map((p) => `${p.picker_id} has ${round2(remainingCap(p) - load.get(p.picker_id)!)} min free of ${remainingCap(p)}`).join('; ');
      out.push({ ...base(o, c.wl), status: 'INFEASIBLE', priority_rank: rank, inventory_readiness: 'READY', warnings, block_reason: `CAPACITY: needs ${w} min; ${best}. Orders are not split across pickers.`, rationale: `${head}. Infeasible under capacity constraints: workload ${w} min exceeds every eligible picker's free capacity (SOP-PLN-002).` });
      for (const [sku, n] of need) stock.set(sku, (stock.get(sku) ?? 0) + n);
      continue;
    }
    const scored = feasible.map((p) => {
      const start = load.get(p.picker_id)!;
      const finish = addMin(simNow, start + w);
      return { p, start, finish, meets: finish <= o.deadline, sticky: prev?.picker_id === p.picker_id, dist: zoneDistance(zoneOf.get(p.picker_id)!, c.wl.primary_zone ?? p.home_zone) };
    }).sort((a, b) =>
      Number(b.meets) - Number(a.meets) ||
      Number(b.sticky) - Number(a.sticky) ||
      a.finish.localeCompare(b.finish) ||
      a.dist - b.dist ||
      a.p.picker_id.localeCompare(b.p.picker_id));
    const pick = scored[0];
    load.set(pick.p.picker_id, pick.start + w);
    seq.set(pick.p.picker_id, (seq.get(pick.p.picker_id) ?? 0) + 1);
    zoneOf.set(pick.p.picker_id, c.wl.primary_zone ?? zoneOf.get(pick.p.picker_id)!);
    const why = [
      pick.meets ? `finishes ${HHMM(pick.finish)} before deadline ${HHMM(o.deadline)}` : `no picker can finish before ${HHMM(o.deadline)}; earliest finish ${HHMM(pick.finish)} — SLA AT RISK`,
      pick.sticky ? 'kept previous picker (stability)' : null,
      `zone distance ${pick.dist}`,
      `load ${round2(pick.start + w)}/${remainingCap(pick.p)} min`,
    ].filter(Boolean).join('; ');
    out.push({
      ...base(o, c.wl), picker_id: pick.p.picker_id, sequence: seq.get(pick.p.picker_id)!, priority_rank: rank, status: 'ASSIGNED',
      est_start: addMin(simNow, pick.start), est_finish: pick.finish, sla_at_risk: !pick.meets, inventory_readiness: 'READY', warnings,
      rationale: `${head}. Assigned ${pick.p.picker_id}: ${why}. Workload ${w} min (${c.wl.pick_minutes} pick + ${c.wl.travel_minutes} travel over ${c.wl.locations.join(', ')}).`,
    });
  }

  const pickers: PickerSummary[] = input.pickers.map((p) => {
    const planned = round2(load.get(p.picker_id) ?? 0);
    const cap = remainingCap(p);
    return {
      picker_id: p.picker_id, availability: p.availability, remaining_capacity_minutes: cap, planned_minutes: planned,
      utilization_pct: cap > 0 ? Math.round((planned / cap) * 100) : 0,
      orders: out.filter((a) => a.picker_id === p.picker_id && (a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS')).sort((a, b) => a.sequence! - b.sequence!).map((a) => a.order_id),
    };
  });

  const assignments = out.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.priority_rank - b.priority_rank || a.order_id.localeCompare(b.order_id));
  const count = (s: AssignmentStatus) => assignments.filter((a) => a.status === s).length;
  const result: PlanResult = {
    assignments,
    pickers,
    summary: {
      orders_considered: assignments.length,
      assigned: count('ASSIGNED'), in_progress: count('IN_PROGRESS'), completed: count('COMPLETED'),
      blocked: count('BLOCKED'), infeasible: count('INFEASIBLE'),
      sla_at_risk: assignments.filter((a) => a.sla_at_risk).length,
      total_planned_minutes: round2(pickers.reduce((s, p) => s + p.planned_minutes, 0)),
    },
    change_log: [],
  };
  if (input.previous) diffAgainst(result, input.previous, pickerBy);
  return result;
}

const statusOrder = (s: AssignmentStatus) => ({ COMPLETED: 0, IN_PROGRESS: 1, ASSIGNED: 2, BLOCKED: 3, INFEASIBLE: 4 })[s];

/** SOP-PLN-003: record, per order, what changed relative to the previous version and why. */
function diffAgainst(result: PlanResult, previous: NonNullable<PlannerInput['previous']>, pickerBy: Map<string, Picker>) {
  const prevBy = new Map(previous.assignments.map((a) => [a.order_id, a]));
  const desc = (a: { status: string; picker_id: string | null; sequence: number | null } | undefined) =>
    !a ? '—' : a.picker_id ? `${a.status} ${a.picker_id}#${a.sequence}` : a.status;
  let preserved = 0;
  let changed = 0;
  for (const a of result.assignments) {
    const p = prevBy.get(a.order_id);
    let type: string;
    let reason: string;
    if (!p) { type = 'NEW'; reason = a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS' ? 'Order entered the plan (new or newly eligible).' : a.block_reason ?? 'Newly listed.'; }
    else if (a.status === 'COMPLETED') { type = 'COMPLETED_KEPT'; reason = 'Completed work is never changed.'; }
    else if (a.status === 'IN_PROGRESS' && p.picker_id === a.picker_id) { type = 'IN_PROGRESS_KEPT'; reason = `Still being picked by ${a.picker_id}.`; }
    else if ((a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS') && (p.status === 'ASSIGNED' || p.status === 'IN_PROGRESS')) {
      if (p.picker_id === a.picker_id) {
        type = p.sequence === a.sequence ? 'KEPT' : 'RESEQUENCED';
        reason = type === 'KEPT' ? 'Still valid and feasible with the same picker.' : `Same picker, sequence ${p.sequence} → ${a.sequence} after higher-priority changes.`;
      } else {
        const prevPicker = p.picker_id ? pickerBy.get(p.picker_id) : undefined;
        const inProg = p.status === 'IN_PROGRESS';
        type = inProg ? 'PROGRESS_PRESERVED_REASSIGNED' : 'REASSIGNED';
        reason = prevPicker && prevPicker.availability !== 'AVAILABLE'
          ? `${p.picker_id} became unavailable (${prevPicker.unavailable_reason ?? 'no reason'}); ${inProg ? 'picked quantities preserved, remaining work ' : ''}moved to ${a.picker_id}.`
          : `Moved ${p.picker_id} → ${a.picker_id} to fit capacity/deadline after higher-priority changes.`;
      }
    } else if (a.status === 'BLOCKED' || a.status === 'INFEASIBLE') {
      if (p.status === a.status) {
        type = 'UNCHANGED';
        reason = p.block_reason === a.block_reason ? 'Still not schedulable for the same reason.' : `Still ${a.status}; details updated: ${a.block_reason}`;
      } else { type = a.status === 'BLOCKED' ? 'NEWLY_BLOCKED' : 'NEWLY_INFEASIBLE'; reason = a.block_reason ?? a.rationale; }
    } else { type = 'UNBLOCKED'; reason = `Previously ${p.status}; now feasible.`; }
    a.change_type = type;
    a.change_reason = reason;
    if (['KEPT', 'COMPLETED_KEPT', 'IN_PROGRESS_KEPT', 'UNCHANGED'].includes(type)) preserved++;
    else changed++;
    if (type !== 'UNCHANGED' && type !== 'COMPLETED_KEPT' && type !== 'KEPT' && type !== 'IN_PROGRESS_KEPT') {
      result.change_log.push({ order_id: a.order_id, change_type: type, from: desc(p), to: desc(a), reason });
    }
  }
  for (const p of previous.assignments) {
    if (!result.assignments.some((a) => a.order_id === p.order_id)) {
      changed++;
      result.change_log.push({ order_id: p.order_id, change_type: 'REMOVED', from: desc(p), to: '—', reason: 'Order no longer plannable (cancelled).' });
    }
  }
  result.metrics = { preserved, changed };
}
