import { describe, expect, it } from 'vitest';
import { buildPlan, urgencyBucket } from '../src/planner/engine.js';
import { at, input, inv, line, order, picker, NOW } from './fixtures.js';

const row = (plan: ReturnType<typeof buildPlan>, id: string) => plan.assignments.find((a) => a.order_id === id)!;

describe('deterministic planner', () => {
  it('never assigns work to an unavailable picker', () => {
    const plan = buildPlan(input({
      orders: [order('O1'), order('O2')], lines: [line('O1', 'S1', 10), line('O2', 'S1', 10)],
      pickers: [picker('P1', 100, { availability: 'UNAVAILABLE', unavailable_reason: 'sick' }), picker('P2', 100)],
    }));
    expect(plan.assignments.every((a) => a.picker_id !== 'P1')).toBe(true);
    expect(row(plan, 'O1').picker_id).toBe('P2');
  });

  it('marks an order INFEASIBLE when workload exceeds every picker capacity (6 + 5 > 10)', () => {
    const plan = buildPlan(input({
      orders: [order('O1', { priority: 1 }), order('O2', { priority: 2 })],
      lines: [line('O1', 'S1', 4), line('O2', 'S1', 3)], // workload 4+2=6, 3+2=5
      pickers: [picker('P1', 10)],
    }));
    expect(row(plan, 'O1').status).toBe('ASSIGNED');
    expect(row(plan, 'O2').status).toBe('INFEASIBLE');
    expect(row(plan, 'O2').block_reason).toMatch(/CAPACITY/);
    expect(plan.pickers[0].planned_minutes).toBeLessThanOrEqual(10);
  });

  it('blocks orders whose inventory is not available, allocating stock in priority order', () => {
    const plan = buildPlan(input({
      orders: [order('HI', { priority: 1 }), order('LO', { priority: 3 })],
      lines: [line('HI', 'S1', 8), line('LO', 'S1', 5)],
      pickers: [picker('P1', 500)],
      inventory: [inv('S1', 'A-01', 'A', 10), inv('S2', 'B-01', 'B', 10)],
    }));
    expect(row(plan, 'HI').status).toBe('ASSIGNED');
    expect(row(plan, 'LO').status).toBe('BLOCKED');
    expect(row(plan, 'LO').block_reason).toMatch(/S1 needs 5, 2 available/);
  });

  it('prioritises deadline urgency across buckets, explicit priority within a bucket', () => {
    const plan = buildPlan(input({
      orders: [
        order('P1_LATE', { priority: 1, deadline: at('15:30') }),
        order('P3_SOON', { priority: 3, deadline: at('09:30') }),
        order('P2_SOON', { priority: 2, deadline: at('09:45') }),
      ],
      lines: [line('P1_LATE', 'S1', 5), line('P3_SOON', 'S1', 5), line('P2_SOON', 'S1', 5)],
      pickers: [picker('P1', 500)],
    }));
    const ranked = [...plan.assignments].sort((a, b) => a.priority_rank - b.priority_rank).map((a) => a.order_id);
    expect(ranked).toEqual(['P2_SOON', 'P3_SOON', 'P1_LATE']);
    expect(urgencyBucket(NOW, at('09:00'), at('16:00'), [120, 240]).bucket).toBe(0);
    expect(urgencyBucket(NOW, at('07:00'), at('16:00'), [120, 240]).label).toBe('OVERDUE');
  });

  it('excludes ON_HOLD orders and shows the blocking exception reference', () => {
    const plan = buildPlan(input({
      orders: [order('H', { status: 'ON_HOLD', hold_prev_status: 'PENDING', hold_exception_id: 'EXC-1', hold_reason: 'shortfall' })],
      lines: [line('H', 'S1', 5)], pickers: [picker('P1', 100)],
    }));
    expect(row(plan, 'H').status).toBe('BLOCKED');
    expect(row(plan, 'H').exception_ref).toBe('EXC-1');
    expect(row(plan, 'H').picker_id).toBeNull();
  });

  it('blocks malformed data without correcting it', () => {
    const plan = buildPlan(input({ orders: [order('BAD')], lines: [line('BAD', 'S1', -3)], pickers: [picker('P1', 100)] }));
    expect(row(plan, 'BAD').status).toBe('BLOCKED');
    expect(row(plan, 'BAD').block_reason).toMatch(/INVALID_DATA.*-3/);
  });

  it('enforces skills: no available skilled picker → INFEASIBLE', () => {
    const plan = buildPlan(input({
      orders: [order('C')], lines: [line('C', 'COLD1', 2)],
      pickers: [picker('P1', 100), picker('P2', 100, { skills: ['COLD'], availability: 'UNAVAILABLE' })],
    }));
    expect(row(plan, 'C').status).toBe('INFEASIBLE');
    expect(row(plan, 'C').block_reason).toMatch(/NO_SKILLED_PICKER/);
  });

  it('keeps in-progress work with its picker and plans only remaining quantity', () => {
    const plan = buildPlan(input({
      orders: [order('IP', { status: 'PICKING', assigned_picker_id: 'P2' })],
      lines: [line('IP', 'S1', 10, 6)], pickers: [picker('P1', 100), picker('P2', 100)],
    }));
    expect(row(plan, 'IP').status).toBe('IN_PROGRESS');
    expect(row(plan, 'IP').picker_id).toBe('P2');
    expect(row(plan, 'IP').workload_minutes).toBe(4 + 2);
  });

  it('flags SLA risk instead of silently missing a deadline', () => {
    const plan = buildPlan(input({ orders: [order('LATE', { deadline: at('08:10') })], lines: [line('LATE', 'S1', 30)], pickers: [picker('P1', 100)] }));
    expect(row(plan, 'LATE').status).toBe('ASSIGNED');
    expect(row(plan, 'LATE').sla_at_risk).toBe(true);
  });

  it('is deterministic', () => {
    const mk = () => buildPlan(input({
      orders: [order('A'), order('B'), order('C', { priority: 1 })], lines: [line('A', 'S1', 5), line('B', 'S2', 5), line('C', 'S1', 5)],
      pickers: [picker('P1', 50), picker('P2', 50)],
    }));
    expect(JSON.stringify(mk())).toEqual(JSON.stringify(mk()));
  });

  it('replans incrementally: preserves completed, keeps valid work, reassigns an unavailable picker\'s work', () => {
    const base = { lines: [line('DONE', 'S1', 5, 5), line('KEEP', 'S1', 5), line('MOVE', 'S1', 5)] };
    const previous = { version: 1, assignments: [
      { order_id: 'DONE', picker_id: 'P1', sequence: 1, status: 'COMPLETED' as const, workload_minutes: 7, block_reason: null },
      { order_id: 'KEEP', picker_id: 'P1', sequence: 2, status: 'ASSIGNED' as const, workload_minutes: 7, block_reason: null },
      { order_id: 'MOVE', picker_id: 'P2', sequence: 1, status: 'ASSIGNED' as const, workload_minutes: 7, block_reason: null },
    ] };
    const plan = buildPlan(input({
      ...base, previous,
      orders: [order('DONE', { status: 'PICKED' }), order('KEEP'), order('MOVE')],
      pickers: [picker('P1', 100), picker('P2', 100, { availability: 'UNAVAILABLE', unavailable_reason: 'sick' }), picker('P3', 100)],
    }));
    expect(row(plan, 'DONE').change_type).toBe('COMPLETED_KEPT');
    expect(row(plan, 'KEEP').picker_id).toBe('P1'); // stickiness
    expect(row(plan, 'MOVE').picker_id).not.toBe('P2');
    expect(row(plan, 'MOVE').change_type).toBe('REASSIGNED');
    expect(plan.change_log.find((c) => c.order_id === 'MOVE')!.reason).toMatch(/P2 became unavailable/);
    expect(plan.metrics!.preserved).toBeGreaterThanOrEqual(2);
  });
});

describe('local-search optimizer (optional strategy)', () => {
  // Greedy puts O1 on P2 (nearest zone), leaving the COLD order O2 — which only P2 can pick — late.
  const scenario = (strategy: 'greedy' | 'local_search') => buildPlan(input({
    strategy,
    orders: [order('O1', { priority: 1, deadline: at('09:30') }), order('O2', { priority: 3, deadline: at('08:40') })],
    lines: [line('O1', 'S1', 28), line('O2', 'COLD1', 28)],
    pickers: [picker('P1', 200, { home_zone: 'C' }), picker('P2', 200, { home_zone: 'A', skills: ['STANDARD', 'COLD'] })],
  }));

  it('greedy leaves an SLA risk that local search removes without breaking constraints', () => {
    const g = scenario('greedy');
    expect(row(g, 'O1').picker_id).toBe('P2');
    expect(row(g, 'O2').sla_at_risk).toBe(true);
    const o = scenario('local_search');
    expect(row(o, 'O1').picker_id).toBe('P1');
    expect(row(o, 'O2').picker_id).toBe('P2');
    expect(o.summary.sla_at_risk).toBe(0);
    expect(o.summary.optimizer!.before.sla_at_risk).toBe(1);
    expect(o.summary.optimizer!.after.sla_at_risk).toBe(0);
    expect(row(o, 'O1').rationale).toMatch(/Optimizer \(local search\): moved P2 → P1/);
  });

  it('never moves in-progress work, never violates capacity or skills, keeps the same orders assigned', () => {
    const mk = (strategy: 'greedy' | 'local_search') => buildPlan(input({
      strategy,
      orders: [order('IP', { status: 'PICKING', assigned_picker_id: 'P1' }), order('A', { priority: 1 }), order('B'), order('C'), order('D', { priority: 3 })],
      lines: [line('IP', 'S1', 20, 5), line('A', 'S1', 30), line('B', 'S2', 10), line('C', 'S1', 25), line('D', 'COLD1', 10)],
      pickers: [picker('P1', 80), picker('P2', 60), picker('P3', 60, { skills: ['STANDARD', 'COLD'] })],
    }));
    const g = mk('greedy');
    const o = mk('local_search');
    expect(row(o, 'IP').picker_id).toBe('P1');
    expect(o.pickers.every((p) => p.planned_minutes <= p.remaining_capacity_minutes)).toBe(true);
    expect(row(o, 'D').picker_id).toBe('P3');
    const assigned = (p: ReturnType<typeof buildPlan>) => p.assignments.filter((a) => a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS').map((a) => a.order_id).sort();
    expect(assigned(o)).toEqual(assigned(g));
    const ob = o.summary.optimizer!;
    const lex = (x: typeof ob.after) => [x.sla_at_risk, x.lateness_min, x.churn, x.makespan_min];
    const cmp = lex(ob.after).map((v, i) => v - lex(ob.before)[i]).find((d) => d !== 0) ?? 0;
    expect(cmp).toBeLessThanOrEqual(0); // never worse
    if (ob.moves.length) expect(cmp).toBeLessThan(0); // every accepted move strictly improves
    expect(JSON.stringify(mk('local_search'))).toEqual(JSON.stringify(o)); // deterministic
  });
});
