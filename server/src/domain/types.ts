export type OrderStatus = 'PENDING' | 'PICKING' | 'PICKED' | 'PACKED' | 'SHIPPED' | 'ON_HOLD' | 'CANCELLED';

export interface Order {
  order_id: string;
  status: OrderStatus;
  priority: number;
  created_at: string;
  deadline: string;
  customer_ref: string;
  destination_ref: string;
  assigned_picker_id: string | null;
  hold_reason: string | null;
  hold_exception_id: string | null;
  hold_prev_status: OrderStatus | null;
  updated_at: string;
}

export interface OrderLine {
  line_id: string;
  order_id: string;
  line_no: number;
  sku: string;
  requested_qty: number;
  picked_qty: number;
}

export interface Sku {
  sku: string;
  description: string;
  pick_minutes_per_unit: number;
  required_skill: string | null;
}

export interface InventoryRow {
  sku: string;
  location_id: string;
  zone: string;
  x: number;
  on_hand: number;
  reserved: number;
  available: number;
  last_updated: string;
}

export interface InventoryCount {
  count_id: string;
  sku: string;
  location_id: string;
  counted_qty: number;
  counted_at: string;
  counted_by: string;
}

export interface Shipment {
  shipment_id: string;
  order_id: string | null;
  status: 'LABEL_CREATED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED';
  carrier: string;
  tracking_ref: string;
  destination_ref: string;
  label_created_at: string;
  picked_up_at: string | null;
  last_scan_at: string | null;
}

export interface Picker {
  picker_id: string;
  display_name: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  unavailable_reason: string | null;
  capacity_minutes: number;
  home_zone: string;
  skills: string[];
}

export type ExceptionType =
  | 'INVENTORY_SHORTFALL'
  | 'DUPLICATE_ORDER'
  | 'STATUS_DESYNC'
  | 'INVALID_DATA'
  | 'STALE_SHIPMENT'
  | 'DESTINATION_CONFLICT';

export interface ExceptionRecord {
  exception_id: string;
  order_id: string;
  type: ExceptionType;
  status: string;
  summary: string;
  evidence_refs: Array<{ kind: string; ref: string }>;
  detected_at: string;
  last_run_id: string | null;
  outcome: string | null;
  resolution: unknown;
}

export interface Policy {
  policy_id: string;
  title: string;
  rule: string;
  applies_to: string[];
  keywords: string[];
  params: Record<string, any>;
}
