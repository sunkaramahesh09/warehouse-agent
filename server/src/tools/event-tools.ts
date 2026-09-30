/**
 * Event-driven inputs: cycle-count ingestion, deterministic shortfall detection, and the
 * operator's automation switches. All go through the controlled tool pipeline.
 */
import { z } from 'zod';
import { defineTool, ToolError } from './framework.js';
import * as repo from './repo.js';
import { many, one } from '../db/pool.js';
import { effectiveAvailability } from '../domain/rules.js';
import { emit } from '../events/emit.js';

export const recordCycleCount = defineTool({
  name: 'record_cycle_count',
  description: 'Ingest a (simulated) physical cycle count for a SKU at a location.',
  kind: 'action',
  roles: ['operator', 'system'],
  input: z.object({ sku: z.string().regex(/^SKU-\d{3}$/), location_id: z.string().regex(/^[A-D]-\d{2}$/), counted_qty: z.number().int().min(0).max(100000), counted_by: z.string().max(60).default('cycle-count-team') }),
  run: async (c, i, ctx, note) => {
    const inv = await one(c, 'SELECT * FROM inventory WHERE sku = $1 AND location_id = $2', [i.sku, i.location_id]);
    if (!inv) throw new ToolError('NOT_FOUND', `No inventory record for ${i.sku} at ${i.location_id}`);
    const { sim_now } = await repo.simState(c);
    const n = (await one<{ n: number }>(c, `SELECT COALESCE(max(substring(count_id from 4)::int), 7000)::int n FROM inventory_counts`))!.n + 1;
    const count_id = `CC-${n}`;
    await c.query('INSERT INTO inventory_counts VALUES ($1,$2,$3,$4,$5,$6)', [count_id, i.sku, i.location_id, i.counted_qty, sim_now, i.counted_by]);
    note.event_type = 'SIM_CHANGE';
    note.decision_summary = `SIMULATED: cycle count ${count_id} ${i.sku}@${i.location_id} = ${i.counted_qty} (system on_hand ${inv.on_hand})`;
    note.state_changes = [{ entity: 'inventory_count', id: count_id, to: i.counted_qty }];
    await emit(c, 'CYCLE_COUNT_RECORDED', { count_id, sku: i.sku, location_id: i.location_id, counted_qty: i.counted_qty, system_on_hand: inv.on_hand }, 'record_cycle_count', ctx);
    return { count_id, sku: i.sku, location_id: i.location_id, counted_qty: i.counted_qty, system_on_hand: inv.on_hand, counted_at: sim_now };
  },
});

/**
 * Deterministic detector (no LLM): after a count, flag every open order whose remaining
 * quantity of the SKU exceeds the effective available stock (SOP-SOT-001). Creates one
 * INVENTORY_SHORTFALL exception per affected order that does not already have one.
 */
export const detectInventoryShortfalls = defineTool({
  name: 'detect_inventory_shortfalls',
  description: 'Create INVENTORY_SHORTFALL exceptions for orders that a new cycle count makes unfulfillable.',
  kind: 'action',
  roles: ['system'],
  input: z.object({ count_id: z.string().regex(/^CC-\d+$/) }),
  idempotencyKey: (i) => `detect:${i.count_id}`,
  run: async (c, i, ctx, note) => {
    const cc = await one(c, 'SELECT * FROM inventory_counts WHERE count_id = $1', [i.count_id]);
    if (!cc) throw new ToolError('NOT_FOUND', `Cycle count ${i.count_id} does not exist`);
    const av = effectiveAvailability(cc.sku, await repo.inventoryRows(c, cc.sku), await repo.inventoryCounts(c, cc.sku));
    const orders = await many(c,
      `SELECT o.order_id, o.status, sum(l.requested_qty - l.picked_qty)::int AS remaining
       FROM orders o JOIN order_lines l USING (order_id)
       WHERE l.sku = $1 AND o.status IN ('PENDING','PICKING') AND l.requested_qty > l.picked_qty
       GROUP BY o.order_id, o.status ORDER BY o.order_id`, [cc.sku]);
    const created: string[] = [];
    const skipped: string[] = [];
    for (const o of orders) {
      if (o.remaining <= av.effective_available) continue;
      const existing = await one(c, `SELECT exception_id FROM exceptions WHERE order_id = $1 AND type = 'INVENTORY_SHORTFALL' AND status NOT IN ('RESOLVED','CLOSED')`, [o.order_id]);
      if (existing) { skipped.push(`${o.order_id} (already ${existing.exception_id})`); continue; }
      const n = (await one<{ n: number }>(c, `SELECT COALESCE(max(substring(exception_id from 5)::int), 3000)::int n FROM exceptions WHERE exception_id >= 'EXC-3000'`))!.n + 1;
      const exception_id = `EXC-${n}`;
      await c.query(
        `INSERT INTO exceptions (exception_id, order_id, type, status, summary, evidence_refs, detected_at) VALUES ($1,$2,'INVENTORY_SHORTFALL','OPEN',$3,$4,(SELECT sim_now FROM sim_state WHERE id = 1))`,
        [exception_id, o.order_id, `Auto-detected: ${o.order_id} needs ${o.remaining} x ${cc.sku}, cycle count ${cc.count_id} leaves ${av.effective_available} effective.`,
          JSON.stringify([{ kind: 'cycle_count', ref: cc.count_id }, { kind: 'inventory', ref: `${cc.sku}@${cc.location_id}` }])],
      );
      await emit(c, 'EXCEPTION_DETECTED', { exception_id, order_id: o.order_id, type: 'INVENTORY_SHORTFALL', count_id: cc.count_id }, 'detect_inventory_shortfalls', ctx);
      created.push(exception_id);
    }
    note.event_type = 'EXCEPTION_DETECTED';
    note.policy_refs = ['SOP-SOT-001'];
    note.decision_summary = created.length
      ? `Detector: ${cc.sku} effective ${av.effective_available} after ${cc.count_id}; created ${created.join(', ')}`
      : `Detector: ${cc.sku} effective ${av.effective_available} after ${cc.count_id}; no new shortfalls`;
    note.state_changes = created.map((id) => ({ entity: 'exception', id, to: 'OPEN' }));
    return { count_id: cc.count_id, sku: cc.sku, effective_available: av.effective_available, orders_checked: orders.length, created, skipped };
  },
});

export const Automation = z.object({ auto_detect: z.boolean(), auto_investigate: z.boolean(), auto_replan: z.boolean() });
export type Automation = z.infer<typeof Automation>;

export const setAutomation = defineTool({
  name: 'set_automation',
  description: 'Operator switches event-driven automation on/off.',
  kind: 'action',
  roles: ['operator', 'system'],
  input: Automation.partial(),
  run: async (c, i, _ctx, note) => {
    const cur = (await one<{ automation: Automation }>(c, 'SELECT automation FROM sim_state WHERE id = 1 FOR UPDATE'))!.automation;
    const next = { ...cur, ...i };
    await c.query('UPDATE sim_state SET automation = $1 WHERE id = 1', [JSON.stringify(next)]);
    note.event_type = 'CONFIG_CHANGE';
    note.decision_summary = `Automation: detect=${next.auto_detect}, investigate=${next.auto_investigate}, replan=${next.auto_replan}`;
    note.state_changes = [{ entity: 'automation', from: cur, to: next }];
    return next;
  },
});
