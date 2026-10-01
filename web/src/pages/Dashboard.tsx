import {
  Package, ClipboardList, Lock, TriangleAlert, FileCheck2, MessageSquareWarning, Users, CalendarClock, LayoutDashboard,
  Activity, Route, ArrowRight, CheckCircle2, CircleDashed, ServerCog, Database, Bot, Zap, ScrollText,
} from 'lucide-react';
import { useApi } from '../hooks';
import { Badge, EmptyState, LoadingState, Meter, PageHeader, SectionCard, StatCard, hhmm } from '../components/ui';

/**
 * Order-state colors: fixed per state (identity, never rank), from the validated categorical
 * palette (dataviz validator: all hard checks pass; contrast relief = visible labels + counts).
 */
const ORDER_STATES: Array<{ key: string; label: string; color: string }> = [
  { key: 'PENDING', label: 'Pending', color: '#2a78d6' },
  { key: 'ON_HOLD', label: 'On hold', color: '#eda100' },
  { key: 'PICKING', label: 'Picking', color: '#1baf7a' },
  { key: 'PICKED', label: 'Picked', color: '#eb6834' },
  { key: 'PACKED', label: 'Packed', color: '#4a3aa7' },
  { key: 'SHIPPED', label: 'Shipped', color: '#008300' },
  { key: 'CANCELLED', label: 'Cancelled', color: '#e87ba4' },
];

const EVENT_ICON: Record<string, typeof Activity> = { PLAN_CREATED: CalendarClock, PLAN_CHANGE: CalendarClock, ESCALATION_CREATED: MessageSquareWarning, APPROVAL_REQUESTED: FileCheck2, APPROVAL_DECISION: FileCheck2, APPROVED_ACTION_EXECUTED: CheckCircle2, STATE_CHANGE: Activity, ENVIRONMENT_RESET: ServerCog, SIM_CHANGE: Zap };

const DEMO: Array<[string, React.ReactNode]> = [
  ['planner', <><b>Shift Planner → Generate plan</b> (v1). ORD-1004 is assigned with a ⚠ open-exception warning.</>],
  ['exceptions', <>Investigate <b>EXC-2003</b> — autonomous status sync.</>],
  ['exceptions', <>Investigate <b>EXC-2004</b> (contradictory → escalation) and <b>EXC-2007</b> (ambiguous → hold + escalate).</>],
  ['exceptions', <>Investigate <b>EXC-2002</b> (duplicate) → approve or reject in the approval card.</>],
  ['exceptions', <>Investigate <b>EXC-2001</b> (shortfall → ORD-1004 held), then Planner → <b>Refresh after exception</b>: ORD-1004 is BLOCKED by EXC-2001.</>],
  ['planner', <>Planner → advance clock 45 min → mark <b>P-02 unavailable</b> → replan → review the v1→v2 change log.</>],
  ['audit', <><b>Audit Log</b> — trace everything; <b>Scenarios</b> — run the automated checks.</>],
];

export default function Dashboard() {
  const { data, error } = useApi<any>('/api/dashboard');
  const meta = useApi<any>('/api/meta');
  const header = <PageHeader art="dashboard" artTilt icon={LayoutDashboard} crumb="Dashboard" title={<>Operations <span className="text-teal-700">dashboard</span></>}
    subtitle="One shared simulated WMS/OMS. The Exception Resolver writes to it; the Shift Planner reads from it." />;
  if (!data) return <div>{header}{error ? <div className="text-sm text-rose-700">Could not load the dashboard: {error}</div> : <LoadingState label="Loading operational overview…" />}</div>;

  const n = (arr: any[], k: string) => arr.find((x) => x.status === k || x.availability === k)?.n ?? 0;
  const total = data.orders.reduce((s: number, x: any) => s + x.n, 0);
  const openExc = data.exceptions.filter((x: any) => !['RESOLVED', 'CLOSED'].includes(x.status)).reduce((s: number, x: any) => s + x.n, 0);
  const pickersTotal = data.pickers.reduce((s: number, x: any) => s + x.n, 0);
  const avail = n(data.pickers, 'AVAILABLE');
  const plan = data.plan;
  const auto = meta.data?.sim?.automation;

  return (
    <div className="space-y-5">
      {header}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Package} tone="emerald" label="Total orders" value={total} hint={`${data.orders.length} distinct statuses`} />
        <StatCard icon={ClipboardList} tone="sky" label="Pending / picking" value={`${n(data.orders, 'PENDING')} / ${n(data.orders, 'PICKING')}`} hint="Not started / in progress" />
        <StatCard icon={Lock} tone="amber" label="On hold (blocked)" value={n(data.orders, 'ON_HOLD')} hint={n(data.orders, 'ON_HOLD') ? 'Held by exceptions' : 'No held orders'} />
        <StatCard icon={TriangleAlert} tone="rose" label="Open exceptions" value={openExc} hint={openExc ? 'Needs attention' : 'All handled'} />
        <StatCard icon={FileCheck2} tone="violet" label="Pending approvals" value={data.pending_approvals} hint={data.pending_approvals ? 'Waiting for an Operator' : 'All caught up'} />
        <StatCard icon={MessageSquareWarning} tone="orange" label="Open escalations" value={data.open_escalations} hint={data.open_escalations ? 'Waiting for a Reviewer' : 'No escalations'} />
        <StatCard icon={Users} tone="teal" label="Available pickers" value={`${avail} / ${pickersTotal}`} hint={`${pickersTotal ? Math.round((avail / pickersTotal) * 100) : 0}% available`} />
        <StatCard icon={CalendarClock} tone="slate" label="Active plan" value={plan ? `v${plan.version}` : '—'} hint={plan ? `${plan.trigger.replace(/_/g, ' ').toLowerCase()} @ ${hhmm(plan.sim_time)}` : 'Not generated yet'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <SectionCard icon={Package} title="Order & picker overview" subtitle="Live counts from the shared database">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <OrderStatusChart rows={data.orders} total={total} />
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-navy">Picker availability</h3>
                <div className="flex items-baseline gap-2"><span className="text-3xl font-bold tabular-nums text-navy">{avail}</span><span className="text-sm text-slate-500">of {pickersTotal} available</span></div>
                <div className="mt-2"><Meter value={avail} max={pickersTotal} label="Available pickers" /></div>
                {n(data.pickers, 'UNAVAILABLE') > 0 && <p className="mt-1 text-xs text-slate-500">{n(data.pickers, 'UNAVAILABLE')} unavailable — never assigned work by the planner.</p>}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-navy">Exceptions by status</h3>
                <ul className="space-y-1.5">
                  {data.exceptions.map((x: any) => (
                    <li key={x.status} className="flex items-center justify-between text-sm"><Badge v={x.status} dot /><span className="font-semibold tabular-nums text-navy">{x.n}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard icon={Activity} title="Recent activity" subtitle="Latest non-read audit events" actions={<a className="btn-ghost btn-sm" href="#/audit">View all <ArrowRight className="h-3.5 w-3.5" /></a>} bodyClassName="px-5 py-3">
          {data.recent.length === 0 ? <EmptyState compact illustration="empty" title="No activity yet">Actions you take will appear here.</EmptyState> : (
            <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[53px] before:top-2 before:w-px before:bg-slate-200">
              {data.recent.map((e: any) => {
                const I = EVENT_ICON[e.event_type] ?? ScrollText;
                return (
                  <li key={e.seq} className="relative flex items-start gap-3">
                    <span className="w-10 shrink-0 pt-1 font-mono text-xs text-slate-400">{hhmm(e.sim_time)}</span>
                    <span className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white ring-1 ring-slate-200"><I className="h-3.5 w-3.5 text-teal-700" aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <Badge v={e.event_type} tone="brand" />
                      <p className="mt-0.5 line-clamp-2 text-[13px] text-slate-600" title={e.decision_summary ?? ''}>{e.decision_summary ?? e.tool_name}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <SectionCard icon={Route} title="Suggested demo path" subtitle="Run these steps to see the key capabilities">
          <ol className="space-y-2.5">
            {DEMO.map(([href, text], i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal-700 text-xs font-bold text-white">{i + 1}</span>
                <a href={`#/${href}`} className="rounded-md pt-0.5 hover:text-teal-800">{text}</a>
              </li>
            ))}
          </ol>
        </SectionCard>

        <SectionCard icon={ServerCog} title="System status" subtitle="Only facts this app can verify">
          <ul className="divide-y divide-slate-100 text-sm">
            <StatusRow icon={ServerCog} label="API" ok={!!meta.data} value={meta.data ? 'Responding' : meta.error ? 'Unreachable' : 'Checking…'} />
            <StatusRow icon={Database} label="Database (PostgreSQL)" ok={!!meta.data?.sim} value={meta.data?.sim ? `Seed ${meta.data.sim.seed_version}` : '—'} />
            <StatusRow icon={Bot} label="Agent" ok={!!meta.data} value={meta.data?.llm?.configured ? `LLM · ${meta.data.llm.model}` : 'Deterministic (no LLM key)'} />
            <StatusRow icon={Zap} label="Automation switches" ok={!!auto} neutral={!auto || !(auto.auto_detect || auto.auto_investigate || auto.auto_replan)}
              value={auto ? [auto.auto_detect && 'detect', auto.auto_investigate && 'investigate', auto.auto_replan && 'replan'].filter(Boolean).join(' · ') || 'All off' : '—'} />
            <StatusRow icon={CalendarClock} label="Active plan" ok={!!plan} neutral={!plan} value={plan ? `v${plan.version}` : 'None yet'} />
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}

function StatusRow({ icon: I, label, value, ok, neutral = false }: { icon: typeof Activity; label: string; value: string; ok: boolean; neutral?: boolean }) {
  const S = ok && !neutral ? CheckCircle2 : CircleDashed;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <S className={`h-4 w-4 shrink-0 ${ok && !neutral ? 'text-emerald-600' : 'text-slate-400'}`} aria-label={ok && !neutral ? 'ok' : 'not active'} />
      <I className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <span className="flex-1 text-slate-700">{label}</span>
      <span className={`text-right text-[13px] font-medium ${ok && !neutral ? 'text-emerald-700' : 'text-slate-500'}`}>{value}</span>
    </li>
  );
}

/** Part-to-whole: one 100% stacked bar (2px gaps, rounded ends) + a labelled count list (legend + table view). */
function OrderStatusChart({ rows, total }: { rows: any[]; total: number }) {
  const get = (k: string) => rows.find((r) => r.status === k)?.n ?? 0;
  const present = ORDER_STATES.filter((s) => get(s.key) > 0);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-navy">Order status</h3>
      <div className="flex items-baseline gap-2"><span className="text-3xl font-bold tabular-nums text-navy">{total}</span><span className="text-sm text-slate-500">orders</span></div>
      <div className="mt-3 flex h-4 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label={`Order status: ${present.map((s) => `${s.label} ${get(s.key)}`).join(', ')}`}>
        {present.map((s) => (
          <div key={s.key} className="group relative h-full first:rounded-l-md last:rounded-r-md" style={{ width: `${(get(s.key) / Math.max(1, total)) * 100}%`, background: s.color }}>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-navy px-2 py-1 text-xs text-white shadow group-hover:block">{s.label}: {get(s.key)}</span>
          </div>
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {ORDER_STATES.map((s) => (
          <li key={s.key} className={`flex items-center gap-2 text-sm ${get(s.key) ? '' : 'opacity-50'}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="flex-1 text-slate-600">{s.label}</span>
            <span className="font-semibold tabular-nums text-navy">{get(s.key)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-slate-400">{total ? Math.round((get(s.key) / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
