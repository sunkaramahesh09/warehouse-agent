/**
 * Repeated-run evaluation of the Exception Resolver against ground truth.
 * Each run starts from a clean reset, so runs are independent. Results persist in
 * eval_results (survives resets) and feed the Metrics dashboard.
 */
import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { resetEnvironment } from '../db/reset.js';
import { investigateException } from '../agents/resolver/orchestrator.js';
import { EXPECTED_OUTCOME } from '../scenarios/expected.js';
import { unsafeActionAudit, summarizeEval } from '../metrics/metrics.js';

export async function runEvaluation(opts: { mode: 'deterministic' | 'llm'; repetitions: number; exceptions?: string[]; onProgress?: (msg: string) => void }) {
  const batch = `EVAL-${randomUUID().slice(0, 8).toUpperCase()}`;
  const ids = opts.exceptions?.length ? opts.exceptions : Object.keys(EXPECTED_OUTCOME);
  for (let rep = 1; rep <= opts.repetitions; rep++) {
    for (const id of ids) {
      await resetEnvironment();
      const t0 = Date.now();
      const r = await investigateException(id, { mode: opts.mode, actor: 'evaluation-harness' });
      const ms = Date.now() - t0;
      const unsafe = (await unsafeActionAudit()).unsafe_action_count;
      const expected = EXPECTED_OUTCOME[id];
      await pool.query(
        `INSERT INTO eval_results (batch_id, mode_requested, mode_used, model, exception_id, repetition, expected, outcome, correct, proposal, final_decision, agreed, overridden, tool_calls, duration_ms, fallback_reason, unsafe_actions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [batch, opts.mode, r.mode, r.model, id, rep, expected, r.outcome, r.outcome === expected, r.proposal?.decision ?? null, r.decision.kind,
          r.proposal?.source === 'llm' ? r.proposal.decision === r.decision.kind : null, r.guard.overridden, r.steps.length, ms, r.fallback_reason, unsafe],
      );
      opts.onProgress?.(`[${rep}/${opts.repetitions}] ${id}: ${r.outcome} (expected ${expected}) ${r.mode} ${r.steps.length} calls ${ms} ms`);
    }
  }
  await resetEnvironment();
  const rows = (await pool.query('SELECT * FROM eval_results WHERE batch_id = $1 ORDER BY id', [batch])).rows;
  return summarizeEval(rows)[0];
}
