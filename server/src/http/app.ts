/**
 * HTTP transport. Thin: validates request shape, maps the caller's role header to a
 * tool role, and delegates to the same services the scenario runner uses.
 * Role separation is basic (header-based, no authentication) — see README.
 */
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { pool, many, one } from '../db/pool.js';
import { resetEnvironment } from '../db/reset.js';
import { callTool, type ToolCtx } from '../tools/index.js';
import { investigateException, decideApproval, executeApproval, RunRefused } from '../agents/resolver/orchestrator.js';
import { runPlanner } from '../planner/service.js';
import { PLAN_TRIGGERS } from '../tools/planner-tools.js';
import { SCENARIOS, scenarioById, runScenario } from '../scenarios/definitions.js';
import { describeLLM } from '../llm/index.js';
import { effectiveAvailability } from '../domain/rules.js';
import * as repo from '../tools/repo.js';
import type { Role } from '../tools/framework.js';

// Serialize state-changing requests: one simulated warehouse, one writer at a time.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

function caller(req: FastifyRequest): { role: Role; actor: string } {
  const r = String(req.headers['x-role'] ?? 'operator').toLowerCase();
  const role: Role = r === 'reviewer' ? 'reviewer' : 'operator';
  const actor = String(req.headers['x-actor'] ?? (role === 'reviewer' ? 'exception-reviewer' : 'operator')).slice(0, 40).replace(/[^\w .-]/g, '');
  return { role, actor };
}
const opCtx = (req: FastifyRequest, runId = 'UI'): ToolCtx => {
  const c = caller(req);
  return { runId, workflow: 'OPERATOR', actor: c.actor, role: c.role };
};

function sendTool(reply: FastifyReply, r: { success: boolean; error?: { code: string } }) {
  if (r.success) return reply.send(r);
  const code = r.error!.code;
  const status = code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : code === 'INVALID_INPUT' ? 400 : code === 'TIMEOUT' ? 504 : 409;
  return reply.status(status).send(r);
}

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization'] } });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof RunRefused) return reply.status(409).send({ success: false, error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof z.ZodError) return reply.status(400).send({ success: false, error: { code: 'INVALID_INPUT', message: 'Request failed validation', details: z.treeifyError(err) } });
    app.log.error(err);
    return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  });

  // ------------------------------------------------------------------ meta / state
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/meta', async () => {
    const st = await repo.simState(pool);
    const active = await one(pool, `SELECT version FROM plans WHERE status = 'ACTIVE'`);
    return { simulated: true, sim: st, llm: describeLLM(), active_plan_version: active?.version ?? null };
  });

  app.get('/api/dashboard', async () => {
    const orders = await many(pool, 'SELECT status, count(*)::int n FROM orders GROUP BY status');
    const exc = await many(pool, 'SELECT status, count(*)::int n FROM exceptions GROUP BY status');
    const pickers = await many(pool, 'SELECT availability, count(*)::int n FROM pickers GROUP BY availability');
    const plan = await one(pool, `SELECT version, trigger, summary, sim_time FROM plans WHERE status = 'ACTIVE'`);
    const approvals = await one(pool, `SELECT count(*)::int n FROM approvals WHERE status = 'PENDING'`);
    const escalations = await one(pool, `SELECT count(*)::int n FROM escalations WHERE status = 'OPEN'`);
    const recent = await many(pool, `SELECT seq, ts, sim_time, workflow, event_type, tool_name, decision_summary, outcome FROM audit_events WHERE event_type NOT IN ('TOOL_CALL') ORDER BY seq DESC LIMIT 12`);
    return { orders, exceptions: exc, pickers, plan, pending_approvals: approvals!.n, open_escalations: escalations!.n, recent };
  });

  app.get('/api/orders', async () => {
    const orders = await repo.allOrders(pool);
    const lines = await repo.allLines(pool);
    const ships = await many(pool, 'SELECT shipment_id, order_id, status FROM shipments');
    const exc = await many(pool, 'SELECT exception_id, order_id, type, status FROM exceptions');
    const plan = await one(pool, `SELECT version FROM plans WHERE status = 'ACTIVE'`);
    const rows = plan ? await many(pool, 'SELECT order_id, status, picker_id, inventory_readiness, block_reason FROM plan_assignments WHERE plan_version = $1', [plan.version]) : [];
    return orders.map((o) => ({
      ...o,
      lines: lines.filter((l) => l.order_id === o.order_id),
      shipments: ships.filter((s) => s.order_id === o.order_id),
      exceptions: exc.filter((e) => e.order_id === o.order_id),
      plan: rows.find((r) => r.order_id === o.order_id) ?? null,
    }));
  });

  app.get('/api/inventory', async () => {
    const rows = await repo.inventoryRows(pool);
    const counts = await repo.inventoryCounts(pool);
    const skus = [...(await repo.allSkus(pool)).values()];
    return skus.map((s) => ({ ...s, locations: rows.filter((r) => r.sku === s.sku), counts: counts.filter((c) => c.sku === s.sku), availability: effectiveAvailability(s.sku, rows, counts) }));
  });

  app.get('/api/pickers', async (req, reply) => sendTool(reply, await callTool('get_picker_status', {}, opCtx(req))));
  app.get('/api/shipments', async () => many(pool, 'SELECT * FROM shipments ORDER BY shipment_id'));
  app.get('/api/policies', async () => many(pool, 'SELECT * FROM policies ORDER BY policy_id'));

  // ------------------------------------------------------------------ exceptions
  app.get('/api/exceptions', async () => {
    const list = await many(pool, 'SELECT * FROM exceptions ORDER BY exception_id');
    const approvals = await many(pool, 'SELECT * FROM approvals ORDER BY requested_at DESC');
    const escalations = await many(pool, 'SELECT * FROM escalations ORDER BY created_at DESC');
    const runs = await many(pool, `SELECT run_id, subject_id, status, mode, started_at, report->>'outcome' AS outcome, report->'policies' AS policies, report->'decision' AS decision FROM agent_runs WHERE workflow = 'EXCEPTION_RESOLVER' ORDER BY started_at DESC`);
    return list.map((e) => ({
      ...e,
      approvals: approvals.filter((a) => a.exception_id === e.exception_id),
      escalations: escalations.filter((x) => x.exception_id === e.exception_id),
      last_run: runs.find((r) => r.subject_id === e.exception_id) ?? null,
    }));
  });

  app.get('/api/exceptions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const e = await one(pool, 'SELECT * FROM exceptions WHERE exception_id = $1', [id]);
    if (!e) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: `${id} not found` } });
    return {
      ...e,
      runs: await many(pool, `SELECT * FROM agent_runs WHERE subject_id = $1 ORDER BY started_at DESC`, [id]),
      approvals: await many(pool, 'SELECT * FROM approvals WHERE exception_id = $1 ORDER BY requested_at DESC', [id]),
      escalations: await many(pool, 'SELECT * FROM escalations WHERE exception_id = $1 ORDER BY created_at DESC', [id]),
    };
  });

  app.post('/api/exceptions/:id/investigate', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ mode: z.enum(['auto', 'llm', 'deterministic']).optional() }).parse(req.body ?? {});
    const { actor } = caller(req);
    return exclusive(() => investigateException(id, { mode: body.mode, actor: `resolver (started by ${actor})` }));
  });

  app.get('/api/approvals', async () => many(pool, `SELECT a.*, e.order_id, e.type FROM approvals a JOIN exceptions e USING (exception_id) ORDER BY a.requested_at DESC`));

  app.post('/api/approvals/:id/decide', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(500).optional() }).parse(req.body);
    const c = caller(req);
    if (c.role !== 'operator') return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only the Operator role may approve or reject proposals' } });
    const r = await exclusive(() => decideApproval(id, body.decision, c.actor, body.note));
    return reply.status((r as any).ok ? 200 : 409).send(r);
  });

  app.post('/api/approvals/:id/execute', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = caller(req);
    if (c.role !== 'operator') return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only the Operator role may execute approved actions' } });
    const r = await exclusive(() => executeApproval(id, c.actor));
    return reply.status(r.ok ? 200 : 409).send(r);
  });

  app.get('/api/escalations', async () => many(pool, `SELECT x.*, e.type, e.order_id FROM escalations x JOIN exceptions e USING (exception_id) ORDER BY x.status, x.created_at DESC`));

  app.post('/api/escalations/:id/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ resolution_note: z.string().min(5).max(1000), release_hold: z.boolean().default(false) }).parse(req.body);
    return sendTool(reply, await exclusive(() => callTool('resolve_escalation', { escalation_id: id, ...body }, opCtx(req))));
  });

  // ------------------------------------------------------------------ planner
  app.get('/api/plans', async () => many(pool, 'SELECT version, status, trigger, trigger_detail, parent_version, run_id, created_at, sim_time, summary, change_log, explanation FROM plans ORDER BY version DESC'));
  app.get('/api/plans/:version', async (req, reply) => {
    const v = Number((req.params as any).version);
    const plan = await one(pool, 'SELECT * FROM plans WHERE version = $1', [v]);
    if (!plan) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: `Plan v${v} not found` } });
    const assignments = await many(pool, `SELECT pa.*, o.priority, o.status AS order_status FROM plan_assignments pa JOIN orders o USING (order_id) WHERE plan_version = $1
      ORDER BY CASE pa.status WHEN 'COMPLETED' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'BLOCKED' THEN 3 ELSE 4 END, priority_rank, order_id`, [v]);
    return { plan, assignments };
  });
  app.post('/api/planner/run', async (req) => {
    const body = z.object({ trigger: z.enum(PLAN_TRIGGERS).default('MANUAL_REFRESH'), detail: z.string().max(300).optional() }).parse(req.body ?? {});
    const { actor } = caller(req);
    return exclusive(() => runPlanner(body.trigger, { detail: body.detail, actor: `planner (started by ${actor})` }));
  });

  // ------------------------------------------------------------------ simulation controls (operator)
  const sim = (path: string, tool: string, schema: z.ZodType) =>
    app.post(path, async (req, reply) => {
      const c = caller(req);
      if (c.role !== 'operator') return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Simulation controls are Operator-only' } });
      return sendTool(reply, await exclusive(() => callTool(tool, schema.parse(req.body ?? {}), opCtx(req))));
    });
  sim('/api/sim/picker', 'set_picker_availability', z.any());
  sim('/api/sim/urgent-order', 'inject_urgent_order', z.any());
  sim('/api/sim/inventory', 'simulate_inventory_change', z.any());
  sim('/api/sim/advance', 'advance_clock', z.any());
  sim('/api/sim/fault', 'inject_fault', z.any());

  // ------------------------------------------------------------------ audit / runs
  app.get('/api/audit', async (req) => {
    const q = z.object({ run_id: z.string().optional(), workflow: z.string().optional(), event_type: z.string().optional(), include_reads: z.enum(['true', 'false']).default('true'), limit: z.coerce.number().int().min(1).max(1000).default(300) }).parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.run_id) { params.push(q.run_id); where.push(`run_id = $${params.length}`); }
    if (q.workflow) { params.push(q.workflow); where.push(`workflow = $${params.length}`); }
    if (q.event_type) { params.push(q.event_type); where.push(`event_type = $${params.length}`); }
    if (q.include_reads === 'false') where.push(`event_type <> 'TOOL_CALL'`);
    params.push(q.limit);
    return many(pool, `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT $${params.length}`, params);
  });
  app.get('/api/audit/export.jsonl', async (_req, reply) => {
    const rows = await many(pool, 'SELECT * FROM audit_events ORDER BY seq');
    reply.header('content-type', 'application/x-ndjson').header('content-disposition', 'attachment; filename="audit.jsonl"');
    return rows.map((r) => JSON.stringify(r)).join('\n');
  });
  app.get('/api/runs/:id', async (req, reply) => {
    const run = await one(pool, 'SELECT * FROM agent_runs WHERE run_id = $1', [(req.params as any).id]);
    if (!run) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'run not found' } });
    return run;
  });

  // ------------------------------------------------------------------ scenarios / reset
  app.get('/api/scenarios', async () => {
    const latest = await many(pool, `SELECT DISTINCT ON (scenario_id) * FROM scenario_results ORDER BY scenario_id, run_at DESC`);
    return SCENARIOS.map(({ run, ...s }) => ({ ...s, last_result: latest.find((l) => l.scenario_id === s.id) ?? null }));
  });
  app.post('/api/scenarios/:id/run', async (req, reply) => {
    const s = scenarioById((req.params as any).id);
    if (!s) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'unknown scenario' } });
    const body = z.object({ mode: z.enum(['deterministic', 'llm']).default('deterministic') }).parse(req.body ?? {});
    if (body.mode === 'llm' && !describeLLM().configured) return reply.status(409).send({ success: false, error: { code: 'LLM_NOT_CONFIGURED', message: 'Set LLM_API_KEY to run scenarios in LLM mode' } });
    return exclusive(() => runScenario(s, body.mode));
  });
  app.post('/api/scenarios/run-all', async () => exclusive(async () => {
    const out = [];
    for (const s of SCENARIOS) out.push(await runScenario(s, 'deterministic'));
    await resetEnvironment();
    return out.map(({ artifacts, ...r }) => r);
  }));
  app.post('/api/reset', async (req, reply) => {
    if (caller(req).role !== 'operator') return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Reset is Operator-only' } });
    return exclusive(() => resetEnvironment());
  });

  // ------------------------------------------------------------------ static web app
  const webDist = join(import.meta.dirname, '../../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No such endpoint' } }) : reply.sendFile('index.html')));
  }
  return app;
}
