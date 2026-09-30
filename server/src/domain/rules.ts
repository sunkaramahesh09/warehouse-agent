/**
 * Deterministic business rules shared by the resolver, the planner and the tools.
 * Nothing in here calls an LLM or touches the database.
 */
import type { InventoryCount, InventoryRow, Order, OrderLine, OrderStatus, Shipment, Sku } from './types.js';

// ---------------------------------------------------------------- transitions
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PICKING', 'ON_HOLD', 'CANCELLED'],
  PICKING: ['PICKED', 'ON_HOLD'],
  PICKED: ['PACKED', 'ON_HOLD'],
  PACKED: ['SHIPPED', 'ON_HOLD'],
  ON_HOLD: ['PENDING', 'PICKING', 'PICKED', 'PACKED', 'CANCELLED'], // release restricts to hold_prev_status
  SHIPPED: [],
  CANCELLED: [],
};
const FORWARD_RANK: Partial<Record<OrderStatus, number>> = { PENDING: 0, PICKING: 1, PICKED: 2, PACKED: 3, SHIPPED: 4 };

export function transitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export function isForward(from: OrderStatus, to: OrderStatus): boolean {
  const a = FORWARD_RANK[from];
  const b = FORWARD_RANK[to];
  return a !== undefined && b !== undefined && b > a;
}

// ---------------------------------------------------------------- data validity
export interface DataIssue { field: string; value: unknown; problem: string; ref: string }

/** Shared validity check: the resolver uses it to describe INVALID_DATA, the planner as a hard gate. */
export function validateOrderData(order: Order, lines: OrderLine[]): DataIssue[] {
  const issues: DataIssue[] = [];
  if (new Date(order.created_at) > new Date(order.deadline)) {
    issues.push({ field: 'orders.created_at', value: `${order.created_at} > deadline ${order.deadline}`, problem: 'created after its own deadline', ref: order.order_id });
  }
  if (lines.length === 0) issues.push({ field: 'order_lines', value: 0, problem: 'order has no lines', ref: order.order_id });
  for (const l of lines) {
    if (!Number.isInteger(l.requested_qty) || l.requested_qty <= 0) {
      issues.push({ field: 'order_lines.requested_qty', value: l.requested_qty, problem: 'requested quantity must be a positive integer', ref: l.line_id });
    }
    if (l.picked_qty < 0 || (l.requested_qty > 0 && l.picked_qty > l.requested_qty)) {
      issues.push({ field: 'order_lines.picked_qty', value: l.picked_qty, problem: 'picked quantity outside 0..requested', ref: l.line_id });
    }
  }
  return issues;
}

// ---------------------------------------------------------------- inventory
export interface SkuAvailability {
  sku: string;
  system_on_hand: number;
  system_available: number;
  latest_count: { count_id: string; location_id: string; counted_qty: number; counted_at: string } | null;
  count_supersedes_system: boolean;
  effective_available: number;
  basis: string;
}

/**
 * SOP-SOT-001: a cycle count newer than the inventory row's last_updated supersedes system on_hand
 * (the lower value wins; stock is never raised on the basis of a count).
 */
export function effectiveAvailability(sku: string, rows: InventoryRow[], counts: InventoryCount[]): SkuAvailability {
  const skuRows = rows.filter((r) => r.sku === sku);
  let effective = 0;
  let supersedes = false;
  let latest: SkuAvailability['latest_count'] = null;
  for (const r of skuRows) {
    const c = counts
      .filter((x) => x.sku === sku && x.location_id === r.location_id)
      .sort((a, b) => b.counted_at.localeCompare(a.counted_at))[0];
    let avail = r.available;
    if (c && new Date(c.counted_at) > new Date(r.last_updated) && c.counted_qty < r.on_hand) {
      supersedes = true;
      avail = Math.max(0, c.counted_qty - r.reserved);
    }
    if (c && (!latest || c.counted_at > latest.counted_at)) {
      latest = { count_id: c.count_id, location_id: c.location_id, counted_qty: c.counted_qty, counted_at: c.counted_at };
    }
    effective += avail;
  }
  const system_on_hand = skuRows.reduce((s, r) => s + r.on_hand, 0);
  const system_available = skuRows.reduce((s, r) => s + r.available, 0);
  return {
    sku,
    system_on_hand,
    system_available,
    latest_count: latest,
    count_supersedes_system: supersedes,
    effective_available: effective,
    basis: supersedes ? 'newer cycle count (lower than system on_hand) per SOP-SOT-001' : 'system inventory (available = on_hand - reserved)',
  };
}

// ---------------------------------------------------------------- workload
export const ZONES = ['A', 'B', 'C', 'D'];
export const zoneDistance = (a: string, b: string) => Math.abs(ZONES.indexOf(a) - ZONES.indexOf(b));

export interface WorkloadParams { minutes_per_location: number; minutes_per_extra_zone: number }

export interface Workload {
  minutes: number;
  remaining_units: number;
  locations: string[];
  zones: string[];
  primary_zone: string | null;
  required_skills: string[];
  pick_minutes: number;
  travel_minutes: number;
}

/**
 * Remaining work for an order: remaining units x pick minutes per unit, plus travel
 * (per distinct location and per extra zone). Locations are chosen deterministically:
 * the location with most available stock first.
 */
export function computeWorkload(lines: OrderLine[], skus: Map<string, Sku>, inv: InventoryRow[], p: WorkloadParams): Workload {
  let pick = 0;
  let units = 0;
  const locs = new Map<string, { zone: string; units: number }>();
  const skills = new Set<string>();
  for (const l of lines) {
    const remaining = Math.max(0, l.requested_qty - l.picked_qty);
    if (remaining <= 0) continue;
    const s = skus.get(l.sku);
    if (!s) continue;
    units += remaining;
    pick += remaining * s.pick_minutes_per_unit;
    if (s.required_skill) skills.add(s.required_skill);
    const rows = inv.filter((r) => r.sku === l.sku).sort((a, b) => b.available - a.available || a.location_id.localeCompare(b.location_id));
    let need = remaining;
    for (const r of rows) {
      if (need <= 0) break;
      const take = Math.min(need, Math.max(r.available, 0));
      if (take <= 0) continue;
      const cur = locs.get(r.location_id) ?? { zone: r.zone, units: 0 };
      cur.units += take;
      locs.set(r.location_id, cur);
      need -= take;
    }
    if (need > 0 && rows[0]) {
      const cur = locs.get(rows[0].location_id) ?? { zone: rows[0].zone, units: 0 };
      cur.units += need;
      locs.set(rows[0].location_id, cur);
    }
  }
  const zoneUnits = new Map<string, number>();
  for (const v of locs.values()) zoneUnits.set(v.zone, (zoneUnits.get(v.zone) ?? 0) + v.units);
  const zones = [...zoneUnits.keys()].sort();
  const primary = [...zoneUnits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const travel = locs.size * p.minutes_per_location + Math.max(0, zones.length - 1) * p.minutes_per_extra_zone;
  return {
    minutes: round2(pick + travel),
    remaining_units: units,
    locations: [...locs.keys()].sort(),
    zones,
    primary_zone: primary,
    required_skills: [...skills].sort(),
    pick_minutes: round2(pick),
    travel_minutes: travel,
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- shipments
export interface ShipmentFacts {
  has_pickup_scan: boolean;
  all_lines_picked: boolean;
  destination_match: boolean;
  label_age_hours: number;
  hours_since_last_scan: number | null;
}

export function shipmentFacts(order: Order, lines: OrderLine[], s: Shipment, simNow: string): ShipmentFacts {
  const now = new Date(simNow).getTime();
  return {
    has_pickup_scan: s.picked_up_at !== null,
    all_lines_picked: lines.length > 0 && lines.every((l) => l.requested_qty > 0 && l.picked_qty === l.requested_qty),
    destination_match: s.destination_ref === order.destination_ref,
    label_age_hours: round2((now - new Date(s.label_created_at).getTime()) / 3.6e6),
    hours_since_last_scan: s.last_scan_at ? round2((now - new Date(s.last_scan_at).getTime()) / 3.6e6) : null,
  };
}

/** SOP-EXC-002 duplicate criterion. */
export function isProbableDuplicate(a: Order, aLines: OrderLine[], b: Order, bLines: OrderLine[], windowMinutes: number): { match: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const sameCustomer = a.customer_ref === b.customer_ref;
  const sameDest = a.destination_ref === b.destination_ref;
  const key = (ls: OrderLine[]) => ls.map((l) => `${l.sku}x${l.requested_qty}`).sort().join('|');
  const sameLines = key(aLines) === key(bLines);
  const gapMin = Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) / 60000;
  if (sameCustomer) reasons.push(`same customer_ref ${a.customer_ref}`);
  if (sameDest) reasons.push(`same destination_ref ${a.destination_ref}`);
  if (sameLines) reasons.push(`identical lines (${key(aLines)})`);
  reasons.push(`created ${round2(gapMin)} min apart (window ${windowMinutes} min)`);
  return { match: sameCustomer && sameDest && sameLines && gapMin <= windowMinutes, reasons };
}
