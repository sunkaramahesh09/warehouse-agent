import { resetEnvironment } from '../src/db/reset.js';
import { pool } from '../src/db/pool.js';
import { investigateException } from '../src/agents/resolver/orchestrator.js';
await resetEnvironment();
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['EXC-2001','EXC-2002','EXC-2003','EXC-2004','EXC-2005','EXC-2006','EXC-2007'];
for (const id of ids) {
  const r = await investigateException(id, { mode: (process.env.MODE as any) ?? 'deterministic' });
  console.log(`\n=== ${id} ${r.exception_type} → ${r.outcome} (${r.mode})`);
  for (const s of r.steps) console.log(`  ${s.n}. [${s.selected_by}] ${s.tool} ${s.ok ? '✓' : '✗'} ${s.summary}`);
  console.log('  issue:', r.detected_issue);
  console.log('  policies:', r.policies.map(p => p.policy_id).join(', '));
  console.log('  guard:', r.guard.notes.join(' | '));
  console.log('  actions:', r.actions.map(a => `${a.tool}:${a.ok ? 'ok' : a.error?.code}`).join(', '));
  if (r.approval) console.log('  approval:', r.approval.approval_id, r.approval.effect);
  if (r.escalation) console.log('  escalation Qs:', r.escalation.payload.unresolved_questions.join(' / '));
  console.log('  final:', JSON.stringify(r.final_state));
}
await pool.end();
