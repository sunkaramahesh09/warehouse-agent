/**
 * Controlled tool framework.
 *
 *   request -> zod input validation -> fault injection check -> [tx: idempotency guard ->
 *   business rules + execution] -> audit event -> structured ToolResult
 *
 * Every read and every mutation in the system goes through executeTool(). Agents
 * (LLM or deterministic) never receive a database handle.
 */
import { z } from 'zod';
import type pg from 'pg';
import { pool, withTx, one } from '../db/pool.js';
import { config } from '../config.js';
import { audit } from '../audit/audit.js';

export type Workflow = 'EXCEPTION_RESOLVER' | 'SHIFT_PLANNER' | 'OPERATOR' | 'SCENARIO' | 'SYSTEM';
export type Role = 'agent' | 'operator' | 'reviewer' | 'system';

export interface ToolCtx {
  runId: string;
  workflow: Workflow;
  actor: string;
  role: Role;
}

export class ToolError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** Fields a tool handler can attach to its audit event. */
export interface AuditNote {
  event_type?: string;
  policy_refs?: string[];
  decision_summary?: string;
  proposed_action?: unknown;
  approval_state?: string;
  state_changes?: unknown;
  outcome?: string;
}

export type ToolResult<T = unknown> =
  | { success: true; data: T; duplicate?: boolean; auditSeq?: number }
  | { success: false; error: { code: string; message: string; details?: unknown }; auditSeq?: number };

export interface Tool<I = any, O = any> {
  name: string;
  description: string;
  kind: 'read' | 'action';
  /** Roles allowed to invoke. Approval decisions are operator-only, escalation resolution reviewer-only. */
  roles: Role[];
  input: z.ZodType<I>;
  run: (c: pg.PoolClient, input: I, ctx: ToolCtx, note: AuditNote) => Promise<O>;
  /** Mutations that must never be applied twice supply an idempotency key. */
  idempotencyKey?: (input: I) => string;
}

export function defineTool<S extends z.ZodType, O>(t: Omit<Tool<z.infer<S>, O>, 'input'> & { input: S }): Tool<z.infer<S>, O> {
  return t as Tool<z.infer<S>, O>;
}

async function consumeFault(toolName: string): Promise<null | { mode: string }> {
  return withTx(async (c) => {
    const row = await one<{ faults: Record<string, { mode: string; remaining: number }> }>(c, 'SELECT faults FROM sim_state WHERE id = 1 FOR UPDATE');
    const f = row?.faults?.[toolName];
    if (!f || f.remaining <= 0) return null;
    const faults = { ...row!.faults };
    if (f.remaining - 1 <= 0) delete faults[toolName];
    else faults[toolName] = { ...f, remaining: f.remaining - 1 };
    await c.query('UPDATE sim_state SET faults = $1 WHERE id = 1', [JSON.stringify(faults)]);
    return { mode: f.mode };
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ToolError('TIMEOUT', `${name} did not complete within ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function executeTool<I, O>(tool: Tool<I, O>, rawInput: unknown, ctx: ToolCtx): Promise<ToolResult<O>> {
  const base = { run_id: ctx.runId, workflow: ctx.workflow, actor: ctx.actor, tool_name: tool.name };

  // 1. role check
  if (!tool.roles.includes(ctx.role)) {
    const error = { code: 'FORBIDDEN', message: `Role '${ctx.role}' may not call ${tool.name} (allowed: ${tool.roles.join(', ')})` };
    const seq = await audit(pool, { ...base, event_type: 'TOOL_REJECTED', input: rawInput, error, outcome: 'REJECTED' });
    return { success: false, error, auditSeq: seq };
  }

  // 2. schema validation
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    const error = { code: 'INVALID_INPUT', message: 'Input failed schema validation', details: z.treeifyError(parsed.error) };
    const seq = await audit(pool, { ...base, event_type: 'TOOL_REJECTED', input: rawInput, error, outcome: 'REJECTED' });
    return { success: false, error, auditSeq: seq };
  }
  const input = parsed.data;

  // 3. simulated upstream failure (fault injection) - nothing is executed
  const fault = await consumeFault(tool.name);
  if (fault) {
    const error = fault.mode === 'TIMEOUT'
      ? { code: 'TIMEOUT', message: `${tool.name} timed out (simulated). Outcome unknown; no success was recorded.` }
      : { code: 'UPSTREAM_ERROR', message: `${tool.name} failed with a simulated upstream error.` };
    const seq = await audit(pool, { ...base, event_type: 'TOOL_FAILURE', input, error, outcome: error.code });
    return { success: false, error, auditSeq: seq };
  }

  // 4. execute inside a transaction, guarded by idempotency key for mutations
  const note: AuditNote = {};
  const key = tool.idempotencyKey?.(input);
  try {
    const out = await withTx(async (c) => {
      await c.query(`SET LOCAL statement_timeout = ${Math.max(1000, config.toolTimeoutMs)}`);
      if (key) {
        const ins = await c.query(
          `INSERT INTO action_log (idempotency_key, action, run_id, result) VALUES ($1,$2,$3,'{}') ON CONFLICT DO NOTHING RETURNING 1`,
          [key, tool.name, ctx.runId],
        );
        if (ins.rowCount === 0) {
          const prior = await one<{ result: O; run_id: string }>(c, 'SELECT result, run_id FROM action_log WHERE idempotency_key = $1', [key]);
          return { duplicate: true as const, data: prior!.result, priorRun: prior!.run_id };
        }
      }
      const data = await withTimeout(tool.run(c, input, ctx, note), config.toolTimeoutMs, tool.name);
      if (key) await c.query('UPDATE action_log SET result = $2 WHERE idempotency_key = $1', [key, JSON.stringify(data)]);
      return { duplicate: false as const, data };
    });

    if (out.duplicate) {
      const seq = await audit(pool, {
        ...base, event_type: 'DUPLICATE_SUPPRESSED', input, result: out.data,
        decision_summary: `Idempotency key ${key} already executed (run ${out.priorRun}); no second side effect`, outcome: 'DUPLICATE',
      });
      return { success: true, data: out.data, duplicate: true, auditSeq: seq };
    }
    const seq = await audit(pool, {
      ...base,
      event_type: note.event_type ?? (tool.kind === 'read' ? 'TOOL_CALL' : 'ACTION'),
      input,
      result: out.data,
      policy_refs: note.policy_refs,
      decision_summary: note.decision_summary,
      proposed_action: note.proposed_action,
      approval_state: note.approval_state,
      state_changes: note.state_changes,
      outcome: note.outcome ?? 'OK',
    });
    return { success: true, data: out.data, auditSeq: seq };
  } catch (e) {
    const error = e instanceof ToolError
      ? { code: e.code, message: e.message, details: e.details }
      : { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e) };
    const seq = await audit(pool, { ...base, event_type: 'TOOL_ERROR', input, error, outcome: error.code });
    return { success: false, error, auditSeq: seq };
  }
}
