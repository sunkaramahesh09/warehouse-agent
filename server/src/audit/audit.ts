import type { Db } from '../db/pool.js';

export interface AuditEvent {
  run_id?: string | null;
  workflow: string;
  actor: string;
  event_type: string;
  tool_name?: string | null;
  input?: unknown;
  result?: unknown;
  error?: unknown;
  policy_refs?: string[];
  decision_summary?: string | null;
  proposed_action?: unknown;
  approval_state?: string | null;
  state_changes?: unknown;
  outcome?: string | null;
}

const SECRET_KEY = /(api[_-]?key|secret|password|token|authorization)/i;
const MAX_STR = 2000;
const MAX_ARR = 50;

/** Strip secret-looking keys and bound the size of anything written to the audit trail. */
export function sanitize(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (depth > 6) return '[truncated]';
  if (typeof v === 'string') return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…[truncated]` : v;
  if (Array.isArray(v)) {
    const arr = v.slice(0, MAX_ARR).map((x) => sanitize(x, depth + 1));
    if (v.length > MAX_ARR) arr.push(`[+${v.length - MAX_ARR} more]`);
    return arr;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : sanitize(val, depth + 1);
    }
    return out;
  }
  return v;
}

const j = (v: unknown) => (v === undefined ? null : JSON.stringify(sanitize(v)));

export async function audit(db: Db, e: AuditEvent): Promise<number> {
  const r = await db.query(
    `INSERT INTO audit_events (run_id, sim_time, workflow, actor, event_type, tool_name, input, result, error, policy_refs,
       decision_summary, proposed_action, approval_state, state_changes, outcome)
     VALUES ($1, (SELECT sim_now FROM sim_state WHERE id = 1), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING seq`,
    [
      e.run_id ?? null, e.workflow, e.actor, e.event_type, e.tool_name ?? null,
      j(e.input), j(e.result), j(e.error), e.policy_refs ?? [], e.decision_summary ?? null,
      j(e.proposed_action), e.approval_state ?? null, j(e.state_changes), e.outcome ?? null,
    ],
  );
  return r.rows[0].seq;
}
