/**
 * Order Exception Resolver orchestrator.
 *
 *   get_exception -> investigate (LLM or deterministic) -> assessment -> guard ->
 *   execute permitted actions via controlled tools -> verify by re-reading state ->
 *   approval request / escalation / resolution -> audit + structured report
 *
 * The report's action outcomes come ONLY from tool results; model text never
 * substitutes for a confirmed state change.
 */
import { callTool, type ToolCtx } from '../../tools/index.js';
import type { ExceptionRecord } from '../../domain/types.js';
import { getProvider } from '../../llm/index.js';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { audit } from '../../audit/audit.js';
import { getPolicy } from '../../policy/retrieval.js';
import { finishRun, newRunId, startRun } from '../runs.js';
import { assess, type Assessment } from './assessment.js';
import { guard, type FinalDecision, type Proposal } from './guard.js';
import { deterministicInvestigate, llmInvestigate, proposalFromAssessment } from './investigators.js';
import { Ledger } from './ledger.js';
import type { EscalationPayload } from '../../tools/action-tools.js';

const CLAIMED_ACTION = /\b(i have|i've|i|has been|have been|was|were)\s+(already\s+)?(placed|held|put|cancell?ed|updated|synced|synchronized|escalated|marked|moved|resolved|executed)\b/i;

export type Outcome = 'AUTO_RESOLVED' | 'HELD_AND_ESCALATED' | 'ESCALATED' | 'AWAITING_APPROVAL' | 'NO_ACTION_NEEDED' | 'FAILED';

export interface ActionRecord {
  tool: string;
  input: unknown;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  duplicate?: boolean;
  verification?: string;
}

export interface ResolverReport {
  run_id: string;
  exception_id: string;
  order_id: string;
  exception_type: string;
  mode: string;
  model: string | null;
  fallback_reason: string | null;
  simulated: true;
  steps: Array<{ n: number; tool: string; input: unknown; ok: boolean; summary: string; selected_by: string; audit_seq?: number }>;
  detected_issue: string;
  findings: string[];
  conflicting_facts: string[];
  missing_facts: string[];
  policies: FinalDecision['citations'];
  proposal: Pick<Proposal, 'source' | 'decision' | 'actions' | 'summary'> | null;
  guard: { notes: string[]; overridden: boolean; llm_feedback: string[] };
  decision: { kind: string; outcome_label: string };
  actions: ActionRecord[];
  approval: { approval_id: string; action_type: string; effect: string; reason: string; status: string } | null;
  escalation: { escalation_id: string; payload: EscalationPayload } | null;
  outcome: Outcome;
  final_state: { order_status: string | null; exception_status: string | null; hold_exception_id?: string | null };
  narrative: string;
}

export interface InvestigateOptions { actor?: string; mode?: 'auto' | 'llm' | 'deterministic' }

export class RunRefused extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}

const REFUSE_STATUSES: Record<string, string> = {
  AWAITING_APPROVAL: 'An approval proposal is already pending for this exception; decide it instead of re-running.',
  RESOLVED: 'Exception is already resolved; re-running would duplicate side effects.',
  CLOSED: 'Exception was closed by a reviewer.',
  ESCALATED: 'Exception is escalated and waiting for the Exception Reviewer.',
  INVESTIGATING: 'Another investigation of this exception is in progress.',
};

export async function investigateException(exceptionId: string, opts: InvestigateOptions = {}): Promise<ResolverReport> {
  const actor = opts.actor ?? 'exception-resolver';
  const wantMode = opts.mode ?? config.agentMode;
  const provider = wantMode === 'deterministic' ? null : getProvider();
  if (wantMode === 'llm' && !provider) throw new RunRefused('LLM_NOT_CONFIGURED', 'LLM mode requested but LLM_API_KEY is not configured');
  const mode = provider ? 'llm' : 'deterministic';

  const runId = newRunId('RUN');
  const ctx: ToolCtx = { runId, workflow: 'EXCEPTION_RESOLVER', actor, role: 'agent' };
  const ledger = new Ledger();

  // Step 1 (orchestrator): load the exception through the controlled tool.
  const pre = await callTool<ExceptionRecord>('get_exception', { exception_id: exceptionId }, { ...ctx, runId: `${runId}` });
  if (!pre.success) throw new RunRefused(pre.error.code, pre.error.message);
  const exc = pre.data;
  if (REFUSE_STATUSES[exc.status]) {
    await audit(pool, { run_id: runId, workflow: 'EXCEPTION_RESOLVER', actor, event_type: 'RUN_REFUSED', input: { exception_id: exceptionId }, decision_summary: REFUSE_STATUSES[exc.status], outcome: 'DUPLICATE_RUN_REFUSED' });
    throw new RunRefused('ALREADY_HANDLED', REFUSE_STATUSES[exc.status], { status: exc.status });
  }

  await startRun('EXCEPTION_RESOLVER', exceptionId, mode, actor, runId);
  ledger.record('get_exception', { exception_id: exceptionId }, pre, 'orchestrator');
  const mark = await callTool('update_exception_status', { exception_id: exceptionId, status: 'INVESTIGATING', outcome: 'INVESTIGATING', run_id: runId }, ctx);
  if (!mark.success) {
    const report = failedReport(runId, exc, mode, `Could not mark exception as investigating: ${mark.error.code}`, ledger);
    await finishRun(runId, 'EXCEPTION_RESOLVER', actor, 'FAILED', report, 'FAILED');
    return report;
  }

  try {
    return await runBody(exc, ledger, ctx, provider, mode, actor);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await callTool('update_exception_status', { exception_id: exc.exception_id, status: 'FAILED', outcome: 'RUN_ERROR', run_id: runId, resolution: { error: msg } }, { ...ctx, role: 'system' });
    const report = failedReport(runId, exc, mode, `Unexpected error: ${msg}`, ledger);
    await finishRun(runId, 'EXCEPTION_RESOLVER', actor, 'FAILED', report, 'FAILED');
    return report;
  }
}

async function runBody(exc: ExceptionRecord, ledger: Ledger, ctx: ToolCtx, provider: ReturnType<typeof getProvider>, mode: string, actor: string): Promise<ResolverReport> {
  const runId = ctx.runId;
  // ---- investigate --------------------------------------------------------------
  let proposal: Proposal;
  let fallbackReason: string | null = null;
  let llmFeedback: string[] = [];
  let effectiveMode = mode;
  if (provider) {
    const r = await llmInvestigate(provider, exc, ledger, ctx);
    llmFeedback = r.guardFeedback;
    if (r.proposal) {
      proposal = r.proposal;
      if (!assess(exc, ledger).complete) await deterministicInvestigate(exc, ledger, ctx, 'orchestrator');
    } else {
      fallbackReason = r.fallbackReason ?? 'unknown';
      effectiveMode = 'llm->deterministic';
      await audit(pool, { run_id: runId, workflow: 'EXCEPTION_RESOLVER', actor, event_type: 'LLM_FALLBACK', decision_summary: `LLM investigation did not complete (${fallbackReason}); continuing deterministically from the same evidence`, outcome: 'FALLBACK' });
      await deterministicInvestigate(exc, ledger, ctx);
      proposal = proposalFromAssessment(exc, ledger);
    }
  } else {
    await deterministicInvestigate(exc, ledger, ctx);
    proposal = proposalFromAssessment(exc, ledger);
  }

  // ---- guard -------------------------------------------------------------------
  const a = assess(exc, ledger);
  const authority = (await getPolicy(pool, 'SOP-APR-001'))?.params as any ?? null;
  const final = guard(proposal, a, ledger, authority);
  // Model text is never evidence of success. Flag any pre-execution claim of having acted.
  if (proposal.source === 'llm' && CLAIMED_ACTION.test(proposal.summary)) {
    final.guard_notes.push('Agent text claimed an action was already performed before anything executed; claim ignored — action outcomes below come only from controlled tool results.');
  }
  await audit(pool, {
    run_id: runId, workflow: 'EXCEPTION_RESOLVER', actor, event_type: 'DECISION',
    policy_refs: final.citations.map((c) => c.policy_id),
    decision_summary: `${a.detected_issue || 'Assessment'} → ${final.kind} (${final.outcome_label})${final.overridden ? ' [guard override]' : ''}`,
    proposed_action: { proposal: { source: proposal.source, decision: proposal.decision, actions: proposal.actions }, final: { kind: final.kind, actions: final.actions, approval: final.approval ?? null } },
    result: { guard_notes: final.guard_notes, findings: a.findings, conflicting_facts: a.conflicting_facts },
    outcome: final.outcome_label,
  });

  // ---- execute ------------------------------------------------------------------
  const actions: ActionRecord[] = [];
  let outcome: Outcome = final.outcome_label;
  let approval: ResolverReport['approval'] = null;
  let escalation: ResolverReport['escalation'] = null;
  let failure: string | null = null;

  for (const act of final.actions) {
    const tool = act.type === 'HOLD_ORDER' ? 'hold_order' : 'sync_order_status';
    const r = await callTool(tool, act.params, ctx);
    const rec: ActionRecord = { tool, input: act.params, ok: r.success, ...(r.success ? { result: r.data, duplicate: r.duplicate } : { error: r.error }) };
    if (!r.success) {
      // A tool error is not evidence of success OR failure: verify by re-reading state.
      const v = await callTool<any>('get_order', { order_id: act.params.order_id }, ctx);
      ledger.record('get_order', { order_id: act.params.order_id }, v, 'orchestrator');
      const applied = v.success && (act.type === 'HOLD_ORDER' ? v.data.status === 'ON_HOLD' && v.data.hold_exception_id === exc.exception_id : v.data.status === act.params.to_status);
      rec.verification = !v.success
        ? `Verification read failed (${v.error.code}); action status UNKNOWN`
        : applied ? 'Verification read shows the change IS present (applied despite error)' : `Verification read shows order still ${v.data.status}: change NOT applied`;
      actions.push(rec);
      if (!applied) { failure = `${tool} failed (${r.error.code}: ${r.error.message}). ${rec.verification}.`; break; }
      continue;
    }
    actions.push(rec);
  }

  if (!failure && final.approval) {
    const r = await callTool<any>('request_approval', { exception_id: exc.exception_id, run_id: runId, action_type: final.approval.action_type, params: final.approval.params, reason: final.approval.reason, effect: final.approval.effect, policy_ids: final.citations.map((c) => c.policy_id) }, ctx);
    actions.push({ tool: 'request_approval', input: final.approval, ok: r.success, ...(r.success ? { result: r.data, duplicate: r.duplicate } : { error: r.error }) });
    if (r.success) approval = { approval_id: r.data.approval_id, action_type: final.approval.action_type, effect: final.approval.effect, reason: final.approval.reason, status: r.data.status };
    else failure = `request_approval failed (${r.error.code}: ${r.error.message}); nothing is awaiting approval.`;
  }

  if (!failure && final.escalate) {
    const payload = buildEscalation(exc, a, final, ledger, actions);
    const r = await callTool<any>('create_escalation', { run_id: runId, payload }, ctx);
    actions.push({ tool: 'create_escalation', input: { exception_id: exc.exception_id }, ok: r.success, ...(r.success ? { result: r.data } : { error: r.error }) });
    if (r.success) escalation = { escalation_id: r.data.escalation_id, payload };
    else failure = `create_escalation failed (${r.error.code}: ${r.error.message}); the escalation was NOT recorded.`;
  }

  if (!failure && (final.kind === 'AUTO_ACTION' || final.kind === 'NO_ACTION_NEEDED')) {
    const r = await callTool('update_exception_status', {
      exception_id: exc.exception_id, status: 'RESOLVED', outcome: final.outcome_label, run_id: runId,
      resolution: { detected_issue: a.detected_issue, actions: actions.filter((x) => x.ok).map((x) => ({ tool: x.tool, input: x.input })), policies: final.citations.map((c) => c.policy_id) },
    }, ctx);
    actions.push({ tool: 'update_exception_status', input: { status: 'RESOLVED' }, ok: r.success, ...(r.success ? { result: r.data } : { error: r.error }) });
    if (!r.success) failure = `Could not record resolution (${r.error.code}).`;
  }

  if (failure) {
    outcome = 'FAILED';
    await callTool('update_exception_status', { exception_id: exc.exception_id, status: 'FAILED', outcome: 'ACTION_FAILED', run_id: runId, resolution: { failure } }, { ...ctx, role: 'system' });
    await audit(pool, { run_id: runId, workflow: 'EXCEPTION_RESOLVER', actor, event_type: 'FAILURE', error: { message: failure }, decision_summary: 'No success recorded. Re-running is safe: mutating tools are idempotent.', outcome: 'FAILED' });
  }

  // ---- verify final state --------------------------------------------------------
  const finalOrder = await callTool<any>('get_order', { order_id: exc.order_id }, ctx);
  const finalExc = await callTool<any>('get_exception', { exception_id: exc.exception_id }, ctx);

  const report: ResolverReport = {
    run_id: runId,
    exception_id: exc.exception_id,
    order_id: exc.order_id,
    exception_type: exc.type,
    mode: effectiveMode,
    model: provider ? provider.model : null,
    fallback_reason: fallbackReason,
    simulated: true,
    steps: ledger.entries.map((e) => ({ n: e.n, tool: e.tool, input: e.input, ok: e.ok, summary: e.summary, selected_by: e.selected_by, audit_seq: e.audit_seq })),
    detected_issue: a.detected_issue,
    findings: a.findings,
    conflicting_facts: a.conflicting_facts,
    missing_facts: a.missing_facts,
    policies: final.citations,
    proposal: { source: proposal.source, decision: proposal.decision, actions: proposal.actions, summary: proposal.summary },
    guard: { notes: final.guard_notes, overridden: final.overridden, llm_feedback: llmFeedback },
    decision: { kind: final.kind, outcome_label: final.outcome_label },
    actions,
    approval,
    escalation,
    outcome,
    final_state: {
      order_status: finalOrder.success ? finalOrder.data.status : null,
      exception_status: finalExc.success ? finalExc.data.status : null,
      hold_exception_id: finalOrder.success ? finalOrder.data.hold_exception_id : null,
    },
    narrative: '',
  };
  report.narrative = narrate(report, failure, proposal);
  await finishRun(runId, 'EXCEPTION_RESOLVER', actor, outcome === 'FAILED' ? 'FAILED' : 'COMPLETED', report, outcome, effectiveMode);
  return report;
}

function buildEscalation(exc: ExceptionRecord, a: Assessment, final: FinalDecision, ledger: Ledger, actions: ActionRecord[]): EscalationPayload {
  const order = ledger.get('get_order', { order_id: exc.order_id });
  return {
    exception_id: exc.exception_id,
    order_id: exc.order_id,
    detected_issue: a.detected_issue || `${exc.type}: evidence incomplete`,
    evidence_checked: ledger.entries.map((e) => `${e.tool}(${Object.values(e.input).join(', ')})`),
    tool_results: ledger.entries.map((e) => ({ tool: e.tool, ok: e.ok, summary: e.summary })),
    conflicting_facts: a.conflicting_facts,
    missing_facts: a.missing_facts,
    policy_refs: final.citations.map((c) => ({ policy_id: c.policy_id, title: c.title, excerpt: c.excerpt, why: c.why })),
    recommended_human_action: a.recommended_human_action || 'Review the evidence and decide manually.',
    actions_already_taken: actions.filter((x) => x.ok).map((x) => `${x.tool}${x.duplicate ? ' (already applied earlier; no duplicate)' : ''}: ${JSON.stringify(x.result)}`),
    current_state: { order_status: actions.find((x) => x.tool === 'hold_order' && x.ok) ? 'ON_HOLD' : order?.status ?? 'UNKNOWN', exception_status: 'ESCALATED', guard_notes: final.guard_notes },
    unresolved_questions: a.unresolved_questions,
  };
}

function narrate(r: ResolverReport, failure: string | null, p: Proposal): string {
  const parts: string[] = [];
  parts.push(`Investigated ${r.exception_id} (${r.exception_type}) on ${r.order_id} with ${r.steps.length} tool call(s) [${r.mode}${r.fallback_reason ? `; fallback: ${r.fallback_reason}` : ''}].`);
  if (r.detected_issue) parts.push(`Finding: ${r.detected_issue}.`);
  if (p.source === 'llm' && p.summary) parts.push(`Agent analysis (before execution): ${p.summary}`);
  for (const x of r.actions) {
    if (x.ok) parts.push(`✓ ${x.tool} confirmed by tool${x.duplicate ? ' (duplicate suppressed — already applied)' : ''}.`);
    else parts.push(`✗ ${x.tool} did NOT succeed: ${x.error?.code}. ${x.verification ?? ''}`);
  }
  if (failure) parts.push(`Outcome FAILED — action status was verified, no success recorded. ${failure} Retrying is safe (idempotent tools).`);
  else if (r.outcome === 'AWAITING_APPROVAL') parts.push(`Nothing irreversible executed. Waiting for explicit operator approval of ${r.approval?.action_type} (${r.approval?.approval_id}).`);
  else if (r.escalation) parts.push(`Escalated as ${r.escalation.escalation_id} to the Exception Reviewer.`);
  parts.push(`Final state (re-read): order ${r.final_state.order_status ?? 'unknown'}, exception ${r.final_state.exception_status ?? 'unknown'}.`);
  return parts.join(' ');
}

function failedReport(runId: string, exc: ExceptionRecord, mode: string, msg: string, ledger: Ledger): ResolverReport {
  return {
    run_id: runId, exception_id: exc.exception_id, order_id: exc.order_id, exception_type: exc.type, mode, model: null, fallback_reason: null, simulated: true,
    steps: ledger.entries.map((e) => ({ n: e.n, tool: e.tool, input: e.input, ok: e.ok, summary: e.summary, selected_by: e.selected_by })),
    detected_issue: '', findings: [], conflicting_facts: [], missing_facts: [msg], policies: [], proposal: null,
    guard: { notes: [], overridden: false, llm_feedback: [] }, decision: { kind: 'NONE', outcome_label: 'FAILED' }, actions: [], approval: null, escalation: null,
    outcome: 'FAILED', final_state: { order_status: null, exception_status: null }, narrative: `Run failed before investigation: ${msg}. No action taken.`,
  };
}

// ---------------------------------------------------------------- operator approval flow
export async function decideApproval(approvalId: string, decision: 'APPROVE' | 'REJECT', actor: string, note?: string) {
  const runId = newRunId('OPR');
  const ctx: ToolCtx = { runId, workflow: 'OPERATOR', actor, role: 'operator' };
  const d = await callTool<any>('decide_approval', { approval_id: approvalId, decision, note }, ctx);
  if (!d.success) return { ok: false, step: 'decide', error: d.error };
  if (d.data.status === 'EXPIRED') {
    return { ok: false, step: 'decide', error: { code: 'APPROVAL_EXPIRED', message: 'Approval window expired; nothing executed. The exception must be escalated.' } };
  }
  if (d.data.status === 'REJECTED') {
    const payload: EscalationPayload = {
      exception_id: d.data.exception_id, order_id: '', detected_issue: `Operator rejected ${d.data.action_type} (${approvalId})`,
      evidence_checked: [], tool_results: [], conflicting_facts: [], missing_facts: [],
      policy_refs: [], recommended_human_action: 'Reviewer decides whether to release the hold or take another action.',
      actions_already_taken: [`${approvalId} rejected by ${actor}${note ? `: ${note}` : ''}; nothing executed`], current_state: { approval: 'REJECTED' },
      unresolved_questions: ['If this is not a duplicate/incorrect record, should the hold be released?'],
    };
    const exc = await callTool<any>('get_exception', { exception_id: d.data.exception_id }, ctx);
    if (exc.success) payload.order_id = exc.data.order_id;
    const e = await callTool<any>('create_escalation', { run_id: runId, payload }, { ...ctx, role: 'system' });
    return { ok: true, decision: 'REJECTED', executed: false, escalation_id: e.success ? e.data.escalation_id : null };
  }
  return executeApproval(approvalId, actor, runId);
}

export async function executeApproval(approvalId: string, actor: string, runId = newRunId('OPR')) {
  const ctx: ToolCtx = { runId, workflow: 'OPERATOR', actor, role: 'operator' };
  const x = await callTool<any>('execute_approved_action', { approval_id: approvalId }, ctx);
  if (!x.success) {
    return {
      ok: false, step: 'execute', error: x.error,
      message: x.error.code === 'TIMEOUT'
        ? 'Execution status unknown because the execution tool timed out. No success was recorded; the approval is still APPROVED and execution can be retried safely (exactly-once).'
        : `Execution failed: ${x.error.message}`,
    };
  }
  return { ok: true, decision: 'APPROVED', executed: true, duplicate: x.duplicate ?? false, result: x.data };
}
