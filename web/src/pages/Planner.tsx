import { useEffect, useMemo, useState } from 'react';
import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Card, Empty, ErrorBox, PageHeader, Stat, hhmm } from '../components/ui';

const SHIFT_START = 8 * 60;
const SHIFT_LEN = 8 * 60;
const minOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const CHANGE_TONE: Record<string, string> = {
  REASSIGNED: 'text-sky-700', PROGRESS_PRESERVED_REASSIGNED: 'text-sky-700', NEW: 'text-teal-700', UNBLOCKED: 'text-teal-700',
  NEWLY_BLOCKED: 'text-amber-700', NEWLY_INFEASIBLE: 'text-rose-700', REMOVED: 'text-zinc-500', RESEQUENCED: 'text-slate-600',
};

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
  const isOp = getRole() === 'operator';

  useEffect(() => { setVer(null); }, [active?.version]);

  const runPlanner = (trigger: string, detail?: string) => act.run(`plan-${trigger}`, async () => {
    const r = await api.post('/api/planner/run', { trigger, detail });
    setLastRun(r);
    return r;
  });
  const inject = (key: string, path: string, body: any, trigger: string, detail: string) => act.run(key, async () => {
    await api.post(path, body);
    if (autoReplan && active) { const r = await api.post('/api/planner/run', { trigger, detail }); setLastRun(r); }
  });

  const rows: any[] = plan.data?.assignments ?? [];
  const p = plan.data?.plan;
  const byPicker = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of rows) if (r.picker_id && r.est_start) m.set(r.picker_id, [...(m.get(r.picker_id) ?? []), r]);
    return m;
  }, [rows]);
  const nextOrderId = `ORD-${1021 + (plans.data?.filter((x) => x.trigger === 'URGENT_ORDER').length ?? 0)}`;
  const available = (pickers.data?.data ?? []).filter((x: any) => x.availability === 'AVAILABLE');

  return (
    <div className="space-y-4">
      <PageHeader title="Shift planner" subtitle={<>Deterministic scheduler (SOP-PLN-001/002/003) over the shared state. The LLM may explain the plan; it never does the arithmetic. Simulated time: <b className="mono">{hhmm(meta.data?.sim.sim_now)}</b></>}
        actions={<>
          <button className="btn-primary" disabled={!!act.busy} onClick={() => runPlanner(active ? 'MANUAL_REFRESH' : 'INITIAL')}>{active ? '↻ Refresh plan' : 'Generate plan'}</button>
          {active && <button className="btn-secondary" disabled={!!act.busy} onClick={() => runPlanner('EXCEPTION_HOLD', 'Refresh after exception resolution')}>Refresh after exception</button>}
        </>} />
      <ErrorBox msg={act.error} />

      <Card title="Mid-shift changes (simulated)" actions={<label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={autoReplan} onChange={(e) => setAutoReplan(e.target.checked)} /> replan automatically after a change</label>}>
        {!isOp && <div className="mb-2 text-xs text-slate-500">Operator role required.</div>}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-slate-500">Clock</span>
          {[15, 30, 45, 60].map((m) => <button key={m} className="btn-secondary py-1" disabled={!isOp || !!act.busy || !active} onClick={() => act.run(`adv${m}`, () => api.post('/api/sim/advance', { minutes: m }))}>+{m} min</button>)}
          <span className="mx-2 h-5 w-px bg-slate-200" />
          <select className="input py-1" value={pickerSel} onChange={(e) => setPickerSel(e.target.value)}>
            {available.map((x: any) => <option key={x.picker_id}>{x.picker_id}</option>)}
          </select>
          <button className="btn-secondary py-1" disabled={!isOp || !!act.busy || !active || !available.length} onClick={() => inject('unavail', '/api/sim/picker', { picker_id: pickerSel, availability: 'UNAVAILABLE', reason: `Went home sick at ${hhmm(meta.data?.sim.sim_now)}` }, 'PICKER_UNAVAILABLE', `${pickerSel} unavailable`)}>Picker unavailable</button>
          <span className="mx-2 h-5 w-px bg-slate-200" />
          <button className="btn-secondary py-1" disabled={!isOp || !!act.busy || !active} onClick={() => inject('urgent', '/api/sim/urgent-order', { order_id: nextOrderId, priority: 1, due_in_minutes: 75, lines: [{ sku: 'SKU-003', qty: 6 }, { sku: 'SKU-001', qty: 20 }] }, 'URGENT_ORDER', `${nextOrderId} P1 due in 75 min`)}>Urgent order {nextOrderId}</button>
          <button className="btn-secondary py-1" disabled={!isOp || !!act.busy || !active} onClick={() => inject('inv', '/api/sim/inventory', { sku: 'SKU-003', location_id: 'B-01', on_hand: 5, reason: 'Damaged units found' }, 'INVENTORY_CHANGED', 'SKU-003@B-01 on_hand → 5')}>Inventory drop SKU-003</button>
          <button className="btn-secondary py-1" disabled={!isOp || !!act.busy} title="Next generate_plan call fails with a simulated upstream error" onClick={() => act.run('fault', () => api.post('/api/sim/fault', { tool_name: 'generate_plan', mode: 'ERROR', count: 1 }))}>Inject planner failure</button>
        </div>
      </Card>

      {lastRun && (
        <Card title={<>Last planner run <span className="mono text-slate-400">{lastRun.run_id}</span></>} actions={<Badge v={lastRun.status} />}>
          {lastRun.error && <div className="mb-2 rounded border border-rose-300 bg-rose-50 p-2 text-sm text-rose-800"><b>SYSTEM FAILURE</b> ({lastRun.error.code}) — not an infeasibility result. {lastRun.explanation}</div>}
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-slate-500">Tool calls</div>
              <ul>{lastRun.steps.map((s: any, i: number) => <li key={i}><span className={s.ok ? 'text-emerald-600' : 'text-rose-600'}>{s.ok ? '✓' : '✗'}</span> <span className="mono">{s.tool}</span> — {s.summary}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">Policies retrieved (shared SOP)</div>
              <ul>{lastRun.policies.map((p: any) => <li key={p.policy_id}><span className="font-mono text-teal-800">{p.policy_id}</span> {p.title}</li>)}</ul>
            </div>
          </div>
        </Card>
      )}

      {!p && <Card><Empty>No plan yet. Click <b>Generate plan</b>.</Empty></Card>}
      {p && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Version</span>
            {(plans.data ?? []).slice().reverse().map((x) => (
              <button key={x.version} onClick={() => setVer(x.version)} className={`rounded-md border px-2 py-1 text-xs ${x.version === shown ? 'border-teal-600 bg-teal-50 font-semibold text-teal-800' : 'border-slate-300 bg-white'}`}>
                v{x.version} · {x.trigger.replace(/_/g, ' ').toLowerCase()} {x.status === 'ACTIVE' ? '●' : ''}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label={`Plan v${p.version}`} value={<Badge v={p.status} />} hint={`${p.trigger}${p.parent_version ? ` from v${p.parent_version}` : ''} @ ${hhmm(p.sim_time)}`} />
            <Stat label="Assigned" value={p.summary.assigned} tone="teal" />
            <Stat label="In progress / done" value={`${p.summary.in_progress} / ${p.summary.completed}`} />
            <Stat label="Blocked" value={p.summary.blocked} tone="amber" />
            <Stat label="Infeasible" value={p.summary.infeasible} tone="rose" />
            <Stat label="SLA at risk" value={p.summary.sla_at_risk} tone={p.summary.sla_at_risk ? 'rose' : 'slate'} hint={p.summary.metrics ? `${p.summary.metrics.preserved} preserved · ${p.summary.metrics.changed} changed` : undefined} />
          </div>

          {p.parent_version && (
            <Card title={<>What changed: v{p.parent_version} → v{p.version} <span className="font-normal text-slate-500">({p.trigger}{p.trigger_detail ? `: ${p.trigger_detail}` : ''})</span></>}>
              {p.change_log.length === 0 ? <Empty>No assignment changes.</Empty> : (
                <table className="tbl">
                  <thead><tr><th>Order</th><th>Change</th><th>Before (v{p.parent_version})</th><th>After (v{p.version})</th><th>Reason</th></tr></thead>
                  <tbody>{p.change_log.map((c: any) => (
                    <tr key={c.order_id}><td className="font-mono">{c.order_id}</td><td className={`text-xs font-semibold ${CHANGE_TONE[c.change_type] ?? ''}`}>{c.change_type.replace(/_/g, ' ')}</td><td className="mono">{c.from}</td><td className="mono">{c.to}</td><td className="text-xs">{c.reason}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Card>
          )}

          <Card title="Picker timelines (08:00–16:00)">
            <div className="space-y-2">
              {(p.summary.pickers ?? []).map((pk: any) => (
                <div key={pk.picker_id} className="flex items-center gap-3">
                  <div className="w-36 shrink-0 text-xs"><span className="font-mono font-semibold">{pk.picker_id}</span> <Badge v={pk.availability} /><div className="text-slate-500">{pk.planned_minutes}/{pk.remaining_capacity_minutes} min ({pk.utilization_pct}%)</div></div>
                  <div className="relative h-7 flex-1 rounded bg-slate-100">
                    {(byPicker.get(pk.picker_id) ?? []).map((r) => {
                      const left = ((minOf(r.est_start) - SHIFT_START) / SHIFT_LEN) * 100;
                      const width = Math.max(1.5, ((minOf(r.est_finish) - minOf(r.est_start)) / SHIFT_LEN) * 100);
                      const color = r.status === 'COMPLETED' ? 'bg-emerald-400' : r.status === 'IN_PROGRESS' ? 'bg-sky-500' : r.sla_at_risk ? 'bg-rose-400' : 'bg-teal-600';
                      return <div key={r.order_id} title={`${r.order_id} ${r.status} ${hhmm(r.est_start)}–${hhmm(r.est_finish)} (deadline ${hhmm(r.deadline)})`} className={`absolute top-0.5 bottom-0.5 overflow-hidden rounded px-1 text-[10px] leading-6 text-white ${color}`} style={{ left: `${Math.max(0, left)}%`, width: `${width}%` }}>{r.order_id.slice(4)}</div>;
                    })}
                    {meta.data && <div className="absolute top-0 bottom-0 w-0.5 bg-rose-600" style={{ left: `${((minOf(meta.data.sim.sim_now) - SHIFT_START) / SHIFT_LEN) * 100}%` }} title="simulated now" />}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-3 text-[11px] text-slate-500"><span>■ <span className="text-teal-600">assigned</span></span><span>■ <span className="text-sky-500">in progress</span></span><span>■ <span className="text-emerald-500">completed</span></span><span>■ <span className="text-rose-400">SLA risk</span></span><span className="text-rose-600">| now</span></div>
          </Card>

          <Card title="Assignments">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Rank</th><th>Order</th><th>Status</th><th>Picker · seq</th><th>Workload</th><th>Inventory</th><th>Deadline</th><th>Est. window</th><th>Zone</th><th>Change</th><th>Rationale / block reason</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.order_id}>
                      <td className="mono">{r.priority_rank || '—'}</td>
                      <td><span className="font-mono font-semibold">{r.order_id}</span> <span className="text-xs text-slate-400">P{r.priority}</span></td>
                      <td><Badge v={r.status} />{r.sla_at_risk && <div className="mt-0.5 text-[11px] font-semibold text-rose-600">SLA risk</div>}</td>
                      <td className="mono">{r.picker_id ? `${r.picker_id} · #${r.sequence}` : '—'}</td>
                      <td className="mono">{r.workload_minutes} min</td>
                      <td className="max-w-[12rem] text-xs">{r.inventory_readiness}</td>
                      <td className="mono">{hhmm(r.deadline)}</td>
                      <td className="mono">{r.est_start ? `${hhmm(r.est_start)}–${hhmm(r.est_finish)}` : '—'}</td>
                      <td className="text-xs">{r.primary_zone ?? '—'}{r.zones?.length > 1 ? ` (${r.zones.join('+')})` : ''}</td>
                      <td className={`text-[11px] font-semibold ${CHANGE_TONE[r.change_type] ?? 'text-slate-400'}`}>{r.change_type?.replace(/_/g, ' ') ?? ''}</td>
                      <td className="max-w-md whitespace-pre-line text-xs">
                        {r.exception_ref && <div className="mb-0.5 font-semibold text-amber-700">Blocked by {r.exception_ref}</div>}
                        {r.block_reason && <div className="text-rose-700">{r.block_reason}</div>}
                        <div className="text-slate-600">{r.rationale}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {p.explanation && <Card title="Plan explanation"><pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{p.explanation}</pre></Card>}
        </>
      )}
    </div>
  );
}
