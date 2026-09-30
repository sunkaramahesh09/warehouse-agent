import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool, withTx, one } from './pool.js';
import * as seed from './seed.js';
import sop from '../policy/sop.json' with { type: 'json' };

const dir = import.meta.dirname;
const RESET_LOCK = 424242;

/**
 * Drop every simulation table and recreate the baseline seed. `scenario_results`
 * (test history) is kept. Runs in one transaction under an advisory lock so a reset
 * can never interleave with another reset.
 */
export async function resetEnvironment(): Promise<{ seedVersion: string; counts: Record<string, number> }> {
  const schema = readFileSync(join(dir, 'schema.sql'), 'utf8');
  const meta = readFileSync(join(dir, 'meta.sql'), 'utf8');

  return withTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [RESET_LOCK]);
    const { rows } = await c.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'scenario_results'`,
    );
    if (rows.length) await c.query(`DROP TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
    await c.query(schema);
    await c.query(meta);

    await c.query(
      `INSERT INTO sim_state (sim_now, shift_start, shift_end, seed_version) VALUES ($1,$2,$3,$4)`,
      [seed.SIM_NOW, seed.SHIFT_START, seed.SHIFT_END, seed.SEED_VERSION],
    );
    for (const p of sop) {
      await c.query(
        `INSERT INTO policies (policy_id, title, rule, applies_to, keywords, params) VALUES ($1,$2,$3,$4,$5,$6)`,
        [p.policy_id, p.title, p.rule, p.applies_to, p.keywords, JSON.stringify(p.params ?? {})],
      );
    }
    for (const l of seed.locations) {
      await c.query(`INSERT INTO locations VALUES ($1,$2,$3,$4)`, [l.location_id, l.zone, l.aisle, l.x]);
    }
    for (const s of seed.skus) {
      await c.query(`INSERT INTO skus VALUES ($1,$2,$3,$4)`, [s.sku, s.description, s.pick_minutes_per_unit, s.required_skill]);
    }
    for (const i of seed.inventory) {
      await c.query(
        `INSERT INTO inventory (sku, location_id, on_hand, reserved, last_updated) VALUES ($1,$2,$3,$4,$5)`,
        [i.sku, i.location_id, i.on_hand, i.reserved, i.last_updated],
      );
    }
    for (const cc of seed.inventoryCounts) {
      await c.query(`INSERT INTO inventory_counts VALUES ($1,$2,$3,$4,$5,$6)`, [
        cc.count_id, cc.sku, cc.location_id, cc.counted_qty, cc.counted_at, cc.counted_by,
      ]);
    }
    for (const p of seed.pickers) {
      await c.query(`INSERT INTO pickers VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        p.picker_id, p.display_name, p.availability, p.unavailable_reason, p.capacity_minutes, p.home_zone, p.skills,
      ]);
    }
    for (const o of seed.orders) {
      await c.query(
        `INSERT INTO orders (order_id, status, priority, created_at, deadline, customer_ref, destination_ref, assigned_picker_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [o.order_id, o.status, o.priority, o.created_at, o.deadline, o.customer_ref, o.destination_ref, o.assigned_picker_id ?? null, o.created_at],
      );
      let n = 1;
      for (const [sku, req, picked] of o.lines) {
        await c.query(`INSERT INTO order_lines VALUES ($1,$2,$3,$4,$5,$6)`, [
          `${o.order_id}-L${n}`, o.order_id, n, sku, req, picked,
        ]);
        n++;
      }
    }
    for (const s of seed.shipments) {
      await c.query(`INSERT INTO shipments VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        s.shipment_id, s.order_id, s.status, s.carrier, s.tracking_ref, s.destination_ref, s.label_created_at, s.picked_up_at, s.last_scan_at,
      ]);
    }
    for (const e of seed.exceptions) {
      await c.query(
        `INSERT INTO exceptions (exception_id, order_id, type, status, summary, evidence_refs, detected_at) VALUES ($1,$2,$3,'OPEN',$4,$5,$6)`,
        [e.exception_id, e.order_id, e.type, e.summary, JSON.stringify(e.evidence_refs), e.detected_at],
      );
    }
    await c.query(
      `INSERT INTO audit_events (workflow, actor, event_type, decision_summary, outcome, sim_time)
       VALUES ('SYSTEM','system','ENVIRONMENT_RESET',$1,'RESET',$2)`,
      [`Environment reset to ${seed.SEED_VERSION}`, seed.SIM_NOW],
    );

    const counts: Record<string, number> = {};
    for (const t of ['orders', 'order_lines', 'skus', 'inventory', 'shipments', 'pickers', 'exceptions', 'policies']) {
      counts[t] = Number((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
    }
    return { seedVersion: seed.SEED_VERSION, counts };
  });
}

/** Seed on first boot (e.g. fresh deployment database). */
export async function ensureSeeded(): Promise<boolean> {
  const exists = await one<{ t: string | null }>(pool, `SELECT to_regclass('public.sim_state')::text AS t`);
  if (exists?.t) return false;
  await resetEnvironment();
  return true;
}
