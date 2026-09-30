import type pg from 'pg';
import type { ToolCtx } from '../tools/framework.js';

export type DomainEventType =
  | 'ORDER_HELD' | 'ORDER_RELEASED' | 'ORDER_CANCELLED' | 'ORDER_CREATED' | 'ORDER_STATUS_SYNCED' | 'SHIPMENT_RELINKED'
  | 'PICKER_AVAILABILITY_CHANGED' | 'INVENTORY_CHANGED' | 'CYCLE_COUNT_RECORDED' | 'EXCEPTION_DETECTED';

/** Outbox write: MUST be called with the tool's transaction client so the event commits atomically with the change. */
export async function emit(c: pg.PoolClient, type: DomainEventType, payload: Record<string, unknown>, sourceTool: string, ctx: ToolCtx) {
  await c.query(
    `INSERT INTO domain_events (type, payload, source_tool, run_id, sim_time) VALUES ($1, $2, $3, $4, (SELECT sim_now FROM sim_state WHERE id = 1))`,
    [type, JSON.stringify(payload), sourceTool, ctx.runId],
  );
}
