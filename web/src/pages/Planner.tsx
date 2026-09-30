import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, Users, ClipboardList, Loader, Lock, Ban, AlarmClock, Zap, Clock, UserX, TriangleAlert, PackageMinus, Bug, Play, RotateCw,
  RefreshCcw, GitCompareArrows, ListChecks, ListX, LayoutGrid, Sparkles, Calculator, CheckCircle2, XCircle, Info,
} from 'lucide-react';
import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Callout, Chip, EmptyState, ErrorBox, PageHeader, ProgressNote, SectionCard, Select, Spinner, StatCard, Tabs, hhmm } from '../components/ui';

const SHIFT_START = 8 * 60;
const SHIFT_LEN = 8 * 60;
const minOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const CHANGE_TONE: Record<string, string> = {
  REASSIGNED: 'text-sky-700', PROGRESS_PRESERVED_REASSIGNED: 'text-sky-700', NEW: 'text-teal-700', UNBLOCKED: 'text-teal-700',
  NEWLY_BLOCKED: 'text-amber-700', NEWLY_INFEASIBLE: 'text-rose-700', REMOVED: 'text-zinc-500', RESEQUENCED: 'text-slate-600',
};
type Tab = 'plan' | 'assignments' | 'unscheduled' | 'changes';

export default function Planner() {
  const plans = useApi<any[]>('/api/plans');
  const meta = useApi<any>('/api/meta');
  const pickers = useApi<any>('/api/pickers');
  const [ver, setVer] = useState<number | null>(null);
  const active = plans.data?.find((p) => p.status === 'ACTIVE');
  const shown = ver ?? active?.version ?? null;
  const plan = useApi<any>(shown ? `/api/plans/${shown}` : null);
  const act = useAction();
  const [lastRun, setLastRun] = useState<any>(null);
  const [autoReplan, setAutoReplan] = useState(true);
  const [pickerSel, setPickerSel] = useState('P-02');
  const [strategy, setStrategy] = useState<'greedy' | 'local_search'>('greedy');
  const [tab, setTab] = useState<Tab>('plan');
  const serverAutoReplan = !!meta.data?.sim?.automation?.auto_replan;
  const isOp = getRole() === 'operator';

  useEffect(() => { setVer(null); }, [active?.version]);
  // After a replan, surface what changed (the key evidence) instead of hiding it behind a tab.
  useEffect(() => { if (lastRun?.plan?.parent_version) setTab('changes'); }, [lastRun]);

  // ---- unchanged operations -----------------------------------------------------------
  const runPlanner = (trigger: string, detail?: string) => act.run(`plan-${trigger}`, async () => {
    const r = await api.post('/api/planner/run', { trigger, detail, strategy });
    setLastRun(r);
    return r;
  });
  const inject = (key: string, path: string, body: any, trigger: string, detail: string) => act.run(key, async () => {
    await api.post(path, body);
    if (autoReplan && active && !serverAutoReplan) { const r = await api.post('/api/planner/run', { trigger, detail, strategy }); setLastRun(r); }
  });

  const rows: any[] = plan.data?.assignments ?? [];
  const p = plan.data?.plan;
  const scheduled = rows.filter((r) => ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(r.status));
  const unscheduled = rows.filter((r) => ['BLOCKED', 'INFEASIBLE'].includes(r.status));
  const byPicker = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of rows) if (r.picker_id && r.est_start) m.set(r.picker_id, [...(m.get(r.picker_id) ?? []), r]);
    return m;
  }, [rows]);
  const nextOrderId = `ORD-${1021 + (plans.data?.filter((x) => x.trigger === 'URGENT_ORDER').length ?? 0)}`;
  const allPickers: any[] = pickers.data?.data ?? [];
  const available = allPickers.filter((x: any) => x.availability === 'AVAILABLE');
  const busyLabel: Record<string, string> = { 'plan-INITIAL': 'Generating plan…', 'plan-MANUAL_REFRESH': 'Refreshing plan…', 'plan-EXCEPTION_HOLD': 'Refreshing after exception…', unavail: 'Marking picker unavailable and replanning…', urgent: 'Injecting urgent order and replanning…', inv: 'Applying inventory drop and replanning…', fault: 'Arming planner fault…' };
  const ctlDisabled = !isOp || !!act.busy || !active;

  return (
    <div className="space-y-5">
      <PageHeader icon={CalendarClock} crumb="Shift Planner" illustration="warehouse" title="Shift Planner"
        subtitle={<>Deterministic scheduler (<span className="font-mono text-teal-800">SOP-PLN-001/002/003</span>) over the shared state. The LLM may explain the plan; it never does the arithmetic. Simulated time: <b className="font-mono text-navy">{hhmm(meta.data?.sim.sim_now)}</b></>}
        actions={<>
          <Select label="Planning strategy (SOP-PLN-002)" className="w-52" value={strategy} onChange={(v) => setStrategy(v as any)} options={[{ value: 'greedy', label: 'Greedy (SOP default)' }, { value: 'local_search', label: 'Greedy + local search' }]} />
          <button className="btn-primary" disabled={!!act.busy} onClick={() => runPlanner(active ? 'MANUAL_REFRESH' : 'INITIAL')}>
            {act.busy === 'plan-INITIAL' || act.busy === 'plan-MANUAL_REFRESH' ? <Spinner /> : active ? <RotateCw className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {active ? 'Refresh plan' : 'Generate plan'}
          </button>
          {active && <button className="btn-secondary" disabled={!!act.busy} onClick={() => runPlanner('EXCEPTION_HOLD', 'Refresh after exception resolution')}><RefreshCcw className="h-4 w-4" aria-hidden />Refresh after exception</button>}
        </>} />
      {act.error && <ErrorBox operation={busyLabel[act.busy ?? ''] ? 'Planner operation' : 'Planner / simulation request'} msg={act.error} />}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50/60 px-4 py-2.5 text-[13px] text-teal-900">
        <Calculator className="h-4 w-4 text-teal-700" aria-hidden /><b className="font-semibold">Deterministic code decides:</b>
        {['workload & travel minutes', 'picker capacity & skills', 'inventory readiness', 'deadline urgency & SLA risk', 'availability'].map((x) => <span key={x} className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2 py-0.5 text-xs ring-1 ring-teal-100"><CheckCircle2 className="h-3 w-3 text-teal-600" aria-hidden />{x}</span>)}
        <span className="text-xs text-teal-800/80">· LLM only explains</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Users} tone="emerald" label="Available pickers" value={`${available.length} / ${allPickers.length}`} />
        <StatCard icon={CalendarClock} tone="slate" label={p ? `Plan v${p.version}` : 'Active plan'} value={p ? <Badge v={p.status} /> : '—'} hint={p ? `${p.trigger.replace(/_/g, ' ').toLowerCase()}${p.parent_version ? ` from v${p.parent_version}` : ''} @ ${hhmm(p.sim_time)}` : 'Not generated yet'} />
        <StatCard icon={ClipboardList} tone="teal" label="Assigned" value={p?.summary.assigned ?? '—'} />
        <StatCard icon={Loader} tone="sky" label="In progress / done" value={p ? `${p.summary.in_progress} / ${p.summary.completed}` : '—'} />
        <StatCard icon={Lock} tone="amber" label="Blocked / infeasible" value={p ? `${p.summary.blocked} / ${p.summary.infeasible}` : '—'} />
        <StatCard icon={AlarmClock} tone={p?.summary.sla_at_risk ? 'rose' : 'slate'} label="SLA at risk" value={p?.summary.sla_at_risk ?? '—'} hint={p?.summary.metrics ? `${p.summary.metrics.preserved} preserved · ${p.summary.metrics.changed} changed` : undefined} />
      </div>

      <SectionCard icon={Zap} title="Mid-shift changes (simulated)" subtitle="Inject changes into the shared environment to exercise replanning"
        actions={serverAutoReplan
          ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 ring-1 ring-teal-200"><Sparkles className="h-3.5 w-3.5" aria-hidden />Server event-driven auto-replan is ON (Events &amp; Automation)</span>
          : <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-teal-700" checked={autoReplan} onChange={(e) => setAutoReplan(e.target.checked)} />Replan automatically after a change</label>}>
        {!isOp && <div className="mb-3 text-xs text-slate-500">Operator role required.</div>}
        {!active && isOp && <div className="mb-3 text-xs text-slate-500">Generate a plan first — clock and change controls act on the active plan.</div>}
        <div className="grid gap-4 lg:grid-cols-[auto_auto_1fr_auto]">
          <div>
            <div className="label-xs mb-1.5">Advance clock</div>
            <div className="flex flex-wrap gap-1.5">
              {[15, 30, 45, 60].map((m) => <button key={m} className="btn-secondary btn-sm" disabled={ctlDisabled} onClick={() => act.run(`adv${m}`, () => api.post('/api/sim/advance', { minutes: m }))}>{act.busy === `adv${m}` ? <Spinner className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" aria-hidden />}+{m} min</button>)}
            </div>
          </div>
          <div>
            <div className="label-xs mb-1.5">Picker availability</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select aria-label="Picker" className="input py-1.5" value={pickerSel} onChange={(e) => setPickerSel(e.target.value)}>
                  {available.map((x: any) => <option key={x.picker_id}>{x.picker_id}</option>)}
                </select>
              <button className="btn-danger-soft btn-sm" disabled={ctlDisabled || !available.length} onClick={() => inject('unavail', '/api/sim/picker', { picker_id: pickerSel, availability: 'UNAVAILABLE', reason: `Went home sick at ${hhmm(meta.data?.sim.sim_now)}` }, 'PICKER_UNAVAILABLE', `${pickerSel} unavailable`)}>
                <UserX className="h-3.5 w-3.5" aria-hidden />Picker unavailable
              </button>
            </div>
          </div>
          <div>
            <div className="label-xs mb-1.5">Inject scenario</div>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn-secondary btn-sm" disabled={ctlDisabled} onClick={() => inject('urgent', '/api/sim/urgent-order', { order_id: nextOrderId, priority: 1, due_in_minutes: 75, lines: [{ sku: 'SKU-003', qty: 6 }, { sku: 'SKU-001', qty: 20 }] }, 'URGENT_ORDER', `${nextOrderId} P1 due in 75 min`)}>
                <TriangleAlert className="h-3.5 w-3.5 text-amber-600" aria-hidden />Urgent order {nextOrderId}
              </button>
              <button className="btn-secondary btn-sm" disabled={ctlDisabled} onClick={() => inject('inv', '/api/sim/inventory', { sku: 'SKU-003', location_id: 'B-01', on_hand: 5, reason: 'Damaged units found' }, 'INVENTORY_CHANGED', 'SKU-003@B-01 on_hand → 5')}>
                <PackageMinus className="h-3.5 w-3.5 text-violet-600" aria-hidden />Inventory drop SKU-003
              </button>
            </div>
          </div>
          <div>
            <div className="label-xs mb-1.5">Failure testing</div>
            <button className="btn-danger-soft btn-sm" disabled={!isOp || !!act.busy} title="Next generate_plan call fails with a simulated upstream error" onClick={() => act.run('fault', () => api.post('/api/sim/fault', { tool_name: 'generate_plan', mode: 'ERROR', count: 1 }))}>
              <Bug className="h-3.5 w-3.5" aria-hidden />Inject planner failure
            </button>
          </div>
        </div>
        {act.busy && busyLabel[act.busy] && <div className="mt-4"><ProgressNote>{busyLabel[act.busy]}</ProgressNote></div>}
      </SectionCard>

      {lastRun && (
        <SectionCard icon={ListChecks} title={<>Last planner run <span className="font-mono text-xs font-normal text-slate-400">{lastRun.run_id}</span></>} actions={<Badge v={lastRun.status} dot />}>
          {lastRun.error && <div className="mb-3 flex gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800" role="alert"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><b>SYSTEM FAILURE</b> ({lastRun.error.code}) — not an infeasibility result. {lastRun.explanation}</span></div>}
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div>
              <div className="label-xs mb-1.5">Tool calls</div>
              <ul className="space-y-1">{lastRun.steps.map((s: any, i: number) => <li key={i} className="flex items-start gap-2">{s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-label="failed" />}<Chip tone="info">{s.tool}</Chip><span className="text-slate-600">{s.summary}</span></li>)}</ul>
            </div>
            <div>
              <div className="label-xs mb-1.5">Policies retrieved (shared SOP)</div>
              <ul className="space-y-1">{lastRun.policies.map((x: any) => <li key={x.policy_id} className="flex items-center gap-2"><Chip tone="brand">{x.policy_id}</Chip><span className="text-slate-700">{x.title}</span></li>)}</ul>
            </div>
          </div>
        </SectionCard>
      )}

      {!p && (
        <SectionCard>
          <EmptyState illustration="clipboard" title="No plan yet" action={isOp ? <button className="btn-primary" disabled={!!act.busy} onClick={() => runPlanner('INITIAL')}><Play className="h-4 w-4" aria-hidden />Generate plan</button> : undefined}>
            Click <b>Generate plan</b> to build a shift plan from current orders, inventory, picker availability and the shared SOP.
          </EmptyState>
          <div className="mx-auto max-w-xl">
            <Callout tone="info" icon={Info} title="What the planner considers (SOP-PLN-001 / 002)">
              <ul className="list-disc space-y-0.5 pl-4">
                <li>Eligibility: PENDING / PICKING orders; held, invalid or inventory-short orders are blocked</li>
                <li>Priority: in-progress first, then deadline urgency bucket, explicit priority, deadline</li>
                <li>Hard constraints: picker availability, skills (COLD / BULKY), remaining capacity</li>
                <li>Location proximity as a secondary tie-break; SLA risk flagged, never hidden</li>
              </ul>
            </Callout>
          </div>
        </SectionCard>
      )}

      {p && (
        <SectionCard bodyClassName="p-5 pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="label-xs">Version</span>
            {(plans.data ?? []).slice().reverse().map((x) => (
              <button key={x.version} onClick={() => setVer(x.version)} aria-pressed={x.version === shown}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${x.version === shown ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-line bg-white text-slate-600 hover:border-slate-300'}`}>
                v{x.version} · {x.trigger.replace(/_/g, ' ').toLowerCase()}{x.summary?.strategy === 'local_search' ? ' ⚙' : ''} {x.status === 'ACTIVE' ? '●' : ''}
              </button>
            ))}
          </div>
          <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[
            { value: 'plan', label: 'Plan', icon: LayoutGrid },
            { value: 'assignments', label: 'Assignments', icon: ListChecks, count: scheduled.length },
            { value: 'unscheduled', label: 'Unscheduled', icon: ListX, count: unscheduled.length },
            { value: 'changes', label: p.parent_version ? `Changes v${p.parent_version} → v${p.version}` : 'Changes', icon: GitCompareArrows, count: p.change_log.length },
          ]} />

          {tab === 'plan' && (
            <div className="space-y-5">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-navy">Picker timelines (08:00–16:00)</h3>
                <div className="mb-1 ml-40 hidden justify-between font-mono text-[10px] text-slate-400 sm:flex" aria-hidden>{[8, 9, 10, 11, 12, 13, 14, 15, 16].map((h) => <span key={h}>{String(h).padStart(2, '0')}</span>)}</div>
                <div className="space-y-2">
                  {(p.summary.pickers ?? []).map((pk: any) => (
                    <div key={pk.picker_id} className="flex items-center gap-3">
                      <div className="w-37 shrink-0 text-xs"><div className="flex items-center gap-1.5"><span className="font-mono font-bold text-navy">{pk.picker_id}</span><Badge v={pk.availability} /></div><div className="mt-0.5 text-slate-500">{pk.planned_minutes}/{pk.remaining_capacity_minutes} min ({pk.utilization_pct}%)</div></div>
                      <div className="relative h-8 flex-1 rounded-lg bg-slate-100" style={{ backgroundImage: 'repeating-linear-gradient(to right, transparent 0, transparent calc(12.5% - 1px), rgba(148,163,184,.35) calc(12.5% - 1px), rgba(148,163,184,.35) 12.5%)' }}>
                        {(byPicker.get(pk.picker_id) ?? []).map((r) => {
                          const left = ((minOf(r.est_start) - SHIFT_START) / SHIFT_LEN) * 100;
                          const width = Math.max(1.5, ((minOf(r.est_finish) - minOf(r.est_start)) / SHIFT_LEN) * 100);
                          const color = r.status === 'COMPLETED' ? 'bg-emerald-400' : r.status === 'IN_PROGRESS' ? 'bg-sky-500' : r.sla_at_risk ? 'bg-rose-400' : 'bg-teal-600';
                          return <div key={r.order_id} title={`${r.order_id} ${r.status} ${hhmm(r.est_start)}–${hhmm(r.est_finish)} (deadline ${hhmm(r.deadline)})`} className={`absolute bottom-1 top-1 overflow-hidden rounded-md px-1 text-[10px] font-semibold leading-6 text-white ${color}`} style={{ left: `${Math.max(0, left)}%`, width: `${width}%` }}>{r.order_id.slice(4)}</div>;
                        })}
                        {meta.data && <div className="absolute -bottom-1 -top-1 w-0.5 rounded bg-rose-600" style={{ left: `${((minOf(meta.data.sim.sim_now) - SHIFT_START) / SHIFT_LEN) * 100}%` }} title="simulated now" />}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-500">
                  {[['bg-teal-600', 'assigned'], ['bg-sky-500', 'in progress'], ['bg-emerald-400', 'completed'], ['bg-rose-400', 'SLA risk']].map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${c}`} aria-hidden />{l}</span>)}
                  <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-rose-600" aria-hidden />now</span>
                </div>
              </div>

              {p.summary.optimizer && (
                <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-navy"><Sparkles className="h-4 w-4 text-violet-600" aria-hidden />Optimizer (local search) <span className="font-normal text-slate-500">— {p.summary.optimizer.moves.length} move(s), {p.summary.optimizer.iterations} iteration(s)</span></h3>
                  <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
                    <table className="tbl">
                      <thead><tr><th>Objective (lexicographic)</th><th>Greedy</th><th>After local search</th></tr></thead>
                      <tbody>{[['SLA-risk orders', 'sla_at_risk'], ['Total lateness (min)', 'lateness_min'], ['Reassignment churn', 'churn'], ['Makespan (min)', 'makespan_min']].map(([l, k]) => (
                        <tr key={k}><td>{l}</td><td className="font-mono">{p.summary.optimizer.before[k]}</td><td className={`font-mono ${p.summary.optimizer.after[k] < p.summary.optimizer.before[k] ? 'font-bold text-emerald-700' : ''}`}>{p.summary.optimizer.after[k]}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">{p.summary.optimizer.moves.map((mv: any, i: number) => <li key={i}>{mv.kind} <span className="font-mono">{mv.order_id}</span>{mv.other_order_id ? <> ↔ <span className="font-mono">{mv.other_order_id}</span></> : null}: {mv.from} → {mv.to} ({mv.improvement})</li>)}</ul>
                  <div className="mt-1 text-xs text-slate-500">Only un-started work moves; capacity, skills and availability are re-checked for every move; queues keep priority order.</div>
                </div>
              )}

              {p.explanation && (
                <div className="rounded-2xl border border-line bg-slate-50/60 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-navy">Plan explanation</h3>
                  <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-700">{p.explanation}</pre>
                </div>
              )}
            </div>
          )}

          {tab === 'assignments' && (scheduled.length ? <AssignmentTable rows={scheduled} /> : <EmptyState compact illustration="clipboard" title="Nothing scheduled in this version" />)}
          {tab === 'unscheduled' && (unscheduled.length ? <AssignmentTable rows={unscheduled} /> : <EmptyState compact illustration="check" title="Every eligible order is scheduled" />)}
          {tab === 'changes' && (!p.parent_version ? <EmptyState compact illustration="clipboard" title="Initial version">This is the first plan; changes appear after a replan (mid-shift change, exception hold, refresh).</EmptyState>
            : p.change_log.length === 0 ? <EmptyState compact illustration="check" title="No assignment changes">v{p.version} keeps every assignment from v{p.parent_version}.</EmptyState> : (
              <div>
                <div className="mb-3 text-sm text-slate-600">What changed: <b className="text-navy">v{p.parent_version} → v{p.version}</b> ({p.trigger}{p.trigger_detail ? `: ${p.trigger_detail}` : ''})</div>
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="tbl">
                    <thead><tr><th>Order</th><th>Change</th><th>Before (v{p.parent_version})</th><th>After (v{p.version})</th><th>Reason</th></tr></thead>
                    <tbody>{p.change_log.map((c: any) => (
                      <tr key={c.order_id}><td className="whitespace-nowrap font-mono font-bold text-navy">{c.order_id}</td><td className={`whitespace-nowrap text-xs font-bold ${CHANGE_TONE[c.change_type] ?? ''}`}>{c.change_type.replace(/_/g, ' ')}</td><td className="font-mono text-xs">{c.from}</td><td className="font-mono text-xs">{c.to}</td><td className="text-xs">{c.reason}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            ))}
        </SectionCard>
      )}
    </div>
  );
}

function AssignmentTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="tbl">
        <thead><tr><th>Rank</th><th>Order</th><th>Status</th><th>Picker · seq</th><th>Workload</th><th>Inventory</th><th>Deadline</th><th>Est. window</th><th>Zone</th><th>Change</th><th>Rationale / block reason</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.order_id}>
              <td className="font-mono">{r.priority_rank || '—'}</td>
              <td className="whitespace-nowrap"><span className="font-mono font-bold text-navy">{r.order_id}</span> <span className="text-xs text-slate-400">P{r.priority}</span></td>
              <td><Badge v={r.status} />{r.sla_at_risk && <div className="mt-1"><Badge v="SLA RISK" tone="danger" /></div>}</td>
              <td className="whitespace-nowrap font-mono text-xs">{r.picker_id ? `${r.picker_id} · #${r.sequence}` : '—'}</td>
              <td className="whitespace-nowrap font-mono text-xs">{r.workload_minutes} min</td>
              <td className="max-w-[12rem] text-xs">{r.inventory_readiness}</td>
              <td className="font-mono text-xs">{hhmm(r.deadline)}</td>
              <td className="whitespace-nowrap font-mono text-xs">{r.est_start ? `${hhmm(r.est_start)}–${hhmm(r.est_finish)}` : '—'}</td>
              <td className="text-xs">{r.primary_zone ?? '—'}{r.zones?.length > 1 ? ` (${r.zones.join('+')})` : ''}</td>
              <td className={`whitespace-nowrap text-[11px] font-bold ${CHANGE_TONE[r.change_type] ?? 'text-slate-400'}`}>{r.change_type?.replace(/_/g, ' ') ?? ''}</td>
              <td className="min-w-[16rem] max-w-md whitespace-pre-line text-xs">
                {r.exception_ref && <div className="mb-0.5 font-semibold text-amber-700">Blocked by {r.exception_ref}</div>}
                {r.block_reason && <div className="text-rose-700">{r.block_reason}</div>}
                <div className="text-slate-600">{r.rationale}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
