/**
 * Shift Planner agent: obtains current state through tools, retrieves the shared SOP,
 * calls the deterministic planner tool, and explains the result. The LLM (if configured)
 * only rewords precomputed numbers; it never decides assignments or capacity.
 */
import { callTool, type ToolCtx } from '../tools/index.js';
import { getProvider } from '../llm/index.js';
import { finishRun, newRunId, startRun } from '../agents/runs.js';
import { pool } from '../db/pool.js';
import type { PLAN_TRIGGERS } from '../tools/planner-tools.js';

export type PlanTrigger = (typeof PLAN_TRIGGERS)[number];

export interface PlannerReport {
  run_id: string;
  status: 'COMPLETED' | 'FAILED';
  mode: string;
  simulated: true;
  trigger: PlanTrigger;
  steps: Array<{ tool: string; ok: boolean; summary: string }>;
  policies: Array<{ policy_id: string; title: string; excerpt: string }>;
  plan: any | null;
  error: { code: string; message: string; kind: 'SYSTEM_FAILURE' } | null;
  explanation: string;
}

export async function runPlanner(trigger: PlanTrigger, opts: { detail?: string; actor?: string; explain?: boolean } = {}): Promise<PlannerReport> {
  const actor = opts.actor ?? 'shift-planner';
  const provider = opts.explain === false ? null : getProvider();
  const runId = newRunId('PLN');
  await startRun('SHIFT_PLANNER', 'shift', provider ? 'deterministic+llm-explanation' : 'deterministic', actor, runId);
  const ctx: ToolCtx = { runId, workflow: 'SHIFT_PLANNER', actor, role: 'agent' };
  const steps: PlannerReport['steps'] = [];

  const pickers = await callTool<any[]>('get_picker_status', {}, ctx);
  steps.push({ tool: 'get_picker_status', ok: pickers.success, summary: pickers.success ? `${pickers.data.filter((p) => p.availability === 'AVAILABLE').length}/${pickers.data.length} pickers available` : pickers.error.code });
  const current = await callTool<any>('get_current_plan', {}, ctx);
  steps.push({ tool: 'get_current_plan', ok: current.success, summary: current.success ? (current.data.plan ? `active plan v${current.data.plan.version}` : 'no active plan') : current.error.code });
  const pol = await callTool<any>('search_policies', { query: 'planning priority deadline capacity picker replanning' }, ctx);
  steps.push({ tool: 'search_policies', ok: pol.success, summary: pol.success ? `hits: ${pol.data.hits.map((h: any) => h.policy_id).join(', ')}` : pol.error.code });
  const policies = pol.success ? pol.data.hits.map((h: any) => ({ policy_id: h.policy_id, title: h.title, excerpt: h.excerpt })) : [];

  const gen = await callTool<any>('generate_plan', { trigger, trigger_detail: opts.detail, run_id: runId }, ctx);
  steps.push({ tool: 'generate_plan', ok: gen.success, summary: gen.success ? `plan v${gen.data.version}: ${gen.data.summary.assigned} assigned, ${gen.data.summary.blocked} blocked, ${gen.data.summary.infeasible} infeasible` : `${gen.error.code}: ${gen.error.message}` });

  if (!gen.success) {
    const prev = current.success && current.data.plan ? `v${current.data.plan.version}` : 'none';
    const report: PlannerReport = {
      run_id: runId, status: 'FAILED', mode: 'deterministic', simulated: true, trigger, steps, policies, plan: null,
      error: { code: gen.error.code, message: gen.error.message, kind: 'SYSTEM_FAILURE' },
      explanation: `Planner SYSTEM FAILURE (${gen.error.code}) — this is not an infeasibility result. No new plan version was written; the previously active plan (${prev}) remains in effect. Retry the planner.`,
    };
    await finishRun(runId, 'SHIFT_PLANNER', actor, 'FAILED', report, 'PLANNER_ERROR');
    return report;
  }

  const plan = gen.data;
  let explanation = templateExplanation(plan);
  let mode = 'deterministic';
  if (provider) {
    try {
      const facts = {
        version: plan.version, trigger, parent_version: plan.parent_version, summary: plan.summary, pickers: plan.pickers,
        assignments: plan.assignments.map((a: any) => ({ order: a.order_id, status: a.status, picker: a.picker_id, seq: a.sequence, rank: a.priority_rank, workload_min: a.workload_minutes, est_finish: a.est_finish?.slice(11, 16), deadline: a.deadline.slice(11, 16), sla_at_risk: a.sla_at_risk, reason: a.block_reason, change: a.change_type })),
        change_log: plan.change_log, policies: policies.map((p: any) => p.policy_id),
      };
      const msg = await provider.chat([
        { role: 'system', content: 'You explain a warehouse shift plan to a supervisor in a SIMULATED system. Use ONLY the numbers and facts provided; do not compute new numbers, do not change assignments, do not invent orders. Reference policy ids only from the list given. Be concise: 4-8 short bullet points covering priorities, blocked/infeasible work (with exception ids), SLA risks, and what changed versus the previous version.' },
        { role: 'user', content: JSON.stringify(facts) },
      ], []);
      if (msg.content && msg.content.trim().length > 20) { explanation = msg.content.trim(); mode = 'deterministic+llm-explanation'; }
    } catch (e) {
      explanation += `\n\n(LLM explanation unavailable: ${(e as Error).message.slice(0, 120)}; deterministic summary shown.)`;
    }
  }
  await pool.query('UPDATE plans SET explanation = $2 WHERE version = $1', [plan.version, explanation]);
  const report: PlannerReport = { run_id: runId, status: 'COMPLETED', mode, simulated: true, trigger, steps, policies, plan, error: null, explanation };
  await finishRun(runId, 'SHIFT_PLANNER', actor, 'COMPLETED', { ...report, plan: { version: plan.version, summary: plan.summary, change_log: plan.change_log } }, `PLAN_V${plan.version}`, mode);
  return report;
}

export function templateExplanation(plan: any): string {
  const s = plan.summary;
  const lines = [
    `Plan v${plan.version} (${plan.trigger}${plan.parent_version ? `, incremental from v${plan.parent_version}` : ''}) at simulated ${plan.sim_time.slice(11, 16)}: ${s.assigned} assigned, ${s.in_progress} in progress, ${s.completed} completed, ${s.blocked} blocked, ${s.infeasible} infeasible, ${s.sla_at_risk} at SLA risk.`,
    `Priority order follows SOP-PLN-001 (in-progress first, then deadline urgency bucket, explicit priority, deadline). Capacity/skill/inventory are hard constraints (SOP-PLN-002).`,
  ];
  for (const a of plan.assignments.filter((x: any) => x.status === 'BLOCKED' || x.status === 'INFEASIBLE')) {
    lines.push(`• ${a.order_id} ${a.status}${a.exception_ref ? ` (blocked by ${a.exception_ref})` : ''}: ${a.block_reason}`);
  }
  for (const a of plan.assignments.filter((x: any) => x.sla_at_risk)) lines.push(`• ${a.order_id} at SLA risk: est. finish ${a.est_finish?.slice(11, 16)} vs deadline ${a.deadline.slice(11, 16)}.`);
  if (plan.change_log?.length) {
    lines.push(`Changes vs v${plan.parent_version} (SOP-PLN-003):`);
    for (const c of plan.change_log) lines.push(`• ${c.order_id} ${c.change_type}: ${c.from} → ${c.to}. ${c.reason}`);
  }
  if (plan.metrics) lines.push(`${plan.metrics.preserved} assignment(s) preserved, ${plan.metrics.changed} changed.`);
  return lines.join('\n');
}
