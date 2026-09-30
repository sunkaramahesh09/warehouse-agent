import { Badge, Json } from './ui';
import ApprovalCard from './ApprovalCard';
import EscalationCard from './EscalationCard';

/** Structured, operational view of a resolver run — tool calls, evidence, policy, decision, action, result. No chain-of-thought. */
export default function RunReport({ r, approvals = [], escalations = [] }: { r: any; approvals?: any[]; escalations?: any[] }) {
  const approval = r.approval ? approvals.find((a) => a.approval_id === r.approval.approval_id) ?? { ...r.approval, status: r.approval.status } : null;
  const escalation = r.escalation ? escalations.find((e) => e.escalation_id === r.escalation.escalation_id) ?? { ...r.escalation, status: 'OPEN' } : null;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge v={r.outcome} />
        <span className="mono text-slate-500">{r.run_id}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">mode: {r.mode}{r.model ? ` (${r.model})` : ''}</span>
        {r.fallback_reason && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">fallback: {r.fallback_reason}</span>}
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">SIMULATED</span>
      </div>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">1 · Investigation ({r.steps.length} tool calls)</h3>
        <ol className="space-y-1">
          {r.steps.map((s: any) => (
            <li key={s.n} className="flex gap-2">
              <span className={s.ok ? 'text-emerald-600' : 'text-rose-600'}>{s.ok ? '✓' : '✗'}</span>
              <span className="mono shrink-0 text-slate-700">{s.tool}</span>
              <span className="min-w-0 flex-1 text-slate-600">{s.summary}</span>
              <span className="shrink-0 text-[10px] text-slate-400" title="who selected this call">{s.selected_by}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">2 · Evidence</h3>
        {r.detected_issue && <p className="font-medium text-slate-800">{r.detected_issue}</p>}
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">{r.findings.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
        {r.conflicting_facts.length > 0 && (
          <div className="mt-2 rounded border border-orange-200 bg-orange-50 p-2">
            <div className="text-xs font-semibold text-orange-800">Conflicting facts</div>
            <ul className="list-disc pl-5 text-orange-900">{r.conflicting_facts.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
          </div>
        )}
        {r.missing_facts.length > 0 && (
          <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2">
            <div className="text-xs font-semibold text-rose-800">Missing facts</div>
            <ul className="list-disc pl-5 text-rose-900">{r.missing_facts.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">3 · Policy used</h3>
        <div className="space-y-2">
          {r.policies.map((p: any) => (
            <div key={p.policy_id} className="rounded border border-slate-200 p-2">
              <div><span className="font-mono font-semibold text-teal-800">{p.policy_id}</span> — {p.title} <span className="text-[10px] text-slate-400">cited by {p.cited_by}</span></div>
              <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-500">“{p.excerpt}”</blockquote>
              {p.why && <div className="mt-1 text-xs text-slate-700"><b>Why it applies:</b> {p.why}</div>}
            </div>
          ))}
          {r.policies.length === 0 && <div className="text-rose-700">No policy cited (policy gap → no action taken).</div>}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">4 · Decision</h3>
        <div className="flex flex-wrap items-center gap-2">
          {r.proposal && <span className="text-xs text-slate-500">proposed by {r.proposal.source}: <b>{r.proposal.decision}</b> {r.proposal.actions?.length ? `[${r.proposal.actions.join(', ')}]` : ''}</span>}
          <span className="text-xs">→ final: <Badge v={r.decision.kind} /></span>
          {r.guard.overridden && <span className="rounded bg-rose-50 px-1.5 text-xs font-semibold text-rose-700">guard override</span>}
        </div>
        <ul className="mt-1 list-disc pl-5 text-xs text-slate-500">{r.guard.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
        {r.guard.llm_feedback?.length > 0 && <div className="mt-1 text-xs text-amber-700">Guard feedback sent to the model: {r.guard.llm_feedback.join(' | ')}</div>}
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">5 · Actions (results confirmed by controlled tools)</h3>
        {r.actions.length === 0 && <div className="text-slate-500">No state-changing action.</div>}
        <ul className="space-y-1">
          {r.actions.map((a: any, i: number) => (
            <li key={i} className={`rounded px-2 py-1 ${a.ok ? 'bg-emerald-50' : 'bg-rose-50'}`}>
              <span className={a.ok ? 'text-emerald-700' : 'text-rose-700'}>{a.ok ? '✓' : '✗'}</span> <span className="mono">{a.tool}</span>
              {a.duplicate && <span className="ml-1 text-xs text-slate-500">(duplicate suppressed)</span>}
              {!a.ok && <span className="ml-1 text-rose-800">{a.error?.code}: {a.error?.message}</span>}
              {a.verification && <div className="text-xs font-medium text-rose-800">{a.verification}</div>}
              <Json value={a.ok ? a.result : a.input} label={a.ok ? 'result' : 'input'} />
            </li>
          ))}
        </ul>
      </section>

      {approval && <ApprovalCard a={approval} />}
      {escalation && <EscalationCard e={escalation} />}

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">6 · Result</h3>
        <p className="text-slate-700">{r.narrative}</p>
        <div className="mt-1 text-xs text-slate-500">Final state (re-read after actions): order <b>{r.final_state.order_status ?? '?'}</b>, exception <b>{r.final_state.exception_status ?? '?'}</b></div>
      </section>
    </div>
  );
}
