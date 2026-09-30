/**
 * Baseline synthetic warehouse. All identifiers and names are fictional.
 * Times are relative to the simulated clock SIM_NOW (2026-10-01 08:00 UTC), so every
 * scenario is reproducible regardless of the wall clock.
 */
export const SEED_VERSION = 'baseline-v1';
export const SIM_NOW = '2026-10-01T08:00:00Z';
export const SHIFT_START = '2026-10-01T08:00:00Z';
export const SHIFT_END = '2026-10-01T16:00:00Z';

const at = (hhmm: string, day = '2026-10-01') => `${day}T${hhmm}:00Z`;

export const locations = [
  { location_id: 'A-01', zone: 'A', aisle: 1, x: 1 },
  { location_id: 'A-02', zone: 'A', aisle: 2, x: 2 },
  { location_id: 'B-01', zone: 'B', aisle: 5, x: 5 },
  { location_id: 'B-02', zone: 'B', aisle: 6, x: 6 },
  { location_id: 'C-01', zone: 'C', aisle: 10, x: 10 }, // cold room
  { location_id: 'C-02', zone: 'C', aisle: 11, x: 11 },
  { location_id: 'D-01', zone: 'D', aisle: 15, x: 15 }, // bulky goods
  { location_id: 'D-02', zone: 'D', aisle: 16, x: 16 },
];

export const skus = [
  { sku: 'SKU-001', description: 'Thermal label roll', pick_minutes_per_unit: 0.5, required_skill: null },
  { sku: 'SKU-002', description: 'Packing tape 6-pack', pick_minutes_per_unit: 0.5, required_skill: null },
  { sku: 'SKU-003', description: 'Handheld barcode scanner', pick_minutes_per_unit: 2, required_skill: null },
  { sku: 'SKU-004', description: 'Mobile label printer', pick_minutes_per_unit: 2, required_skill: null },
  { sku: 'SKU-005', description: 'Safety gloves (box)', pick_minutes_per_unit: 0.5, required_skill: null },
  { sku: 'SKU-006', description: 'Chilled sample kit', pick_minutes_per_unit: 3, required_skill: 'COLD' },
  { sku: 'SKU-007', description: 'Stretch wrap roll', pick_minutes_per_unit: 1.5, required_skill: null },
  { sku: 'SKU-008', description: 'Pallet jack wheel set', pick_minutes_per_unit: 6, required_skill: 'BULKY' },
  { sku: 'SKU-009', description: 'Printer ribbon', pick_minutes_per_unit: 0.5, required_skill: null },
  { sku: 'SKU-010', description: 'Shelf divider pack', pick_minutes_per_unit: 1, required_skill: null },
];

export const inventory = [
  { sku: 'SKU-001', location_id: 'A-01', on_hand: 200, reserved: 20, last_updated: at('06:00') },
  { sku: 'SKU-002', location_id: 'A-02', on_hand: 150, reserved: 10, last_updated: at('06:00') },
  { sku: 'SKU-003', location_id: 'B-01', on_hand: 40, reserved: 5, last_updated: at('06:00') },
  { sku: 'SKU-004', location_id: 'B-02', on_hand: 30, reserved: 4, last_updated: at('06:00') },
  { sku: 'SKU-005', location_id: 'A-01', on_hand: 60, reserved: 0, last_updated: at('06:00') },
  { sku: 'SKU-005', location_id: 'B-01', on_hand: 40, reserved: 0, last_updated: at('06:00') },
  { sku: 'SKU-006', location_id: 'C-01', on_hand: 25, reserved: 0, last_updated: at('06:00') },
  // EXC-2001: system says 14, but a newer cycle count (below) found only 5.
  { sku: 'SKU-007', location_id: 'B-02', on_hand: 14, reserved: 0, last_updated: at('18:00', '2026-09-30') },
  { sku: 'SKU-008', location_id: 'D-01', on_hand: 100, reserved: 0, last_updated: at('06:00') },
  { sku: 'SKU-009', location_id: 'A-02', on_hand: 80, reserved: 0, last_updated: at('06:00') },
  // ORD-1015 needs 20: planner must detect "not ready" by itself.
  { sku: 'SKU-010', location_id: 'C-02', on_hand: 8, reserved: 0, last_updated: at('06:00') },
];

export const inventoryCounts = [
  { count_id: 'CC-7001', sku: 'SKU-007', location_id: 'B-02', counted_qty: 5, counted_at: at('07:30'), counted_by: 'cycle-count-team' },
  { count_id: 'CC-7002', sku: 'SKU-001', location_id: 'A-01', counted_qty: 200, counted_at: at('05:30'), counted_by: 'cycle-count-team' },
];

export const pickers = [
  { picker_id: 'P-01', display_name: 'Avery (fictional)', availability: 'AVAILABLE', unavailable_reason: null, capacity_minutes: 180, home_zone: 'A', skills: ['STANDARD'] },
  { picker_id: 'P-02', display_name: 'Blake (fictional)', availability: 'AVAILABLE', unavailable_reason: null, capacity_minutes: 180, home_zone: 'C', skills: ['STANDARD', 'COLD'] },
  { picker_id: 'P-03', display_name: 'Casey (fictional)', availability: 'AVAILABLE', unavailable_reason: null, capacity_minutes: 90, home_zone: 'B', skills: ['STANDARD'] },
  { picker_id: 'P-04', display_name: 'Devon (fictional)', availability: 'AVAILABLE', unavailable_reason: null, capacity_minutes: 120, home_zone: 'D', skills: ['STANDARD', 'BULKY'] },
  { picker_id: 'P-05', display_name: 'Emery (fictional)', availability: 'UNAVAILABLE', unavailable_reason: 'Out sick (whole shift)', capacity_minutes: 180, home_zone: 'A', skills: ['STANDARD', 'COLD'] },
];

type SeedOrder = {
  order_id: string; status: string; priority: number; created_at: string; deadline: string;
  customer_ref: string; destination_ref: string; assigned_picker_id?: string | null;
  lines: Array<[sku: string, requested: number, picked: number]>;
};

export const orders: SeedOrder[] = [
  { order_id: 'ORD-1001', status: 'PENDING', priority: 1, created_at: at('06:10'), deadline: at('10:00'), customer_ref: 'CUST-0101', destination_ref: 'DEST-N-101', lines: [['SKU-001', 24, 0], ['SKU-004', 6, 0]] },
  { order_id: 'ORD-1002', status: 'PENDING', priority: 2, created_at: at('06:20'), deadline: at('12:00'), customer_ref: 'CUST-0102', destination_ref: 'DEST-N-102', lines: [['SKU-002', 40, 0], ['SKU-003', 10, 0]] },
  // EXC-2003: packed, but carrier has already scanned it (recoverable desync)
  { order_id: 'ORD-1003', status: 'PACKED', priority: 2, created_at: at('09:00', '2026-09-30'), deadline: at('18:00', '2026-09-30'), customer_ref: 'CUST-0103', destination_ref: 'DEST-N-303', lines: [['SKU-009', 5, 5], ['SKU-001', 10, 10]] },
  // EXC-2001: inventory shortfall on SKU-007
  { order_id: 'ORD-1004', status: 'PENDING', priority: 1, created_at: at('06:30'), deadline: at('11:30'), customer_ref: 'CUST-0104', destination_ref: 'DEST-W-104', lines: [['SKU-007', 12, 0], ['SKU-001', 10, 0]] },
  // existing progress: being picked by P-01
  { order_id: 'ORD-1005', status: 'PICKING', priority: 1, created_at: at('05:50'), deadline: at('09:45'), customer_ref: 'CUST-0105', destination_ref: 'DEST-S-105', assigned_picker_id: 'P-01', lines: [['SKU-005', 40, 16], ['SKU-002', 20, 20]] },
  // COLD skill required (only P-02 among available pickers)
  { order_id: 'ORD-1006', status: 'PENDING', priority: 2, created_at: at('06:40'), deadline: at('13:00'), customer_ref: 'CUST-0106', destination_ref: 'DEST-C-106', lines: [['SKU-006', 12, 0], ['SKU-010', 2, 0]] },
  // EXC-2006: stale shipment
  { order_id: 'ORD-1007', status: 'PACKED', priority: 2, created_at: at('08:00', '2026-09-28'), deadline: at('17:00', '2026-09-28'), customer_ref: 'CUST-0107', destination_ref: 'DEST-E-307', lines: [['SKU-002', 8, 8]] },
  // EXC-2004: says SHIPPED, shipment has no scan and a line is short-picked
  { order_id: 'ORD-1008', status: 'SHIPPED', priority: 2, created_at: at('10:00', '2026-09-30'), deadline: at('17:00', '2026-09-30'), customer_ref: 'CUST-0108', destination_ref: 'DEST-S-308', lines: [['SKU-003', 4, 4], ['SKU-004', 2, 1]] },
  // EXC-2005: negative quantity + created after deadline
  { order_id: 'ORD-1009', status: 'PENDING', priority: 2, created_at: at('07:40'), deadline: at('07:00'), customer_ref: 'CUST-0109', destination_ref: 'DEST-N-109', lines: [['SKU-003', 5, 0], ['SKU-001', -3, 0]] },
  // EXC-2002: ORD-1011 duplicates ORD-1010
  { order_id: 'ORD-1010', status: 'PENDING', priority: 3, created_at: at('07:20'), deadline: at('15:00'), customer_ref: 'CUST-0042', destination_ref: 'DEST-S-042', lines: [['SKU-004', 3, 0], ['SKU-009', 10, 0]] },
  { order_id: 'ORD-1011', status: 'PENDING', priority: 3, created_at: at('07:23'), deadline: at('15:00'), customer_ref: 'CUST-0042', destination_ref: 'DEST-S-042', lines: [['SKU-004', 3, 0], ['SKU-009', 10, 0]] },
  // EXC-2007: linked shipment SHP-5012 carries ORD-1013's destination (ambiguous)
  { order_id: 'ORD-1012', status: 'PACKED', priority: 2, created_at: at('15:00', '2026-09-30'), deadline: at('12:00'), customer_ref: 'CUST-0112', destination_ref: 'DEST-W-212', lines: [['SKU-001', 6, 6]] },
  { order_id: 'ORD-1013', status: 'PACKED', priority: 2, created_at: at('15:05', '2026-09-30'), deadline: at('12:00'), customer_ref: 'CUST-0113', destination_ref: 'DEST-E-340', lines: [['SKU-002', 4, 4]] },
  // infeasible: bulky workload exceeds the only BULKY picker's capacity
  { order_id: 'ORD-1014', status: 'PENDING', priority: 3, created_at: at('06:00'), deadline: at('16:00'), customer_ref: 'CUST-0114', destination_ref: 'DEST-C-114', lines: [['SKU-008', 25, 0]] },
  // not inventory-ready (planner detects on its own)
  { order_id: 'ORD-1015', status: 'PENDING', priority: 2, created_at: at('06:50'), deadline: at('14:00'), customer_ref: 'CUST-0115', destination_ref: 'DEST-E-115', lines: [['SKU-010', 20, 0]] },
  // multi-location / multi-zone
  { order_id: 'ORD-1016', status: 'PENDING', priority: 2, created_at: at('06:55'), deadline: at('11:00'), customer_ref: 'CUST-0116', destination_ref: 'DEST-W-116', lines: [['SKU-003', 8, 0], ['SKU-005', 30, 0], ['SKU-009', 20, 0]] },
  { order_id: 'ORD-1017', status: 'PENDING', priority: 1, created_at: at('07:05'), deadline: at('12:30'), customer_ref: 'CUST-0117', destination_ref: 'DEST-N-117', lines: [['SKU-004', 8, 0], ['SKU-001', 30, 0]] },
  // existing progress: being picked by P-02 (COLD)
  { order_id: 'ORD-1018', status: 'PICKING', priority: 2, created_at: at('06:15'), deadline: at('13:30'), customer_ref: 'CUST-0118', destination_ref: 'DEST-C-118', assigned_picker_id: 'P-02', lines: [['SKU-006', 10, 4]] },
  // clean history
  { order_id: 'ORD-1019', status: 'SHIPPED', priority: 3, created_at: at('08:00', '2026-09-29'), deadline: at('17:00', '2026-09-29'), customer_ref: 'CUST-0119', destination_ref: 'DEST-N-119', lines: [['SKU-005', 10, 10]] },
  { order_id: 'ORD-1020', status: 'SHIPPED', priority: 2, created_at: at('09:00', '2026-09-30'), deadline: at('17:00', '2026-09-30'), customer_ref: 'CUST-0120', destination_ref: 'DEST-S-120', lines: [['SKU-009', 12, 12]] },
];

export const shipments = [
  { shipment_id: 'SHP-5001', order_id: 'ORD-1001', status: 'LABEL_CREATED', carrier: 'SimParcel', tracking_ref: 'SP-000501', destination_ref: 'DEST-N-101', label_created_at: at('07:00'), picked_up_at: null, last_scan_at: null },
  { shipment_id: 'SHP-5002', order_id: 'ORD-1002', status: 'LABEL_CREATED', carrier: 'SimParcel', tracking_ref: 'SP-000502', destination_ref: 'DEST-N-102', label_created_at: at('07:05'), picked_up_at: null, last_scan_at: null },
  { shipment_id: 'SHP-5003', order_id: 'ORD-1003', status: 'IN_TRANSIT', carrier: 'SimFreight', tracking_ref: 'SF-000503', destination_ref: 'DEST-N-303', label_created_at: at('14:00', '2026-09-30'), picked_up_at: at('17:10', '2026-09-30'), last_scan_at: at('05:40') },
  { shipment_id: 'SHP-5007', order_id: 'ORD-1007', status: 'LABEL_CREATED', carrier: 'SimParcel', tracking_ref: 'SP-000507', destination_ref: 'DEST-E-307', label_created_at: at('10:00', '2026-09-28'), picked_up_at: null, last_scan_at: null },
  { shipment_id: 'SHP-5008', order_id: 'ORD-1008', status: 'LABEL_CREATED', carrier: 'SimParcel', tracking_ref: 'SP-000508', destination_ref: 'DEST-S-308', label_created_at: at('20:00', '2026-09-30'), picked_up_at: null, last_scan_at: null },
  { shipment_id: 'SHP-5012', order_id: 'ORD-1012', status: 'LABEL_CREATED', carrier: 'SimFreight', tracking_ref: 'SF-000512', destination_ref: 'DEST-E-340', label_created_at: at('06:30'), picked_up_at: null, last_scan_at: null },
  { shipment_id: 'SHP-5017', order_id: 'ORD-1017', status: 'LABEL_CREATED', carrier: 'SimParcel', tracking_ref: 'SP-000517', destination_ref: 'DEST-N-117', label_created_at: at('07:10'), picked_up_at: null, last_scan_at: null },
  { shipment_id: 'SHP-5019', order_id: 'ORD-1019', status: 'DELIVERED', carrier: 'SimParcel', tracking_ref: 'SP-000519', destination_ref: 'DEST-N-119', label_created_at: at('12:00', '2026-09-29'), picked_up_at: at('16:00', '2026-09-29'), last_scan_at: at('11:00', '2026-09-30') },
  { shipment_id: 'SHP-5020', order_id: 'ORD-1020', status: 'IN_TRANSIT', carrier: 'SimFreight', tracking_ref: 'SF-000520', destination_ref: 'DEST-S-120', label_created_at: at('13:00', '2026-09-30'), picked_up_at: at('16:30', '2026-09-30'), last_scan_at: at('06:10') },
];

export const exceptions = [
  { exception_id: 'EXC-2001', order_id: 'ORD-1004', type: 'INVENTORY_SHORTFALL', summary: 'Cycle count for SKU-007 at B-02 disagrees with system stock; ORD-1004 may not be fulfillable.', evidence_refs: [{ kind: 'inventory', ref: 'SKU-007@B-02' }, { kind: 'cycle_count', ref: 'CC-7001' }], detected_at: at('07:35') },
  { exception_id: 'EXC-2002', order_id: 'ORD-1011', type: 'DUPLICATE_ORDER', summary: 'ORD-1011 looks like a repeat submission of ORD-1010.', evidence_refs: [{ kind: 'order', ref: 'ORD-1010' }, { kind: 'order', ref: 'ORD-1011' }], detected_at: at('07:30') },
  { exception_id: 'EXC-2003', order_id: 'ORD-1003', type: 'STATUS_DESYNC', summary: 'ORD-1003 is PACKED in OMS while carrier reports shipment SHP-5003 moving.', evidence_refs: [{ kind: 'shipment', ref: 'SHP-5003' }], detected_at: at('06:00') },
  { exception_id: 'EXC-2004', order_id: 'ORD-1008', type: 'STATUS_DESYNC', summary: 'ORD-1008 is SHIPPED in OMS but shipment SHP-5008 shows no carrier activity.', evidence_refs: [{ kind: 'shipment', ref: 'SHP-5008' }], detected_at: at('06:05') },
  { exception_id: 'EXC-2005', order_id: 'ORD-1009', type: 'INVALID_DATA', summary: 'ORD-1009 failed import validation checks.', evidence_refs: [{ kind: 'order', ref: 'ORD-1009' }], detected_at: at('07:41') },
  { exception_id: 'EXC-2006', order_id: 'ORD-1007', type: 'STALE_SHIPMENT', summary: 'ORD-1007 packed but shipment has not moved.', evidence_refs: [{ kind: 'shipment', ref: 'SHP-5007' }], detected_at: at('07:00') },
  { exception_id: 'EXC-2007', order_id: 'ORD-1012', type: 'DESTINATION_CONFLICT', summary: 'Shipment SHP-5012 destination does not match ORD-1012.', evidence_refs: [{ kind: 'shipment', ref: 'SHP-5012' }, { kind: 'order', ref: 'ORD-1012' }], detected_at: at('06:45') },
];
