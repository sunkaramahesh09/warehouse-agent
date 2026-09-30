/**
 * Policy guard: the only path from a proposal (LLM or deterministic) to an executable
 * decision. It enforces, deterministically:
 *   - evidence completeness (assessment.complete)
 *   - citation validity: a cited policy must have been retrieved in THIS run
 *   - action authority (SOP-APR-001): prohibited / approval-required actions
 *   - conservatism: the final decision is never less conservative than the assessment
 */
import { CONSERVATISM, type Assessment, type DecisionKind, type PlannedAction } from './assessment.js';
import type { Ledger } from './ledger.js';

export interface Proposal {
  source: 'llm' | 'deterministic';
  decision: DecisionKind;
  actions: string[];
  policy_citations: Array<{ policy_id: string; why: string }>;
  summary: string;
  findings?: string[];
  unresolved_questions?: string[];
  recommended_human_action?: string;
}

export interface Citation { policy_id: string; title: string; excerpt: string; why: string; cited_by: 'agent' | 'guard' }

export interface FinalDecision {
  kind: DecisionKind;
  actions: PlannedAction[];
  approval?: Assessment['approval'];
  escalate: boolean;
  outcome_label: Assessment['outcome_label'];
  citations: Citation[];
  guard_notes: string[];
  overridden: boolean;
}

export function guard(proposal: Proposal, a: Assessment, ledger: Ledger, authority: { prohibited: string[]; approval_required: string[]; autonomous: string[] } | null): FinalDecision {
  const notes: string[] = [];
  const retrieved = ledger.retrievedPolicies();

  if (!authority) {
    notes.push('SOP-APR-001 (action authority) could not be loaded: no action is permitted; escalating (policy gap).');
    return { kind: 'ESCALATE', actions: [], escalate: true, outcome_label: 'ESCALATED', citations: [], guard_notes: notes, overridden: true };
  }
  if (!a.complete) {
    notes.push(`Evidence incomplete (${a.missing_evidence.map((m) => m.tool).join(', ')}); escalating instead of acting.`);
    return { kind: 'ESCALATE', actions: [], escalate: true, outcome_label: 'ESCALATED', citations: [], guard_notes: notes, overridden: true };
  }

  // citations: only policies retrieved in this run are citable
  const citations: Citation[] = [];
  for (const c of proposal.policy_citations) {
    const p = retrieved.get(c.policy_id);
    if (!p) { notes.push(`Rejected citation ${c.policy_id}: not retrieved in this run (possible fabrication).`); continue; }
    if (!citations.some((x) => x.policy_id === c.policy_id)) citations.push({ policy_id: c.policy_id, title: p.title, excerpt: p.excerpt, why: c.why || a.policy_why[c.policy_id] || '', cited_by: 'agent' });
  }
  for (const id of a.required_policies) {
    if (citations.some((x) => x.policy_id === id)) continue;
    const p = retrieved.get(id);
    if (!p) { notes.push(`Required policy ${id} was never retrieved: policy gap, escalating.`); return { kind: 'ESCALATE', actions: [], escalate: true, outcome_label: 'ESCALATED', citations, guard_notes: notes, overridden: true }; }
    citations.push({ policy_id: id, title: p.title, excerpt: p.excerpt, why: a.policy_why[id] ?? '', cited_by: 'guard' });
    if (proposal.source === 'llm') notes.push(`Added governing policy ${id} that the agent did not cite.`);
  }

  // action authority
  let violation = false;
  for (const act of proposal.actions) {
    if (authority.prohibited.includes(act)) { notes.push(`Proposed ${act} is PROHIBITED for agents (SOP-APR-001); discarded.`); violation = true; }
    else if (authority.approval_required.includes(act) && proposal.decision === 'AUTO_ACTION') { notes.push(`Proposed ${act} autonomously, but SOP-APR-001 requires explicit approval.`); violation = true; }
  }

  const fromAssessment = (overridden: boolean): FinalDecision => ({
    kind: a.decision, actions: a.actions, approval: a.approval, escalate: a.escalate, outcome_label: a.outcome_label, citations, guard_notes: notes, overridden,
  });

  const pc = CONSERVATISM[proposal.decision];
  const ac = CONSERVATISM[a.decision];
  if (violation || pc < ac) {
    if (pc < ac) notes.push(`Proposal ${proposal.decision} is less conservative than the evidence/policy assessment ${a.decision}; using ${a.decision}.`);
    return fromAssessment(true);
  }
  if (pc > ac) {
    // the agent chose to be more careful than required: honour it, keep only safe holds
    notes.push(`Proposal ${proposal.decision} is more conservative than required (${a.decision}); honoured. Only reversible holds are executed.`);
    if (proposal.decision === 'REQUEST_APPROVAL' && !a.approval) {
      notes.push('No approval-gated action applies here; converting to escalation.');
    }
    const holds = a.actions.filter((x) => x.type === 'HOLD_ORDER');
    const approval = proposal.decision === 'REQUEST_APPROVAL' ? a.approval : undefined;
    if (approval) return { kind: 'REQUEST_APPROVAL', actions: holds, approval, escalate: false, outcome_label: 'AWAITING_APPROVAL', citations, guard_notes: notes, overridden: false };
    return { kind: 'ESCALATE', actions: holds, escalate: true, outcome_label: holds.length ? 'HELD_AND_ESCALATED' : 'ESCALATED', citations, guard_notes: notes, overridden: false };
  }
  notes.push(`Proposal ${proposal.decision} matches the deterministic assessment; accepted.`);
  return fromAssessment(false);
}
