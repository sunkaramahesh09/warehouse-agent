import type { InventoryRow, Order, OrderLine, Picker, Sku } from '../src/domain/types.js';
import type { PlannerInput } from '../src/planner/engine.js';

export const NOW = '2026-10-01T08:00:00.000Z';
export const at = (hhmm: string) => `2026-10-01T${hhmm}:00.000Z`;

export const sku = (id: string, ppu = 1, skill: string | null = null): Sku => ({ sku: id, description: id, pick_minutes_per_unit: ppu, required_skill: skill });
export const inv = (s: string, loc: string, zone: string, available: number): InventoryRow => ({ sku: s, location_id: loc, zone, x: 0, on_hand: available, reserved: 0, available, last_updated: at('06:00') });
export const picker = (id: string, cap: number, opts: Partial<Picker & { consumed_minutes: number }> = {}) => ({
  picker_id: id, display_name: id, availability: 'AVAILABLE' as const, unavailable_reason: null, capacity_minutes: cap, home_zone: 'A', skills: ['STANDARD'], consumed_minutes: 0, ...opts,
});
export const order = (id: string, o: Partial<Order> = {}): Order => ({
  order_id: id, status: 'PENDING', priority: 2, created_at: at('06:00'), deadline: at('15:00'), customer_ref: 'C', destination_ref: 'D',
  assigned_picker_id: null, hold_reason: null, hold_exception_id: null, hold_prev_status: null, updated_at: at('06:00'), ...o,
});
export const line = (orderId: string, s: string, req: number, picked = 0, n = 1): OrderLine => ({ line_id: `${orderId}-L${n}`, order_id: orderId, line_no: n, sku: s, requested_qty: req, picked_qty: picked });

export function input(p: Partial<PlannerInput> & Pick<PlannerInput, 'orders' | 'lines' | 'pickers'>): PlannerInput {
  return {
    simNow: NOW, shiftEnd: at('16:00'),
    skus: new Map([sku('S1', 1), sku('S2', 2), sku('COLD1', 1, 'COLD')].map((s) => [s.sku, s])),
    inventory: [inv('S1', 'A-01', 'A', 1000), inv('S2', 'B-01', 'B', 1000), inv('COLD1', 'C-01', 'C', 1000)],
    openExceptions: [],
    params: { urgency_bucket_minutes: [120, 240], plannable_statuses: ['PENDING', 'PICKING'], minutes_per_location: 2, minutes_per_extra_zone: 3 },
    previous: null,
    ...p,
  };
}
