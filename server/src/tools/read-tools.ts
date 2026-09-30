/** Read-only investigation tools. These are the only tools an LLM may call directly. */
import { z } from 'zod';
import { defineTool, ToolError } from './framework.js';
import * as repo from './repo.js';
import { many, one } from '../db/pool.js';
import { effectiveAvailability, isProbableDuplicate, shipmentFacts, validateOrderData } from '../domain/rules.js';
import { getPolicy, searchPolicies } from '../policy/retrieval.js';

const OrderId = z.string().regex(/^ORD-\d{4}$/, 'order_id must look like ORD-1234');
const ExcId = z.string().regex(/^EXC-\d{4}$/, 'exception_id must look like EXC-1234');
const READ_ROLES = ['agent', 'operator', 'reviewer', 'system'] as const;

export const getException = defineTool({
  name: 'get_exception',
  description: 'Fetch an exception record: type, status, the order it concerns, and evidence references.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ exception_id: ExcId }),
  run: async (c, { exception_id }) => {
    const e = await repo.getExceptionRow(c, exception_id);
    if (!e) throw new ToolError('NOT_FOUND', `Exception ${exception_id} does not exist`);
    return e;
  },
});

export const getOrder = defineTool({
  name: 'get_order',
  description: 'Fetch an order header (status, priority, deadline, customer and destination refs, hold info) plus ids of linked shipments.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ order_id: OrderId }),
  run: async (c, { order_id }) => {
    const o = await repo.getOrderRow(c, order_id);
    if (!o) throw new ToolError('NOT_FOUND', `Order ${order_id} does not exist`);
    const ships = await repo.shipmentsForOrder(c, order_id);
    const lineCount = (await one<{ n: number }>(c, 'SELECT count(*)::int n FROM order_lines WHERE order_id = $1', [order_id]))!.n;
    return { ...o, line_count: lineCount, linked_shipment_ids: ships.map((s) => s.shipment_id) };
  },
});

export const getOrderLines = defineTool({
  name: 'get_order_lines',
  description: 'Fetch the lines of an order (sku, requested_qty, picked_qty) and any deterministic data-validity issues found in the order.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ order_id: OrderId }),
  run: async (c, { order_id }) => {
    const o = await repo.getOrderRow(c, order_id);
    if (!o) throw new ToolError('NOT_FOUND', `Order ${order_id} does not exist`);
    const lines = await repo.getLines(c, order_id);
    return { order_id, lines, data_issues: validateOrderData(o, lines) };
  },
});

export const getInventory = defineTool({
  name: 'get_inventory',
  description: 'Fetch inventory for a SKU across locations (on_hand, reserved, available), recent cycle counts, and the effective available quantity per SOP-SOT-001.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ sku: z.string().regex(/^SKU-\d{3}$/) }),
  run: async (c, { sku }) => {
    const skuRow = await one(c, 'SELECT * FROM skus WHERE sku = $1', [sku]);
    if (!skuRow) throw new ToolError('NOT_FOUND', `SKU ${sku} does not exist`);
    const rows = await repo.inventoryRows(c, sku);
    const counts = await repo.inventoryCounts(c, sku);
    if (rows.length === 0) {
      return { sku: skuRow, locations: [], cycle_counts: counts, availability: null, warning: 'MISSING_LOCATION: SKU has no inventory location record' };
    }
    return { sku: skuRow, locations: rows, cycle_counts: counts, availability: effectiveAvailability(sku, rows, counts) };
  },
});

export const getShipment = defineTool({
  name: 'get_shipment',
  description: 'Fetch a shipment (status, carrier scans, destination) and, if it is linked to an order, deterministic facts comparing it to that order.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ shipment_id: z.string().regex(/^SHP-\d{4}$/) }),
  run: async (c, { shipment_id }) => {
    const s = await repo.getShipmentRow(c, shipment_id);
    if (!s) throw new ToolError('NOT_FOUND', `Shipment ${shipment_id} does not exist`);
    const { sim_now } = await repo.simState(c);
    if (!s.order_id) return { shipment: s, linked_order_exists: false, facts: null };
    const o = await repo.getOrderRow(c, s.order_id);
    if (!o) return { shipment: s, linked_order_exists: false, facts: null, warning: `Linked order ${s.order_id} not found` };
    const lines = await repo.getLines(c, o.order_id);
    return { shipment: s, linked_order_exists: true, compared_with_order: o.order_id, facts: shipmentFacts(o, lines, s, sim_now), sim_now };
  },
});

export const findShipmentsForOrder = defineTool({
  name: 'find_shipments_for_order',
  description: 'List shipments whose order_id points at the given order.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ order_id: OrderId }),
  run: async (c, { order_id }) => ({ order_id, shipments: await repo.shipmentsForOrder(c, order_id) }),
});

export const findOrdersByDestination = defineTool({
  name: 'find_orders_by_destination',
  description: 'List orders and shipments that use a destination reference. Useful to check whether a shipment may belong to a different order.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ destination_ref: z.string().min(3) }),
  run: async (c, { destination_ref }) => ({
    destination_ref,
    orders: await many(c, 'SELECT order_id, status, customer_ref, destination_ref FROM orders WHERE destination_ref = $1 ORDER BY order_id', [destination_ref]),
    shipments: await many(c, 'SELECT shipment_id, order_id, status, destination_ref FROM shipments WHERE destination_ref = $1 ORDER BY shipment_id', [destination_ref]),
  }),
});

export const findDuplicateOrders = defineTool({
  name: 'find_duplicate_orders',
  description: 'Compare an order against other non-cancelled orders of the same customer using the SOP-EXC-002 duplicate criteria.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ order_id: OrderId }),
  run: async (c, { order_id }) => {
    const o = await repo.getOrderRow(c, order_id);
    if (!o) throw new ToolError('NOT_FOUND', `Order ${order_id} does not exist`);
    const lines = await repo.getLines(c, order_id);
    const pol = await getPolicy(c, 'SOP-EXC-002');
    const windowMin = Number(pol?.params?.duplicate_window_minutes ?? 30);
    const others = await many(c, `SELECT * FROM orders WHERE customer_ref = $1 AND order_id <> $2 AND status <> 'CANCELLED' ORDER BY order_id`, [o.customer_ref, order_id]);
    const candidates = [];
    for (const other of others) {
      const ol = await repo.getLines(c, other.order_id);
      const r = isProbableDuplicate(o, lines, other, ol, windowMin);
      candidates.push({
        order_id: other.order_id, status: other.status, created_at: other.created_at, probable_duplicate: r.match, criteria: r.reasons,
        later_order: new Date(o.created_at) > new Date(other.created_at) ? order_id : other.order_id,
      });
    }
    return { order_id, window_minutes: windowMin, candidates };
  },
});

const workflowKey = (w: string) => (w === 'SHIFT_PLANNER' ? 'shift_planner' : w === 'EXCEPTION_RESOLVER' ? 'exception_resolver' : undefined);

export const searchPoliciesTool = defineTool({
  name: 'search_policies',
  description: 'Search the shared warehouse SOP by keywords. Returns policy ids, titles and the most relevant excerpt. Cite only policy ids returned here or by get_policy.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ query: z.string().min(3).max(200) }),
  run: async (c, { query }, ctx) => {
    const hits = await searchPolicies(c, query, workflowKey(ctx.workflow), 3);
    return { query, hits, policy_gap: hits.length === 0 };
  },
});

export const getPolicyTool = defineTool({
  name: 'get_policy',
  description: 'Fetch the full text of one SOP policy by id.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({ policy_id: z.string().regex(/^SOP-[A-Z]{3}-\d{3}$/) }),
  run: async (c, { policy_id }) => {
    const p = await getPolicy(c, policy_id);
    if (!p) throw new ToolError('NOT_FOUND', `Policy ${policy_id} does not exist in the SOP store`);
    return p;
  },
});

export const getPickerStatus = defineTool({
  name: 'get_picker_status',
  description: 'List pickers with availability, capacity, skills, zone, and current load in the active plan.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({}),
  run: async (c) => {
    const pickers = await repo.allPickers(c);
    const loads = await many<{ picker_id: string; load: number; n: number }>(
      c,
      `SELECT pa.picker_id, sum(pa.workload_minutes)::float AS load, count(*)::int AS n
       FROM plan_assignments pa JOIN plans p ON p.version = pa.plan_version AND p.status = 'ACTIVE'
       WHERE pa.picker_id IS NOT NULL GROUP BY pa.picker_id`,
    );
    return pickers.map((p) => {
      const l = loads.find((x) => x.picker_id === p.picker_id);
      return { ...p, planned_load_minutes: l?.load ?? 0, planned_orders: l?.n ?? 0 };
    });
  },
});

export const getCurrentPlan = defineTool({
  name: 'get_current_plan',
  description: 'Fetch the active shift plan version and its assignments.',
  kind: 'read',
  roles: [...READ_ROLES],
  input: z.object({}),
  run: async (c) => {
    const plan = await one(c, `SELECT * FROM plans WHERE status = 'ACTIVE'`);
    if (!plan) return { plan: null, assignments: [] };
    const assignments = await many(c, 'SELECT * FROM plan_assignments WHERE plan_version = $1 ORDER BY priority_rank', [plan.version]);
    return { plan, assignments };
  },
});

/** Tools the resolver's investigator may select from. */
export const INVESTIGATION_TOOLS = [
  getException, getOrder, getOrderLines, getInventory, getShipment, findShipmentsForOrder,
  findOrdersByDestination, findDuplicateOrders, searchPoliciesTool, getPolicyTool,
];
