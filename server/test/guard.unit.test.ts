import { describe, expect, it } from 'vitest';
import { guard, type Proposal } from '../src/agents/resolver/guard.js';
import type { Assessment } from '../src/agents/resolver/assessment.js';
import { Ledger } from '../src/agents/resolver/ledger.js';

const AUTH = { autonomous: ['HOLD_ORDER', 'SYNC_ORDER_STATUS_FORWARD', 'CREATE_ESCALATION', 'REQUEST_APPROVAL'], approval_required: ['CANCEL_ORDER', 'RELINK_SHIPMENT', 'ADJUST_INVENTORY', 'RELEASE_HOLD'], prohibited: ['DELETE_ORDER', 'MERGE_ORDERS'] };

function ledgerWith(...ids: string[]) {
  const l = new Ledger();
  l.record('search_policies', { query: 'q' }, { success: true, data: { query: 'q', hits: ids.map((id) => ({ policy_id: id, title: id, excerpt: 'x' })) } }, 'llm');
  return l;
}
const assessment = (p: Partial<Assessment>): Assessment => ({
  complete: true, missing_evidence: [], detected_issue: 'issue', findings: [], conflicting_facts: [], missing_facts: [], required_policies: ['SOP-EXC-002'],
  policy_why: { 'SOP-EXC-002': 'why' }, decision: 'REQUEST_APPROVAL', actions: [{ type: 'HOLD_ORDER', params: { order_id: 'ORD-1011' } }],
  approval: { action_type: 'CANCEL_ORDER', params: { order_id: 'ORD-1011' }, effect: 'e', reason: 'r' }, escalate: false, outcome_label: 'AWAITING_APPROVAL',
  recommended_human_action: '', unresolved_questions: [], ...p,
});
const proposal = (p: Partial<Proposal>): Proposal => ({ source: 'llm', decision: 'REQUEST_APPROVAL', actions: [], policy_citations: [{ policy_id: 'SOP-EXC-002', why: 'dup' }], summary: 's', ...p });

describe('policy guard', () => {
  it('rejects citations that were not retrieved in the run', () => {
    const f = guard(proposal({ policy_citations: [{ policy_id: 'SOP-XXX-999', why: 'made up' }] }), assessment({}), ledgerWith('SOP-EXC-002'), AUTH);
    expect(f.guard_notes.join()).toMatch(/Rejected citation SOP-XXX-999/);
    expect(f.citations.map((c) => c.policy_id)).toEqual(['SOP-EXC-002']);
  });

  it('overrides an autonomous cancel/delete to the approval-gated decision', () => {
    const f = guard(proposal({ decision: 'AUTO_ACTION', actions: ['CANCEL_ORDER', 'DELETE_ORDER'] }), assessment({}), ledgerWith('SOP-EXC-002'), AUTH);
    expect(f.overridden).toBe(true);
    expect(f.kind).toBe('REQUEST_APPROVAL');
    expect(f.actions.map((a) => a.type)).toEqual(['HOLD_ORDER']);
    expect(f.guard_notes.join()).toMatch(/PROHIBITED/);
  });

  it('never lets a less conservative proposal through', () => {
    const f = guard(proposal({ decision: 'NO_ACTION_NEEDED' }), assessment({ decision: 'ESCALATE', escalate: true, approval: undefined, outcome_label: 'HELD_AND_ESCALATED' }), ledgerWith('SOP-EXC-002'), AUTH);
    expect(f.kind).toBe('ESCALATE');
  });

  it('honours a more conservative proposal but executes only holds', () => {
    const a = assessment({ decision: 'AUTO_ACTION', approval: undefined, actions: [{ type: 'SYNC_ORDER_STATUS_FORWARD', params: {} }], escalate: false, outcome_label: 'AUTO_RESOLVED' });
    const f = guard(proposal({ decision: 'ESCALATE' }), a, ledgerWith('SOP-EXC-002'), AUTH);
    expect(f.kind).toBe('ESCALATE');
    expect(f.actions).toEqual([]);
  });

  it('escalates when evidence is incomplete or the authority policy is missing', () => {
    expect(guard(proposal({}), assessment({ complete: false, missing_evidence: [{ tool: 'get_inventory', input: {}, why: '' }] }), ledgerWith('SOP-EXC-002'), AUTH).kind).toBe('ESCALATE');
    expect(guard(proposal({}), assessment({}), ledgerWith('SOP-EXC-002'), null).kind).toBe('ESCALATE');
  });

  it('escalates on a policy gap (required policy never retrieved)', () => {
    const f = guard(proposal({ policy_citations: [] }), assessment({}), ledgerWith(), AUTH);
    expect(f.kind).toBe('ESCALATE');
    expect(f.guard_notes.join()).toMatch(/policy gap/);
  });
});
