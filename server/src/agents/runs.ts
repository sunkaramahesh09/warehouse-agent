import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { audit } from '../audit/audit.js';
import type { Workflow } from '../tools/framework.js';

export const newRunId = (prefix = 'RUN') => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;

export async function startRun(workflow: Workflow, subjectId: string | null, mode: string, actor: string, runId = newRunId()) {
  await pool.query(`INSERT INTO agent_runs (run_id, workflow, subject_id, mode, status) VALUES ($1,$2,$3,$4,'RUNNING')`, [runId, workflow, subjectId, mode]);
  await audit(pool, { run_id: runId, workflow, actor, event_type: 'RUN_STARTED', decision_summary: `${workflow} run on ${subjectId ?? 'shift'} (mode: ${mode})` });
  return runId;
}

export async function finishRun(runId: string, workflow: Workflow, actor: string, status: 'COMPLETED' | 'FAILED', report: unknown, outcome: string, mode?: string) {
  await pool.query(`UPDATE agent_runs SET status = $2, finished_at = now(), report = $3, mode = COALESCE($4, mode) WHERE run_id = $1`, [runId, status, JSON.stringify(report), mode ?? null]);
  await audit(pool, { run_id: runId, workflow, actor, event_type: 'RUN_COMPLETED', outcome, decision_summary: `Run ${status}: ${outcome}` });
}
