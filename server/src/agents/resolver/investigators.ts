/**
 * Exception Investigator — two interchangeable strategies over the same read-only tools.
 *
 *  - deterministic: at every step, asks the assessment which evidence is still missing
 *    given everything learned so far, and calls that tool. The sequence therefore depends
 *    on prior results (linked shipment ids, SKUs on the order, destination mismatch...).
 *  - llm: the model chooses tool calls itself (function calling) and submits a decision;
 *    the guard feeds back missing evidence or bad citations before accepting it.
 */
import { z } from 'zod';
import { callTool, type ToolCtx } from '../../tools/index.js';
import { INVESTIGATION_TOOLS } from '../../tools/read-tools.js';
import type { ExceptionRecord } from '../../domain/types.js';
import type { ChatMessage, LLMProvider, ToolSpec } from '../../llm/provider.js';
import { LLMError } from '../../llm/provider.js';
import { assess } from './assessment.js';
import { Ledger } from './ledger.js';
import type { Proposal } from './guard.js';

const MAX_DETERMINISTIC_STEPS = 25;
const MAX_LLM_TURNS = 12;

export async function deterministicInvestigate(exc: ExceptionRecord, ledger: Ledger, ctx: ToolCtx, selectedBy: 'deterministic' | 'orchestrator' = 'deterministic') {
  for (let i = 0; i < MAX_DETERMINISTIC_STEPS; i++) {
    const a = assess(exc, ledger);
    if (a.complete) return a;
    const next = a.missing_evidence[0];
    const r = await callTool(next.tool, next.input, ctx);
    ledger.record(next.tool, next.input as Record<string, unknown>, r, selectedBy);
  }
  return assess(exc, ledger);
}

export function proposalFromAssessment(exc: ExceptionRecord, ledger: Ledger): Proposal {
  const a = assess(exc, ledger);
  return {
    source: 'deterministic',
    decision: a.decision,
    actions: [...a.actions.map((x) => x.type), ...(a.approval ? [a.approval.action_type] : [])],
    policy_citations: a.required_policies.map((id) => ({ policy_id: id, why: a.policy_why[id] ?? '' })),
    summary: a.detected_issue,
  };
}

// ------------------------------------------------------------------------ LLM
const SubmitDecision = z.object({
  decision: z.enum(['AUTO_ACTION', 'REQUEST_APPROVAL', 'ESCALATE', 'NO_ACTION_NEEDED']),
  actions: z.array(z.string()).default([]),
  policy_citations: z.array(z.object({ policy_id: z.string(), why: z.string() })).default([]),
  findings: z.array(z.string()).default([]),
  unresolved_questions: z.array(z.string()).default([]),
  recommended_human_action: z.string().default(''),
  summary: z.string(),
});

const ACTION_VOCAB = ['HOLD_ORDER', 'SYNC_ORDER_STATUS_FORWARD', 'CANCEL_ORDER', 'RELINK_SHIPMENT', 'ADJUST_INVENTORY', 'RELEASE_HOLD', 'DELETE_ORDER', 'MERGE_ORDERS'];

const SUBMIT_SPEC: ToolSpec = {
  name: 'submit_decision',
  description: 'Submit your decision once you have gathered sufficient evidence and retrieved the governing policies. You do NOT execute actions; the application validates your proposal against policy and executes permitted actions through controlled tools.',
  parameters: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['AUTO_ACTION', 'REQUEST_APPROVAL', 'ESCALATE', 'NO_ACTION_NEEDED'], description: 'AUTO_ACTION = the issue is fully resolved by autonomous actions alone, no human follow-up needed. REQUEST_APPROVAL = an approval-gated action (e.g. cancel) is needed; a hold may accompany it. ESCALATE = a human must investigate or act (records conflict, facts missing, ambiguous, replenishment needed); a hold may accompany it. NO_ACTION_NEEDED = evidence shows no problem.' },
      actions: { type: 'array', items: { type: 'string', enum: ACTION_VOCAB }, description: 'Actions you propose (may be empty). A hold may accompany an escalation or an approval request.' },
      policy_citations: { type: 'array', items: { type: 'object', properties: { policy_id: { type: 'string' }, why: { type: 'string' } }, required: ['policy_id', 'why'] }, description: 'Only policy ids returned by search_policies/get_policy in this investigation.' },
      findings: { type: 'array', items: { type: 'string' }, description: 'Facts established from tool results, with the numbers.' },
      unresolved_questions: { type: 'array', items: { type: 'string' } },
      recommended_human_action: { type: 'string' },
      summary: { type: 'string', description: 'Two or three sentences for the operator, phrased as a recommendation ("Recommend holding ORD-…"). Nothing has been executed yet: never say you performed an action.' },
    },
    required: ['decision', 'actions', 'policy_citations', 'summary'],
  },
};

/** Convert zod input schemas to the conservative JSON-schema subset providers accept. */
function toLLMSchema(schema: z.ZodType): Record<string, unknown> {
  const clean = (n: any): any => {
    if (Array.isArray(n)) return n.map(clean);
    if (!n || typeof n !== 'object') return n;
    const out: any = {};
    for (const k of ['type', 'description', 'enum', 'required']) if (n[k] !== undefined) out[k] = n[k];
    if (n.properties) out.properties = Object.fromEntries(Object.entries(n.properties).map(([k, v]) => [k, clean(v)]));
    if (n.items) out.items = clean(n.items);
    if (n.pattern) out.description = `${out.description ? `${out.description}. ` : ''}Format: ${n.pattern}`;
    return out;
  };
  const js = clean(z.toJSONSchema(schema));
  if (!js.properties) js.properties = {};
  js.type = 'object';
  return js;
}

export const LLM_TOOL_SPECS: ToolSpec[] = [
  ...INVESTIGATION_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: toLLMSchema(t.input) })),
  SUBMIT_SPEC,
];

const SYSTEM_PROMPT = `You are the Exception Investigator in a SIMULATED warehouse operations system (fictional data, no real systems).
Your job: investigate one order exception using the provided read-only tools, then submit a decision with submit_decision.

Rules:
- Ground every statement in tool results. Never invent inventory, shipment, order or policy facts. If a tool fails or a record is missing, say so.
- Choose tools based on what you have learned so far; do not call tools that cannot help.
- Before proposing any action, retrieve the governing SOP with search_policies (and get_policy when you need full text or thresholds), and retrieve the action-authority policy.
- Cite only policy ids returned by search_policies/get_policy in this investigation.
- You cannot execute actions or approve anything; you only propose. Never claim an action was performed. Autonomous actions are only those the authority policy lists as autonomous. Cancelling, merging, relinking or adjusting records require human approval or are prohibited.
- When authoritative records conflict or the case is ambiguous: preserve state, hold unshipped work if permitted, and ESCALATE with the unresolved questions.
- A shipment record or label alone is not evidence that an order shipped.
- Do not do arithmetic you cannot verify from tool outputs; tools return computed facts (effective availability, label age, data issues).
- Be efficient: request independent tool calls in parallel in one turn, never repeat an identical call, and use at most two policy searches plus get_policy for ids you need in full. Call submit_decision as soon as the evidence and policies are in hand.`;

export interface LLMInvestigation { proposal?: Proposal; fallbackReason?: string; llmTurns: number; guardFeedback: string[] }

export async function llmInvestigate(provider: LLMProvider, exc: ExceptionRecord, ledger: Ledger, ctx: ToolCtx): Promise<LLMInvestigation> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Investigate exception ${exc.exception_id} (type ${exc.type}, order ${exc.order_id}). Summary on file: "${exc.summary}". Gather evidence, retrieve policy, then call submit_decision.` },
  ];
  const allowed = new Set(INVESTIGATION_TOOLS.map((t) => t.name));
  const guardFeedback: string[] = [];
  let feedbackRounds = 0;
  let nudges = 0;
  let turns = 0;

  for (; turns < MAX_LLM_TURNS; ) {
    let msg: ChatMessage;
    try {
      turns++;
      msg = await provider.chat(messages, LLM_TOOL_SPECS);
    } catch (e) {
      return { fallbackReason: e instanceof LLMError ? `${e.code}: ${e.message}` : String(e), llmTurns: turns, guardFeedback };
    }
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      if (++nudges > 2) return { fallbackReason: 'Model stopped without calling submit_decision', llmTurns: turns, guardFeedback };
      messages.push({ role: 'user', content: 'Continue: call investigation tools or submit_decision. Do not reply with plain text.' });
      continue;
    }
    for (const tc of msg.tool_calls) {
      let args: any = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = null; }
      const reply = (content: unknown) => messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(content).slice(0, 6000) });

      if (args === null) { reply({ success: false, error: { code: 'INVALID_JSON', message: 'Arguments were not valid JSON' } }); continue; }

      if (tc.function.name === 'submit_decision') {
        const parsed = SubmitDecision.safeParse(args);
        if (!parsed.success) { reply({ accepted: false, error: 'submit_decision arguments failed validation', details: z.treeifyError(parsed.error) }); continue; }
        const a = assess(exc, ledger);
        const retrieved = ledger.retrievedPolicies();
        const badCites = parsed.data.policy_citations.filter((c) => !retrieved.has(c.policy_id)).map((c) => c.policy_id);
        if ((!a.complete || badCites.length) && feedbackRounds < 2) {
          feedbackRounds++;
          const fb = [
            ...(!a.complete ? [`Evidence incomplete. Still required: ${a.missing_evidence.map((m) => `${m.tool}(${JSON.stringify(m.input)}) — ${m.why}`).join('; ')}`] : []),
            ...(badCites.length ? [`Citations not retrieved in this investigation: ${badCites.join(', ')}. Retrieve them or remove them.`] : []),
          ];
          guardFeedback.push(...fb);
          reply({ accepted: false, guard_feedback: fb });
          continue;
        }
        return {
          proposal: { source: 'llm', ...parsed.data },
          llmTurns: turns,
          guardFeedback,
        };
      }

      if (!allowed.has(tc.function.name)) { reply({ success: false, error: { code: 'UNKNOWN_TOOL', message: `${tc.function.name} is not available to the investigator` } }); continue; }
      const r = await callTool(tc.function.name, args, ctx);
      ledger.record(tc.function.name, args, r, 'llm');
      reply(r.success ? { success: true, data: r.data } : { success: false, error: r.error });
    }
  }
  return { fallbackReason: `Step budget (${MAX_LLM_TURNS} model turns) exhausted without an accepted decision`, llmTurns: turns, guardFeedback };
}
