/**
 * Event dispatcher: drains the domain_events outbox and routes each event to its handler.
 *
 *   CYCLE_COUNT_RECORDED ─(auto_detect)──────► detect_inventory_shortfalls ─► EXCEPTION_DETECTED
 *   EXCEPTION_DETECTED   ─(auto_investigate)─► Exception Resolver (same guard, same tools)
 *   ORDER_HELD/RELEASED/CANCELLED/CREATED,
 *   PICKER_AVAILABILITY_CHANGED, INVENTORY_CHANGED ─(auto_replan)─► ONE coalesced incremental replan per round
 *
 * Handlers can emit further events, so the dispatcher runs in rounds until the outbox is
 * empty (bounded). Automation never approves anything: approval-gated actions still wait
 * for an Operator. Every event ends PROCESSED, SKIPPED (with reason) or FAILED, and is audited.
 */
import { pool, many, one } from '../db/pool.js';
import { audit } from '../audit/audit.js';
import { callTool } from '../tools/index.js';
import { REPLAN_EVENT_TYPES } from '../tools/planner-tools.js';
import type { Automation } from '../tools/event-tools.js';
import { investigateException, RunRefused } from '../agents/resolver/orchestrator.js';
import { runPlanner, type PlanTrigger } from '../planner/service.js';
import { newRunId } from '../agents/runs.js';

const MAX_ROUNDS = 6;

export interface DispatchSummary { rounds: number; handled: Array<{ event_id: number; type: string; status: string; handled_by: string; result: unknown }> }

async function finish(id: number, type: string, status: 'PROCESSED' | 'SKIPPED' | 'FAILED', handledBy: string, result: unknown, runId: string, out: DispatchSummary) {
  await pool.query(`UPDATE domain_events SET status = $2, handled_by = $3, result = $4, processed_at = now() WHERE event_id = $1 AND status = 'PENDING'`, [id, status, handledBy, JSON.stringify(result)]);
  await audit(pool, { run_id: runId, workflow: 'SYSTEM', actor: 'event-dispatcher', event_type: 'EVENT_PROCESSED', input: { event_id: id, type }, result, decision_summary: `Event #${id} ${type} → ${status} (${handledBy})`, outcome: status });
  out.handled.push({ event_id: id, type, status, handled_by: handledBy, result });
}

function replanTrigger(events: Array<{ type: string; payload: any }>): PlanTrigger {
  if (events.some((e) => e.type === 'PICKER_AVAILABILITY_CHANGED' && e.payload.to === 'UNAVAILABLE')) return 'PICKER_UNAVAILABLE';
  if (events.some((e) => e.type === 'ORDER_CREATED')) return 'URGENT_ORDER';
  if (events.some((e) => ['ORDER_HELD', 'ORDER_RELEASED', 'ORDER_CANCELLED'].includes(e.type))) return 'EXCEPTION_HOLD';
  if (events.some((e) => e.type === 'INVENTORY_CHANGED')) return 'INVENTORY_CHANGED';
  return 'PICKER_AVAILABLE';
}

export async function processEvents(opts: { mode?: 'auto' | 'llm' | 'deterministic' } = {}): Promise<DispatchSummary> {
  const out: DispatchSummary = { rounds: 0, handled: [] };
  const runId = newRunId('EVT');
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const pending = await many(pool, `SELECT * FROM domain_events WHERE status = 'PENDING' ORDER BY event_id`);
    if (!pending.length) break;
    out.rounds++;
    const auto = (await one<{ automation: Automation }>(pool, 'SELECT automation FROM sim_state WHERE id = 1'))!.automation;
    const replanBatch: typeof pending = [];

    for (const e of pending) {
      try {
        if (e.type === 'CYCLE_COUNT_RECORDED') {
          if (!auto.auto_detect) { await finish(e.event_id, e.type, 'SKIPPED', 'auto_detect off', { reason: 'automation disabled' }, runId, out); continue; }
          const r = await callTool<any>('detect_inventory_shortfalls', { count_id: e.payload.count_id }, { runId, workflow: 'SYSTEM', actor: 'event-dispatcher', role: 'system' });
          await finish(e.event_id, e.type, r.success ? 'PROCESSED' : 'FAILED', 'detect_inventory_shortfalls', r.success ? r.data : r.error, runId, out);
        } else if (e.type === 'EXCEPTION_DETECTED') {
          if (!auto.auto_investigate) { await finish(e.event_id, e.type, 'SKIPPED', 'auto_investigate off', { reason: 'automation disabled; exception waits in the queue' }, runId, out); continue; }
          try {
            const r = await investigateException(e.payload.exception_id, { actor: 'event-dispatcher (auto-investigate)', mode: opts.mode });
            await finish(e.event_id, e.type, r.outcome === 'FAILED' ? 'FAILED' : 'PROCESSED', 'exception_resolver', { run_id: r.run_id, outcome: r.outcome, mode: r.mode }, runId, out);
          } catch (err) {
            if (err instanceof RunRefused) await finish(e.event_id, e.type, 'SKIPPED', 'exception_resolver', { reason: err.message }, runId, out);
            else throw err;
          }
        } else if (REPLAN_EVENT_TYPES.includes(e.type)) {
          if (!auto.auto_replan) { await finish(e.event_id, e.type, 'SKIPPED', 'auto_replan off', { reason: 'automation disabled; replan manually' }, runId, out); continue; }
          replanBatch.push(e);
        } else {
          await finish(e.event_id, e.type, 'SKIPPED', 'no handler', { reason: 'informational event' }, runId, out);
        }
      } catch (err) {
        await finish(e.event_id, e.type, 'FAILED', 'dispatcher', { error: (err as Error).message }, runId, out);
      }
    }

    if (replanBatch.length) {
      const active = await one(pool, `SELECT version FROM plans WHERE status = 'ACTIVE'`);
      if (!active) {
        for (const e of replanBatch) await finish(e.event_id, e.type, 'SKIPPED', 'auto_replan', { reason: 'no active plan to update' }, runId, out);
      } else {
        const trigger = replanTrigger(replanBatch);
        const detail = `event-driven: ${replanBatch.map((e) => `#${e.event_id} ${e.type}`).join(', ')}`.slice(0, 300);
        const r = await runPlanner(trigger, { detail, actor: 'event-dispatcher (auto-replan)', explain: false });
        // generate_plan already marked these events PROCESSED (absorbed); record the outcome for any left.
        for (const e of replanBatch) {
          const still = await one(pool, `SELECT status FROM domain_events WHERE event_id = $1`, [e.event_id]);
          if (still?.status === 'PENDING') await finish(e.event_id, e.type, r.status === 'COMPLETED' ? 'PROCESSED' : 'FAILED', 'auto_replan', { plan_version: r.plan?.version ?? null, error: r.error }, runId, out);
          else out.handled.push({ event_id: e.event_id, type: e.type, status: still?.status ?? 'UNKNOWN', handled_by: `auto_replan → plan v${r.plan?.version}`, result: { plan_version: r.plan?.version, trigger } });
        }
        await audit(pool, { run_id: runId, workflow: 'SYSTEM', actor: 'event-dispatcher', event_type: 'AUTO_REPLAN', decision_summary: `${replanBatch.length} event(s) coalesced into one replan (${trigger}) → ${r.status === 'COMPLETED' ? `plan v${r.plan.version}` : `FAILED ${r.error?.code}`}`, policy_refs: ['SOP-PLN-003'], outcome: r.status });
      }
    }
  }
  return out;
}

export async function automationEnabled(): Promise<boolean> {
  const a = (await one<{ automation: Automation }>(pool, 'SELECT automation FROM sim_state WHERE id = 1'))?.automation;
  return !!a && (a.auto_detect || a.auto_investigate || a.auto_replan);
}
