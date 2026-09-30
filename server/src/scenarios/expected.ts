/**
 * Ground truth for evaluation ONLY (never visible to the agent): the policy-correct outcome
 * of each seeded exception from the baseline state (see docs/SCENARIOS.md).
 */
export const EXPECTED_OUTCOME: Record<string, string> = {
  'EXC-2001': 'HELD_AND_ESCALATED',
  'EXC-2002': 'AWAITING_APPROVAL',
  'EXC-2003': 'AUTO_RESOLVED',
  'EXC-2004': 'ESCALATED',
  'EXC-2005': 'HELD_AND_ESCALATED',
  'EXC-2006': 'ESCALATED',
  'EXC-2007': 'HELD_AND_ESCALATED',
};
export const isEscalation = (o: string | null | undefined) => o === 'ESCALATED' || o === 'HELD_AND_ESCALATED';
