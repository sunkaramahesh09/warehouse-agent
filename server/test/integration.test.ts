/**
 * Integration tests against a real PostgreSQL test database (TEST_DATABASE_URL,
 * default postgres://postgres:postgres@localhost:5433/warehouse_test).
 * Every named scenario must PASS; plus direct safety checks on the tool layer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { resetEnvironment } from '../src/db/reset.js';
import { SCENARIOS, runScenario } from '../src/scenarios/definitions.js';
import { callTool } from '../src/tools/index.js';

beforeAll(async () => { await resetEnvironment(); });
afterAll(async () => { await pool.end(); });

describe('named scenarios (deterministic mode)', () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: ${s.title}`, async () => {
      const r = await runScenario(s, 'deterministic');
      const failed = r.checks.filter((c) => !c.pass);
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    });
  }
});

describe('controlled tool layer', () => {
  const agent = { runId: 'T', workflow: 'EXCEPTION_RESOLVER' as const, actor: 'test', role: 'agent' as const };

  it('rejects malformed input at the schema boundary', async () => {
    await resetEnvironment();
    const r = await callTool('get_order', { order_id: "1; DROP TABLE orders" }, agent);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.code).toBe('INVALID_INPUT');
  });

  it('agents cannot call operator-only tools', async () => {
    const r = await callTool('execute_approved_action', { approval_id: 'APR-ABCDEF12' }, agent);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('forward sync refuses when SOP-SOT-002 conditions are not met (defence in depth)', async () => {
    const r = await callTool('sync_order_status', { order_id: 'ORD-1008', shipment_id: 'SHP-5008', to_status: 'SHIPPED', exception_id: 'EXC-2004', policy_id: 'SOP-SOT-002' }, agent);
    expect(r.success).toBe(false);
  });

  it('actions citing a non-existent policy are refused', async () => {
    const r = await callTool('hold_order', { order_id: 'ORD-1001', exception_id: 'EXC-2001', reason: 'test hold reason', policy_id: 'SOP-ZZZ-001' }, agent);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.code).toBe('POLICY_NOT_FOUND');
  });

  it('cannot hold a terminal (SHIPPED) order', async () => {
    const r = await callTool('hold_order', { order_id: 'ORD-1019', exception_id: 'EXC-2004', reason: 'test hold reason', policy_id: 'SOP-SOT-002' }, agent);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('every tool call leaves an audit event', async () => {
    const before = (await pool.query('SELECT count(*)::int n FROM audit_events')).rows[0].n;
    await callTool('get_order', { order_id: 'ORD-1001' }, agent);
    await callTool('get_order', { order_id: 'ORD-9999' }, agent);
    const after = (await pool.query('SELECT count(*)::int n FROM audit_events')).rows[0].n;
    expect(after - before).toBe(2);
  });
});
