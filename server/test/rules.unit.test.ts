import { describe, expect, it } from 'vitest';
import { effectiveAvailability, isProbableDuplicate, transitionAllowed, isForward, validateOrderData, shipmentFacts } from '../src/domain/rules.js';
import { scorePolicies } from '../src/policy/retrieval.js';
import { sanitize } from '../src/audit/audit.js';
import sop from '../src/policy/sop.json' with { type: 'json' };
import { at, inv, line, order } from './fixtures.js';

describe('domain rules', () => {
  it('state transitions are explicit', () => {
    expect(transitionAllowed('PENDING', 'CANCELLED')).toBe(true);
    expect(transitionAllowed('SHIPPED', 'PACKED')).toBe(false);
    expect(transitionAllowed('PICKING', 'SHIPPED')).toBe(false);
    expect(isForward('PACKED', 'SHIPPED')).toBe(true);
    expect(isForward('SHIPPED', 'PACKED')).toBe(false);
  });

  it('detects malformed data', () => {
    const issues = validateOrderData(order('X', { created_at: at('09:00'), deadline: at('08:00') }), [line('X', 'S1', -3), line('X', 'S1', 2, 5, 2)]);
    expect(issues.map((i) => i.field)).toEqual(['orders.created_at', 'order_lines.requested_qty', 'order_lines.picked_qty']);
  });

  it('newer lower cycle count supersedes system stock; never raises it', () => {
    const rows = [{ ...inv('S', 'L1', 'A', 14), last_updated: at('06:00') }];
    const lower = effectiveAvailability('S', rows, [{ count_id: 'C', sku: 'S', location_id: 'L1', counted_qty: 5, counted_at: at('07:30'), counted_by: 'x' }]);
    expect(lower.effective_available).toBe(5);
    expect(lower.count_supersedes_system).toBe(true);
    const higher = effectiveAvailability('S', rows, [{ count_id: 'C', sku: 'S', location_id: 'L1', counted_qty: 99, counted_at: at('07:30'), counted_by: 'x' }]);
    expect(higher.effective_available).toBe(14);
    const older = effectiveAvailability('S', rows, [{ count_id: 'C', sku: 'S', location_id: 'L1', counted_qty: 1, counted_at: at('05:00'), counted_by: 'x' }]);
    expect(older.effective_available).toBe(14);
  });

  it('duplicate criteria require all four conditions', () => {
    const a = order('A', { customer_ref: 'C1', destination_ref: 'D1', created_at: at('07:20') });
    const b = order('B', { customer_ref: 'C1', destination_ref: 'D1', created_at: at('07:23') });
    expect(isProbableDuplicate(a, [line('A', 'S1', 3)], b, [line('B', 'S1', 3)], 30).match).toBe(true);
    expect(isProbableDuplicate(a, [line('A', 'S1', 3)], b, [line('B', 'S1', 4)], 30).match).toBe(false);
    expect(isProbableDuplicate(a, [line('A', 'S1', 3)], { ...b, created_at: at('08:30') }, [line('B', 'S1', 3)], 30).match).toBe(false);
  });

  it('shipment facts: label alone is not a pickup', () => {
    const o = order('O', { destination_ref: 'D1' });
    const f = shipmentFacts(o, [line('O', 'S1', 2, 2)], { shipment_id: 'S', order_id: 'O', status: 'LABEL_CREATED', carrier: 'c', tracking_ref: 't', destination_ref: 'D1', label_created_at: at('06:00'), picked_up_at: null, last_scan_at: null }, at('08:00'));
    expect(f).toMatchObject({ has_pickup_scan: false, all_lines_picked: true, destination_match: true, label_age_hours: 2 });
  });
});

describe('shared policy retrieval', () => {
  const top = (q: string, wf?: string) => scorePolicies(sop as any, q, wf)[0]?.policy_id;
  it('retrieves the governing SOP by keywords', () => {
    expect(top('inventory shortfall cycle count stock hold')).toBe('SOP-SOT-001');
    expect(scorePolicies(sop as any, 'inventory shortfall cycle count stock hold').map((h) => h.policy_id)).toContain('SOP-EXC-001');
    expect(top('duplicate order cancel approval')).toBe('SOP-EXC-002');
    expect(top('stale shipment no scan carrier')).toBe('SOP-EXC-004');
    expect(top('conflicting destination shipment linked wrong order')).toBe('SOP-EXC-005');
    expect(top('approval authority autonomous action boundary')).toBe('SOP-APR-001');
    expect(top('planning priority deadline capacity picker replanning', 'shift_planner')).toMatch(/SOP-PLN/);
  });
  it('surfaces a policy gap instead of inventing one', () => {
    expect(scorePolicies(sop as any, 'zzz qqq')).toEqual([]);
  });
  it('both workflows read the same store', () => {
    const shared = (sop as any[]).filter((p) => p.applies_to.includes('exception_resolver') && p.applies_to.includes('shift_planner'));
    expect(shared.map((p) => p.policy_id)).toEqual(expect.arrayContaining(['SOP-SOT-001', 'SOP-EXC-001', 'SOP-APR-001']));
  });
});

describe('audit sanitisation', () => {
  it('redacts secret-looking keys', () => {
    expect(sanitize({ api_key: 'x', nested: { password: 'y', ok: 1 } })).toEqual({ api_key: '[redacted]', nested: { password: '[redacted]', ok: 1 } });
  });
});
