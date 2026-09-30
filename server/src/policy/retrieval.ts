/**
 * Lightweight policy retrieval over the shared `policies` table (the single SOP source
 * for both workflows). Keyword/phrase scoring — deterministic and explainable.
 */
import { many, one, type Db } from '../db/pool.js';
import type { Policy } from '../domain/types.js';

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'is', 'with', 'order', 'orders', 'what', 'how', 'when', 'policy']);
const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_\s-]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));

export interface PolicyHit {
  policy_id: string;
  title: string;
  score: number;
  matched_terms: string[];
  excerpt: string;
  applies_to: string[];
}

export function scorePolicies(policies: Policy[], query: string, workflow?: string): PolicyHit[] {
  const q = query.toLowerCase();
  const tokens = [...new Set(tokenize(query))];
  const hits: PolicyHit[] = [];
  for (const p of policies) {
    if (workflow && !p.applies_to.includes(workflow)) continue;
    let score = 0;
    const matched = new Set<string>();
    for (const k of p.keywords) {
      if (k.includes(' ') ? q.includes(k) : tokens.includes(k)) { score += 3; matched.add(k); }
    }
    const title = p.title.toLowerCase();
    const rule = p.rule.toLowerCase();
    for (const t of tokens) {
      if (title.includes(t)) { score += 2; matched.add(t); }
      else if (rule.includes(t)) { score += 1; matched.add(t); }
    }
    if (score === 0) continue;
    // excerpt: the rule sentence with the most query-term hits
    const sentences = p.rule.split(/(?<=\.)\s+/);
    const best = sentences
      .map((s) => ({ s, n: tokens.filter((t) => s.toLowerCase().includes(t)).length }))
      .sort((a, b) => b.n - a.n)[0];
    hits.push({ policy_id: p.policy_id, title: p.title, score, matched_terms: [...matched], excerpt: best?.s ?? sentences[0], applies_to: p.applies_to });
  }
  return hits.sort((a, b) => b.score - a.score || a.policy_id.localeCompare(b.policy_id));
}

export async function searchPolicies(db: Db, query: string, workflow?: string, limit = 3): Promise<PolicyHit[]> {
  const policies = await many<Policy>(db, 'SELECT * FROM policies ORDER BY policy_id');
  return scorePolicies(policies, query, workflow).slice(0, limit);
}

export async function getPolicy(db: Db, policyId: string): Promise<Policy | null> {
  return one<Policy>(db, 'SELECT * FROM policies WHERE policy_id = $1', [policyId]);
}

/** Planner and guard read their numeric parameters from the same SOP records. */
export async function policyParams(db: Db, policyId: string): Promise<Record<string, any>> {
  const p = await getPolicy(db, policyId);
  if (!p) throw new Error(`Policy ${policyId} missing from the shared SOP store`);
  return p.params;
}
