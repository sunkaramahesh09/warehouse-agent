import { useApi } from '../hooks';
import { Badge, Card, PageHeader, Stat, hhmm } from '../components/ui';

export default function Dashboard() {
  const { data } = useApi<any>('/api/dashboard');
  if (!data) return <div className="text-sm text-slate-400">Loading…</div>;
  const n = (arr: any[], k: string) => arr.find((x) => x.status === k || x.availability === k)?.n ?? 0;
  const total = data.orders.reduce((s: number, x: any) => s + x.n, 0);
  const openExc = data.exceptions.filter((x: any) => !['RESOLVED', 'CLOSED'].includes(x.status)).reduce((s: number, x: any) => s + x.n, 0);
  const plan = data.plan;
  return (
    <div className="space-y-4">
      <PageHeader title="Operations dashboard" subtitle="One shared simulated WMS/OMS. The Exception Resolver writes to it; the Shift Planner reads from it." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Total orders" value={total} />
        <Stat label="Pending / picking" value={`${n(data.orders, 'PENDING')} / ${n(data.orders, 'PICKING')}`} tone="teal" />
        <Stat label="On hold (blocked)" value={n(data.orders, 'ON_HOLD')} tone="amber" />
        <Stat label="Open exceptions" value={openExc} tone="orange" />
        <Stat label="Pending approvals" value={data.pending_approvals} tone="fuchsia" />
        <Stat label="Open escalations" value={data.open_escalations} tone="orange" />
        <Stat label="Available pickers" value={`${n(data.pickers, 'AVAILABLE')} / ${data.pickers.reduce((s: number, x: any) => s + x.n, 0)}`} tone="emerald" />
        <Stat label="Active plan" value={plan ? `v${plan.version}` : '—'} hint={plan ? `${plan.trigger} @ ${hhmm(plan.sim_time)}` : 'not generated yet'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Suggested demo path">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
            <li><a className="text-teal-700 hover:underline" href="#/planner">Shift Planner</a> → <b>Generate plan</b> (v1). Note ORD-1004 is assigned with a ⚠ open-exception warning.</li>
            <li><a className="text-teal-700 hover:underline" href="#/exceptions">Exceptions</a> → investigate <b>EXC-2003</b> (autonomous status sync).</li>
            <li>Investigate <b>EXC-2004</b> (contradictory records → escalation) and <b>EXC-2007</b> (ambiguous → hold + escalate).</li>
            <li>Investigate <b>EXC-2002</b> (duplicate) → approve or reject in the approval card.</li>
            <li>Investigate <b>EXC-2001</b> (shortfall → ORD-1004 held), then Planner → <b>Refresh after exception</b>: ORD-1004 now BLOCKED by EXC-2001.</li>
            <li>Planner → advance clock 45 min → mark <b>P-02 unavailable</b> → replan → review the v1→v2 change log.</li>
            <li><a className="text-teal-700 hover:underline" href="#/audit">Audit Log</a> — trace everything; <a className="text-teal-700 hover:underline" href="#/scenarios">Scenarios</a> — run the automated checks.</li>
          </ol>
        </Card>
        <Card title="Recent activity (non-read events)">
          <ul className="divide-y divide-slate-100 text-sm">
            {data.recent.map((e: any) => (
              <li key={e.seq} className="flex gap-2 py-1.5">
                <span className="mono w-10 shrink-0 text-slate-400">{hhmm(e.sim_time)}</span>
                <Badge v={e.event_type} />
                <span className="min-w-0 flex-1 truncate text-slate-600" title={e.decision_summary ?? ''}>{e.decision_summary ?? e.tool_name}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
