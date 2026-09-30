import { resetEnvironment } from '../src/db/reset.js';
import { pool } from '../src/db/pool.js';
import { callTool } from '../src/tools/index.js';
await resetEnvironment();
const ctx = { runId: 'DEV', workflow: 'SHIFT_PLANNER' as const, actor: 'dev', role: 'system' as const };
const r: any = await callTool('generate_plan', { trigger: 'INITIAL', run_id: 'DEV' }, ctx);
if (!r.success) { console.log(r); process.exit(1); }
for (const a of r.data.assignments) console.log(a.status.padEnd(11), a.order_id, (a.picker_id ?? '-').padEnd(5), String(a.sequence ?? '-').padEnd(2), String(a.workload_minutes).padEnd(6), (a.est_finish ?? '').slice(11,16), a.deadline.slice(11,16), a.sla_at_risk ? 'RISK' : '', a.block_reason ?? '');
console.table(r.data.pickers.map((p: any) => ({ ...p, orders: p.orders.join(',') })));
console.log(r.data.summary);
await pool.end();
