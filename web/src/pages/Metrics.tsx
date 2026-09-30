import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Card, ErrorBox, PageHeader, Stat, dayhhmm } from '../components/ui';

const v = (x: number | null | undefined, suffix = '%') => (x === null || x === undefined ? '—' : `${x}${suffix}`);
const kv = (o: Record<string, number>) => Object.entries(o ?? {}).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(' · ') || '—';

export default function Metrics() {
  const { data: m } = useApi<any>('/api/metrics');
  const act = useAction();
  const isOp = getRole() === 'operator';
  if (!m) return <div className="text-sm text-slate-400">Loading…</div>;
  const r = m.resolver;
  const latest = m.planner.latest;
  return (
    <div className="space-y-4">
      <PageHeader title="Metrics & evaluation" subtitle="Computed from stored runs, audit events, plans and test history — never self-reported by an agent. Current-environment metrics reset with the environment; scenario and evaluation history persist."
        actions={<button className="btn-primary" disabled={!isOp || !!act.busy} title="Runs every seeded exception 3× from a clean reset (deterministic). LLM evaluation: npm run eval -- --llm" onClick={() => { if (confirm('Run the deterministic evaluation (resets the environment 21 times)?')) act.run('eval', () => api.post('/api/eval/run', { repetitions: 3 })); }}>{act.busy === 'eval' ? 'Evaluating…' : 'Run evaluation (deterministic ×3)'}</button>} />
      <ErrorBox msg={act.error} />

      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Exception resolver (current environment)</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Resolver runs" value={r.runs} />
        <Stat label="Correct outcome" value={v(r.correct_outcome_rate_pct)} tone="emerald" hint="vs ground truth (seeded)" />
        <Stat label="Escalation recall" value={v(r.escalation_recall_pct)} tone="orange" hint="should-escalate → escalated" />
        <Stat label="Escalation precision" value={v(r.escalation_precision_pct)} tone="orange" />
        <Stat label="Unsafe actions" value={r.unsafe_action_count} tone={r.unsafe_action_count ? 'rose' : 'emerald'} hint={`${r.blocked_unauthorized_attempts} unauthorized attempt(s) blocked`} />
        <Stat label="LLM agreement" value={v(r.llm_agreement_rate_pct)} hint="proposal = final decision" />
        <Stat label="Guard overrides" value={v(r.guard_override_rate_pct)} hint={`${r.unsafe_proposals_blocked} unsafe proposal(s) blocked`} />
        <Stat label="LLM fallback" value={v(r.llm_fallback_rate_pct)} hint={`avg ${r.avg_tool_calls ?? '—'} tools · ${r.avg_duration_ms ? Math.round(r.avg_duration_ms / 100) / 10 : '—'} s`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Outcomes"><div className="text-sm">{kv(r.by_outcome)}</div><div className="mt-1 text-xs text-slate-500">modes: {kv(r.by_mode)}</div></Card>
        <Card title="Approvals & escalations"><div className="text-sm">approvals: {kv(m.approvals)}</div><div className="text-sm">escalations: {kv(m.escalations)}</div></Card>
        <Card title="Events"><div className="text-sm">{m.events.total} events · {kv(m.events.by_status)}</div><div className="mt-1 text-xs text-slate-500">{kv(m.events.by_type)}</div></Card>
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Shift planner</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Plan versions" value={m.planner.plans} hint={`${m.planner.replans} replan(s)`} />
        <Stat label="Feasibility (latest)" value={v(latest?.feasibility_rate_pct)} tone="teal" hint="scheduled / (scheduled + infeasible)" />
        <Stat label="SLA at risk (latest)" value={latest?.sla_at_risk ?? '—'} tone={latest?.sla_at_risk ? 'rose' : 'slate'} />
        <Stat label="Avg preservation on replan" value={v(m.planner.avg_preservation_rate_pct)} tone="emerald" hint="assignments kept vs changed" />
        <Stat label="Avg utilization (latest)" value={v(latest?.avg_utilization_pct)} />
      </div>
      {m.planner.history.length > 0 && (
        <Card title="Plan history">
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Version</th><th>Trigger</th><th>Strategy</th><th>Assigned / prog / done</th><th>Blocked</th><th>Infeasible</th><th>SLA risk</th><th>Feasibility</th><th>Preserved / changed</th><th>Optimizer</th></tr></thead>
            <tbody>{m.planner.history.map((p: any) => (
              <tr key={p.version}><td className="mono">v{p.version} {p.status === 'ACTIVE' ? '●' : ''}</td><td className="text-xs">{p.trigger}</td><td className="text-xs">{p.strategy}</td><td className="mono">{p.assigned} / {p.in_progress} / {p.completed}</td><td>{p.blocked}</td><td>{p.infeasible}</td><td>{p.sla_at_risk}</td><td>{v(p.feasibility_rate_pct)}</td><td className="mono">{p.preserved ?? '—'} / {p.changed ?? '—'}</td>
                <td className="text-xs">{p.optimizer ? `${p.optimizer.moves} move(s), makespan ${p.optimizer.before.makespan_min}→${p.optimizer.after.makespan_min}` : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Tests & evaluation (persistent history)</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Scenario success rate">
          {Object.entries(m.scenarios.latest_by_mode).map(([mode, s]: any) => <div key={mode} className="text-sm"><b>{mode}</b>: {s.pass}/{s.scenarios} PASS ({v(s.success_rate_pct)})</div>)}
          <div className="mt-1 text-xs text-slate-500">all-time: {m.scenarios.all_time_runs} runs, {v(m.scenarios.all_time_success_rate_pct)} pass</div>
        </Card>
        <Card title="Evaluation batches" className="lg:col-span-2">
          {m.evaluation.length === 0 && <div className="text-sm text-slate-400">No evaluation yet. Click “Run evaluation”, or run <code>npm run eval -- --llm</code>.</div>}
          <div className="overflow-x-auto"><table className="tbl">
            {m.evaluation.length > 0 && <thead><tr><th>Batch</th><th>When</th><th>Mode / model</th><th>Runs</th><th>Accuracy</th><th>Consistency</th><th>LLM agreement</th><th>Overrides</th><th>Fallback</th><th>Unsafe</th><th>Avg tools / ms</th></tr></thead>}
            <tbody>{m.evaluation.map((b: any) => (
              <tr key={b.batch_id}><td className="mono">{b.batch_id}</td><td className="mono">{dayhhmm(b.run_at)}</td><td className="text-xs">{b.mode_requested}{b.model ? ` · ${b.model}` : ''}</td><td>{b.runs}</td><td className="font-semibold text-emerald-700">{v(b.accuracy_pct)}</td><td>{v(b.consistency_pct)}</td><td>{v(b.llm_agreement_pct)}</td><td>{v(b.guard_override_pct)}</td><td>{v(b.fallback_pct)}</td><td className={b.unsafe_actions ? 'text-rose-700' : ''}>{b.unsafe_actions}</td><td className="mono">{b.avg_tool_calls} / {b.avg_ms}</td></tr>
            ))}</tbody>
          </table></div>
          {m.evaluation[0] && (
            <details className="mt-3 text-xs"><summary className="cursor-pointer text-teal-700">Per-exception breakdown (latest batch)</summary>
              <table className="tbl mt-2"><thead><tr><th>Exception</th><th>Expected</th><th>Outcomes</th><th>Accuracy</th><th>Consistent</th><th>Agreement</th><th>Overrides</th></tr></thead>
                <tbody>{m.evaluation[0].by_exception.map((e: any) => <tr key={e.exception_id}><td className="mono">{e.exception_id}</td><td className="text-xs">{e.expected}</td><td className="text-xs">{kv(e.outcomes)}</td><td>{v(e.accuracy_pct)}</td><td>{e.consistent ? 'yes' : 'no'}</td><td>{v(e.agreement_pct)}</td><td>{e.overrides}</td></tr>)}</tbody>
              </table></details>
          )}
        </Card>
      </div>
    </div>
  );
}
