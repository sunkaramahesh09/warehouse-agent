import {
  BarChart3, Database, Target, TriangleAlert, Crosshair, ShieldCheck, Brain, UserCog, LifeBuoy, Play, CalendarClock, CircleCheck, AlarmClock,
  Repeat, Gauge, Trophy, FlaskConical, ListChecks, Zap, FileCheck2, History,
} from 'lucide-react';
import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, EmptyState, ErrorBox, LoadingState, PageHeader, ProgressNote, SectionCard, Spinner, StatCard, dayhhmm } from '../components/ui';

const v = (x: number | null | undefined, suffix = '%') => (x === null || x === undefined ? '—' : `${x}${suffix}`);
const kv = (o: Record<string, number>) => Object.entries(o ?? {});

function Counts({ o, empty = '—' }: { o: Record<string, number>; empty?: string }) {
  const e = kv(o);
  if (!e.length) return <span className="text-sm text-slate-400">{empty}</span>;
  return <div className="flex flex-wrap gap-1.5">{e.map(([k, n]) => <span key={k} className="inline-flex items-center gap-1.5"><Badge v={k} /><span className="text-sm font-semibold tabular-nums text-navy">{n}</span></span>)}</div>;
}

export default function Metrics() {
  const { data: m, error } = useApi<any>('/api/metrics');
  const act = useAction();
  const isOp = getRole() === 'operator';
  // Unchanged: confirm, then POST /api/eval/run (deterministic, 3 repetitions; resets the environment).
  const runEval = () => { if (confirm('Run the deterministic evaluation (resets the environment 21 times)?')) act.run('eval', () => api.post('/api/eval/run', { repetitions: 3 })); };
  const header = (
    <PageHeader icon={BarChart3} crumb="Metrics & Evaluation" illustration="warehouse" title="Metrics & Evaluation"
      subtitle="Computed from stored runs, audit events, plans and test history — never self-reported by an agent. Current-environment metrics reset with the environment; scenario and evaluation history persist."
      actions={<button className="btn-primary" disabled={!isOp || !!act.busy} title="Runs every seeded exception 3× from a clean reset (deterministic). LLM evaluation: npm run eval -- --llm" onClick={runEval}>
        {act.busy === 'eval' ? <Spinner /> : <Play className="h-4 w-4" aria-hidden />}{act.busy === 'eval' ? 'Evaluating…' : 'Run evaluation (deterministic ×3)'}
      </button>} />
  );
  if (!m) return <div className="space-y-5">{header}{error ? <ErrorBox operation="Load metrics" msg={error} /> : <LoadingState label="Computing metrics from stored runs, audit events and plans…" rows={6} />}</div>;
  const r = m.resolver;
  const latest = m.planner.latest;

  return (
    <div className="space-y-5">
      {header}
      {act.busy === 'eval' && <ProgressNote>Running 21 resolver investigations from clean resets…</ProgressNote>}
      {act.error && <ErrorBox operation="Run evaluation" msg={act.error} />}

      <SectionCard icon={Target} title="Exception Resolver" subtitle="Current environment · resets with the environment">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={Database} tone="sky" label="Resolver runs" value={r.runs} />
          <StatCard icon={Target} tone="emerald" label="Correct outcome" value={v(r.correct_outcome_rate_pct)} hint="vs ground truth (seeded)" />
          <StatCard icon={TriangleAlert} tone="orange" label="Escalation recall" value={v(r.escalation_recall_pct)} hint="should-escalate → escalated" />
          <StatCard icon={Crosshair} tone="orange" label="Escalation precision" value={v(r.escalation_precision_pct)} />
          <StatCard icon={ShieldCheck} tone={r.unsafe_action_count ? 'rose' : 'emerald'} label="Unsafe actions" value={r.unsafe_action_count} hint={`${r.blocked_unauthorized_attempts} unauthorized attempt(s) blocked`} />
          <StatCard icon={Brain} tone="violet" label="LLM agreement" value={v(r.llm_agreement_rate_pct)} hint="proposal = final decision" />
          <StatCard icon={UserCog} tone="slate" label="Guard overrides" value={v(r.guard_override_rate_pct)} hint={`${r.unsafe_proposals_blocked} unsafe proposal(s) blocked`} />
          <StatCard icon={LifeBuoy} tone="amber" label="LLM fallback" value={v(r.llm_fallback_rate_pct)} hint={`avg ${r.avg_tool_calls ?? '—'} tools · ${r.avg_duration_ms ? Math.round(r.avg_duration_ms / 100) / 10 : '—'} s`} />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-line p-3.5"><div className="label-xs mb-2 flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" aria-hidden />Outcomes</div><Counts o={r.by_outcome} empty="No resolver runs yet" /><div className="mt-2 text-xs text-slate-500">modes: {kv(r.by_mode).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}</div></div>
          <div className="rounded-xl border border-line p-3.5"><div className="label-xs mb-2 flex items-center gap-1.5"><FileCheck2 className="h-3.5 w-3.5" aria-hidden />Approvals &amp; escalations</div><div className="space-y-1.5"><div className="flex items-center gap-2 text-xs text-slate-500">approvals <Counts o={m.approvals} /></div><div className="flex items-center gap-2 text-xs text-slate-500">escalations <Counts o={m.escalations} /></div></div></div>
          <div className="rounded-xl border border-line p-3.5"><div className="label-xs mb-2 flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" aria-hidden />Events</div><div className="text-sm"><b className="text-navy">{m.events.total}</b> events</div><div className="mt-1"><Counts o={m.events.by_status} /></div><div className="mt-1 text-xs text-slate-500">{kv(m.events.by_type).map(([k, n]) => `${k.replace(/_/g, ' ').toLowerCase()} ${n}`).join(' · ')}</div></div>
        </div>
      </SectionCard>

      <SectionCard icon={CalendarClock} title="Shift Planner" subtitle="Current environment · plan versions and replans">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard icon={CalendarClock} tone="sky" label="Plan versions" value={m.planner.plans} hint={`${m.planner.replans} replan(s)`} />
          <StatCard icon={CircleCheck} tone="teal" label="Feasibility (latest)" value={v(latest?.feasibility_rate_pct)} hint="scheduled / (scheduled + infeasible)" />
          <StatCard icon={AlarmClock} tone={latest?.sla_at_risk ? 'rose' : 'slate'} label="SLA at risk (latest)" value={latest?.sla_at_risk ?? '—'} />
          <StatCard icon={Repeat} tone="emerald" label="Avg preservation on replan" value={v(m.planner.avg_preservation_rate_pct)} hint="assignments kept vs changed" />
          <StatCard icon={Gauge} tone="violet" label="Avg utilisation (latest)" value={v(latest?.avg_utilization_pct)} />
        </div>
        {m.planner.history.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="tbl">
              <thead><tr><th>Version</th><th>Trigger</th><th>Strategy</th><th>Assigned / prog / done</th><th>Blocked</th><th>Infeasible</th><th>SLA risk</th><th>Feasibility</th><th>Preserved / changed</th><th>Optimizer</th></tr></thead>
              <tbody>{m.planner.history.map((p: any) => (
                <tr key={p.version}>
                  <td className="whitespace-nowrap font-mono font-bold text-navy">v{p.version} {p.status === 'ACTIVE' && <Badge v="ACTIVE" />}</td>
                  <td className="text-xs">{p.trigger.replace(/_/g, ' ').toLowerCase()}</td>
                  <td><Badge v={p.strategy.replace('_', ' ')} tone={p.strategy === 'local_search' ? 'violet' : 'neutral'} /></td>
                  <td className="font-mono text-xs">{p.assigned} / {p.in_progress} / {p.completed}</td>
                  <td className="tabular-nums">{p.blocked}</td><td className="tabular-nums">{p.infeasible}</td><td className="tabular-nums">{p.sla_at_risk}</td>
                  <td className="font-semibold tabular-nums text-teal-800">{v(p.feasibility_rate_pct)}</td>
                  <td className="font-mono text-xs">{p.preserved ?? '—'} / {p.changed ?? '—'}</td>
                  <td className="text-xs">{p.optimizer ? `${p.optimizer.moves} move(s), makespan ${p.optimizer.before.makespan_min}→${p.optimizer.after.makespan_min}` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState compact illustration="chart" title="No plans in this environment yet">Generate a plan from the Shift Planner to populate planner metrics.</EmptyState>}
      </SectionCard>

      <SectionCard icon={Trophy} title="Tests & Evaluation" subtitle="Persistent history · survives environment resets">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
          <div className="min-w-0 rounded-xl border border-line p-4">
            <div className="label-xs mb-3 flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5" aria-hidden />Scenario success rate</div>
            {kv(m.scenarios.latest_by_mode).length === 0 ? <div className="text-sm text-slate-400">No scenario runs recorded yet.</div> : (
              <ul className="space-y-3">
                {Object.entries(m.scenarios.latest_by_mode).map(([mode, s]: any) => (
                  <li key={mode}>
                    <div className="flex items-baseline justify-between"><span className="font-semibold text-navy">{mode}</span><span className="text-sm tabular-nums text-slate-600">{s.pass}/{s.scenarios} PASS</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={`${mode} scenario success`} aria-valuenow={s.success_rate_pct ?? 0} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-emerald-500" style={{ width: `${s.success_rate_pct ?? 0}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 text-xs text-slate-500">All-time: {m.scenarios.all_time_runs} runs, {v(m.scenarios.all_time_success_rate_pct)} pass</div>
          </div>
          <div className="min-w-0 rounded-xl border border-line">
            <div className="label-xs flex items-center gap-1.5 border-b border-line px-4 py-3"><History className="h-3.5 w-3.5" aria-hidden />Evaluation batches</div>
            {m.evaluation.length === 0 ? <EmptyState compact illustration="chart" title="No evaluation yet">Click “Run evaluation”, or run <code className="font-mono">npm run eval -- --llm</code>.</EmptyState> : (
              <>
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead><tr><th>Batch</th><th>When</th><th>Mode / model</th><th>Runs</th><th>Accuracy</th><th>Consistency</th><th>LLM agreement</th><th>Overrides</th><th>Fallback</th><th>Unsafe</th><th>Avg tools / ms</th></tr></thead>
                    <tbody>{m.evaluation.map((b: any) => (
                      <tr key={b.batch_id}><td className="font-mono text-xs">{b.batch_id}</td><td className="whitespace-nowrap font-mono text-xs">{dayhhmm(b.run_at)}</td><td className="text-xs">{b.mode_requested}{b.model ? ` · ${b.model}` : ''}</td><td className="tabular-nums">{b.runs}</td><td className="font-bold tabular-nums text-emerald-700">{v(b.accuracy_pct)}</td><td className="tabular-nums">{v(b.consistency_pct)}</td><td className="tabular-nums">{v(b.llm_agreement_pct)}</td><td className="tabular-nums">{v(b.guard_override_pct)}</td><td className="tabular-nums">{v(b.fallback_pct)}</td><td className={`tabular-nums ${b.unsafe_actions ? 'font-bold text-rose-700' : ''}`}>{b.unsafe_actions}</td><td className="whitespace-nowrap font-mono text-xs">{b.avg_tool_calls} / {b.avg_ms}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <details className="border-t border-line px-4 py-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-teal-700">Per-exception breakdown (latest batch)</summary>
                  <div className="mt-2 overflow-x-auto rounded-lg border border-line">
                    <table className="tbl"><thead><tr><th>Exception</th><th>Expected</th><th>Outcomes</th><th>Accuracy</th><th>Consistent</th><th>Agreement</th><th>Overrides</th></tr></thead>
                      <tbody>{m.evaluation[0].by_exception.map((e: any) => <tr key={e.exception_id}><td className="font-mono">{e.exception_id}</td><td><Badge v={e.expected} /></td><td className="text-xs">{kv(e.outcomes).map(([k, n]) => `${k} ×${n}`).join(', ')}</td><td className="tabular-nums">{v(e.accuracy_pct)}</td><td>{e.consistent ? 'yes' : 'no'}</td><td className="tabular-nums">{v(e.agreement_pct)}</td><td className="tabular-nums">{e.overrides}</td></tr>)}</tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
