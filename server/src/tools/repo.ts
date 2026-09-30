/** Data access used *inside* tools only. Not exposed to agents. */
import { many, one, type Db } from '../db/pool.js';
import type { ExceptionRecord, InventoryCount, InventoryRow, Order, OrderLine, Picker, Shipment, Sku } from '../domain/types.js';

export const simState = (db: Db) =>
  one<{ sim_now: string; shift_start: string; shift_end: string; faults: Record<string, unknown>; seed_version: string }>(db, 'SELECT * FROM sim_state WHERE id = 1').then((r) => {
    if (!r) throw new Error('Environment not initialised; run reset');
    return r;
  });

export const getOrderRow = (db: Db, id: string) => one<Order>(db, 'SELECT * FROM orders WHERE order_id = $1', [id]);
export const getLines = (db: Db, id: string) => many<OrderLine>(db, 'SELECT * FROM order_lines WHERE order_id = $1 ORDER BY line_no', [id]);
export const allOrders = (db: Db) => many<Order>(db, 'SELECT * FROM orders ORDER BY order_id');
export const allLines = (db: Db) => many<OrderLine>(db, 'SELECT * FROM order_lines ORDER BY order_id, line_no');
export const allSkus = async (db: Db) => new Map((await many<Sku>(db, 'SELECT * FROM skus')).map((s) => [s.sku, s]));
export const inventoryRows = (db: Db, sku?: string) =>
  many<InventoryRow>(
    db,
    `SELECT i.*, l.zone, l.x FROM inventory i JOIN locations l USING (location_id) ${sku ? 'WHERE i.sku = $1' : ''} ORDER BY i.sku, i.location_id`,
    sku ? [sku] : [],
  );
export const inventoryCounts = (db: Db, sku?: string) =>
  many<InventoryCount>(db, `SELECT * FROM inventory_counts ${sku ? 'WHERE sku = $1' : ''} ORDER BY counted_at DESC`, sku ? [sku] : []);
export const getShipmentRow = (db: Db, id: string) => one<Shipment>(db, 'SELECT * FROM shipments WHERE shipment_id = $1', [id]);
export const shipmentsForOrder = (db: Db, orderId: string) => many<Shipment>(db, 'SELECT * FROM shipments WHERE order_id = $1 ORDER BY shipment_id', [orderId]);
export const allPickers = (db: Db) => many<Picker>(db, 'SELECT * FROM pickers ORDER BY picker_id');
export const getExceptionRow = (db: Db, id: string) => one<ExceptionRecord>(db, 'SELECT * FROM exceptions WHERE exception_id = $1', [id]);
export const openExceptions = (db: Db) =>
  many<ExceptionRecord>(db, `SELECT * FROM exceptions WHERE status IN ('OPEN','INVESTIGATING','AWAITING_APPROVAL','ESCALATED','FAILED') ORDER BY exception_id`);
