/**
 * Optional local-search improvement over the greedy plan (SOP-PLN-002 `strategy: local_search`).
 *
 * - Only UN-STARTED (ASSIGNED) work moves. In-progress, completed, blocked and infeasible
 *   rows are fixed. Hard constraints are re-checked for every move: picker AVAILABLE,
 *   has all required skills, total load <= remaining capacity.
 * - Queues keep priority-rank order, so the SOP-PLN-001 sequencing policy is preserved.
 * - Objective (lexicographic, lower is better):
 *     1. number of orders at SLA risk
 *     2. total lateness (minutes past deadline)
 *     3. churn — un-started orders moved away from their previous-version picker (replans only)
 *     4. makespan — the latest finishing picker (balances load)
 * - Moves: relocate one order, or swap two orders between pickers. Best-improvement,
 *   deterministic tie-breaks (order id, picker id), bounded iterations.
 */
import type { Picker } from '../domain/types.js';
import type { PlannedAssignment } from './engine.js';

export interface Objective { sla_at_risk: number; lateness_min: number; churn: number; makespan_min: number }
export interface OptimizerReport {
  strategy: 'local_search';
  before: Objective;
  after: Objective;
  iterations: number;
  moves: Array<{ kind: 'relocate' | 'swap'; order_id: string; from: string; to: string; other_order_id?: string; improvement: string }>;
}

type P = Picker & { consumed_minutes: number };
const MAX_ITER = 60;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function localSearch(rows: PlannedAssignment[], ctx: { pickers: P[]; simNow: string; prevPicker: Map<string, string | null> }): OptimizerReport {
  const active = rows.filter((a) => a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS');
  const movable = active.filter((a) => a.status === 'ASSIGNED').sort((a, b) => a.order_id.localeCompare(b.order_id));
  const pickers = ctx.pickers.filter((p) => p.availability === 'AVAILABLE').sort((a, b) => a.picker_id.localeCompare(b.picker_id));
  const cap = new Map(ctx.pickers.map((p) => [p.picker_id, Math.max(0, p.capacity_minutes - p.consumed_minutes)]));
  const now = new Date(ctx.simNow).getTime();
  const assign = new Map(active.map((a) => [a.order_id, a.picker_id!]));
  const byId = new Map(active.map((a) => [a.order_id, a]));

  const evaluate = (m: Map<string, string>): Objective | null => {
    let sla = 0, late = 0, churn = 0, makespan = 0;
    for (const p of pickers) {
      const q = active.filter((a) => m.get(a.order_id) === p.picker_id)
        .sort((a, b) => (a.status === 'IN_PROGRESS' ? 0 : 1) - (b.status === 'IN_PROGRESS' ? 0 : 1) || a.priority_rank - b.priority_rank);
      let t = 0;
      for (const a of q) {
        t += a.workload_minutes;
        const over = (now + t * 60000 - new Date(a.deadline).getTime()) / 60000;
        if (over > 0) { sla++; late += over; }
      }
      if (t > cap.get(p.picker_id)!) return null; // capacity violated
      makespan = Math.max(makespan, t);
    }
    for (const a of movable) {
      const prev = ctx.prevPicker.get(a.order_id);
      if (prev && prev !== m.get(a.order_id)) churn++;
    }
    return { sla_at_risk: sla, lateness_min: r2(late), churn, makespan_min: r2(makespan) };
  };
  const better = (x: Objective, y: Objective) =>
    x.sla_at_risk - y.sla_at_risk || x.lateness_min - y.lateness_min || x.churn - y.churn || x.makespan_min - y.makespan_min;
  const canTake = (p: P, a: PlannedAssignment) => (a.required_skills ?? []).every((s) => p.skills.includes(s));

  const start = evaluate(assign)!;
  let cur = start;
  const moves: OptimizerReport['moves'] = [];
  let it = 0;
  for (; it < MAX_ITER; it++) {
    let best: { obj: Objective; apply: () => void; move: OptimizerReport['moves'][number] } | null = null;
    const consider = (m: Map<string, string>, move: OptimizerReport['moves'][number]) => {
      const obj = evaluate(m);
      if (!obj || better(obj, cur) >= 0) return;
      if (!best || better(obj, best.obj) < 0) best = { obj, apply: () => { for (const [k, v] of m) assign.set(k, v); }, move };
    };
    for (const a of movable) {
      const from = assign.get(a.order_id)!;
      for (const p of pickers) {
        if (p.picker_id === from || !canTake(p, a)) continue;
        const m = new Map(assign); m.set(a.order_id, p.picker_id);
        consider(m, { kind: 'relocate', order_id: a.order_id, from, to: p.picker_id, improvement: '' });
      }
      for (const b of movable) {
        const to = assign.get(b.order_id)!;
        if (b.order_id <= a.order_id || to === from) continue;
        const pa = pickers.find((x) => x.picker_id === to)!, pb = pickers.find((x) => x.picker_id === from)!;
        if (!canTake(pa, a) || !canTake(pb, b)) continue;
        const m = new Map(assign); m.set(a.order_id, to); m.set(b.order_id, from);
        consider(m, { kind: 'swap', order_id: a.order_id, from, to, other_order_id: b.order_id, improvement: '' });
      }
    }
    if (!best) break;
    const chosen = best as { obj: Objective; apply: () => void; move: OptimizerReport['moves'][number] };
    chosen.move.improvement = describe(cur, chosen.obj);
    chosen.apply();
    moves.push(chosen.move);
    cur = chosen.obj;
  }

  // write back + explain
  for (const mv of moves) {
    const note = mv.kind === 'relocate'
      ? `Optimizer (local search): moved ${mv.from} → ${mv.to} (${mv.improvement}).`
      : `Optimizer (local search): swapped with ${mv.other_order_id} (${mv.from} → ${mv.to}; ${mv.improvement}).`;
    const a = byId.get(mv.order_id)!;
    a._optNote = [a._optNote, note].filter(Boolean).join(' ');
    if (mv.other_order_id) {
      const b = byId.get(mv.other_order_id)!;
      b._optNote = [b._optNote, `Optimizer (local search): swapped with ${mv.order_id} (${mv.improvement}).`].filter(Boolean).join(' ');
    }
  }
  for (const a of movable) a.picker_id = assign.get(a.order_id)!;
  return { strategy: 'local_search', before: start, after: cur, iterations: it, moves };
}

function describe(a: Objective, b: Objective): string {
  if (b.sla_at_risk < a.sla_at_risk) return `SLA-risk orders ${a.sla_at_risk} → ${b.sla_at_risk}`;
  if (b.lateness_min < a.lateness_min) return `total lateness ${a.lateness_min} → ${b.lateness_min} min`;
  if (b.churn < a.churn) return `fewer reassignments ${a.churn} → ${b.churn}`;
  return `makespan ${a.makespan_min} → ${b.makespan_min} min`;
}
