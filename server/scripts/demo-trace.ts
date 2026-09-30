/**
 * npm run demo:trace — runs the demo storyline end to end on a fresh environment and writes
 * the resulting audit trail to docs/results/audit-log-example.{jsonl,md}.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool, many } from '../src/db/pool.js';
import { resetEnvironment } from '../src/db/reset.js';
import { callTool } from '../src/tools/index.js';
import { investigateException, decideApproval } from '../src/agents/resolver/orchestrator.js';
import { runPlanner } from '../src/planner/service.js';

const mode = process.argv.includes('--llm') ? 'llm' : 'deterministic';
const OP = { runId: 'DEMO', workflow: 'OPERATOR' as const, actor: 'operator (demo)', role: 'operator' as const };
await resetEnvironment();
await runPlanner('INITIAL', { explain: false });
await investigateException('EXC-2003', { mode });                 // autonomous
await investigateException('EXC-2004', { mode });                 // escalation
const dup = await investigateException('EXC-2002', { mode });     // confirmation-gated
await decideApproval(dup.approval!.approval_id, 'APPROVE', 'operator (demo)', 'Customer confirmed a single order');
await investigateException('EXC-2007', { mode });                 // ambiguous
await investigateException('EXC-2001', { mode });                 // shortfall → hold
await runPlanner('EXCEPTION_HOLD', { detail: 'after EXC-2001', explain: false }); // cross-agent
await callTool('advance_clock', { minutes: 45 }, OP);
await callTool('set_picker_availability', { picker_id: 'P-02', availability: 'UNAVAILABLE', reason: 'Went home sick at 08:45' }, OP);
await runPlanner('PICKER_UNAVAILABLE', { detail: 'P-02 unavailable', explain: false }); // replanning

const rows = await many(pool, 'SELECT * FROM audit_events ORDER BY seq');
const dir = join(import.meta.dirname, '../../docs/results');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'audit-log-example.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const key = rows.filter((r) => r.event_type !== 'TOOL_CALL');
const md = [
  `# Audit log example (${mode} agent)`, '',
  `Produced by \`npm run demo:trace${mode === 'llm' ? ' -- --llm' : ''}\`: plan v1 → EXC-2003 (autonomous) → EXC-2004 (escalation) → EXC-2002 (approval → approved) → EXC-2007 (ambiguous) → EXC-2001 (shortfall hold) → plan v2 (cross-agent) → +45 min → P-02 unavailable → plan v3.`, '',
  `Full trail (${rows.length} events, including ${rows.length - key.length} read-only tool calls): \`audit-log-example.jsonl\`. Below: the ${key.length} non-read events.`, '',
  '| # | Sim | Workflow | Run | Event | Tool | Summary | Policy | Approval | Outcome |', '|---|---|---|---|---|---|---|---|---|---|',
  ...key.map((r) => `| ${r.seq} | ${r.sim_time?.slice(11, 16) ?? ''} | ${r.workflow} | ${r.run_id ?? ''} | ${r.event_type} | ${r.tool_name ?? ''} | ${(r.decision_summary ?? (r.error ? `${r.error.code}` : '')).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 160)} | ${(r.policy_refs ?? []).join(', ')} | ${r.approval_state ?? ''} | ${r.outcome ?? ''} |`),
].join('\n');
writeFileSync(join(dir, 'audit-log-example.md'), md + '\n');
console.log(`Wrote ${rows.length} audit events (${key.length} non-read) to docs/results/audit-log-example.*`);
await pool.end();
