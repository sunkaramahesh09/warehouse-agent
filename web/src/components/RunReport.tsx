import type { ReactNode } from 'react';
import { ArrowRight, BookOpenCheck, CheckCircle2, FileSearch, Gavel, ShieldAlert, ShieldCheck, Wrench, XCircle, CircleDot, Flag } from 'lucide-react';
import { Badge, Chip, Json, type Icon } from './ui';
import ApprovalCard from './ApprovalCard';
import EscalationCard from './EscalationCard';

/**
 * Structured, operational view of one resolver run:
 *   read tools → evidence → policy → guarded decision → controlled action / escalation → result.
 * Shows only what the system recorded (tool results, citations, guard notes). No chain-of-thought.
 */
export default function RunReport({ r, approvals = [], escalations = [] }: { r: any; approvals?: any[]; escalations?: any[] }) {
  const approval = r.approval ? approvals.find((a) => a.approval_id === r.approval.approval_id) ?? { ...r.approval, status: r.approval.status } : null;
  const escalation = r.escalation ? escalations.find((e) => e.escalation_id === r.escalation.escalation_id) ?? { ...r.escalation, status: 'OPEN' } : null;
  const okActions = r.actions.filter((a: any) => a.ok).length;
  const failedActions = r.actions.length - okActions;

  const stages: Array<{ id: string; icon: Icon; label: string; value: string; tone: 'ok' | 'warn' | 'bad' }> = [
    { id: 'tools', icon: Wrench, label: 'Read tools', value: `${r.steps.length} call${r.steps.length === 1 ? '' : 's'}`, tone: r.steps.some((s: any) => !s.ok) ? 'warn' : 'ok' },
    { id: 'evidence', icon: FileSearch, label: 'Evidence', value: `${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}${r.conflicting_facts.length ? ` · ${r.conflicting_facts.length} conflict` : ''}`, tone: r.missing_facts.length ? 'warn' : 'ok' },
    { id: 'policy', icon: BookOpenCheck, label: 'Policy', value: r.policies.length ? r.policies.map((p: any) => p.policy_id).join(', ') : 'policy gap', tone: r.policies.length ? 'ok' : 'bad' },
    { id: 'decision', icon: Gavel, label: 'Guarded decision', value: `${r.decision.kind.replace(/_/g, ' ')}${r.guard.overridden ? ' (override)' : ''}`, tone: r.guard.overridden ? 'warn' : 'ok' },
    { id: 'action', icon: r.escalation ? Flag : ShieldCheck, label: r.escalation ? 'Escalation' : 'Action', value: failedActions ? `${failedActions} failed` : r.actions.length ? `${okActions} confirmed` : 'none', tone: failedActions ? 'bad' : 'ok' },
  ];
  const toneCls = { ok: 'bg-teal-50 text-teal-700 ring-teal-100', warn: 'bg-amber-50 text-amber-700 ring-amber-100', bad: 'bg-rose-50 text-rose-700 ring-rose-100' };

  return (
    <div className="space-y-5 text-sm">
      {/* run header */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge v={r.outcome} dot />
        <Chip>{r.run_id}</Chip>
        <Chip tone="brand" mono={false}>mode: {r.mode}{r.model ? ` · ${r.model}` : ''}</Chip>
        {r.fallback_reason && <Chip tone="warning" mono={false}>fallback: {r.fallback_reason}</Chip>}
        <Badge v="SIMULATED" tone="warning" />
      </div>

      {/* pipeline */}
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="Resolver pipeline">
        {stages.map((s, i) => (
          <li key={s.id} className="relative">
            <a href={`#rr-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`rr-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              className="flex h-full flex-col gap-1 rounded-xl border border-line bg-white p-2.5 transition hover:border-teal-200 hover:bg-teal-50/30">
              <span className="flex items-center gap-1.5">
                <span className={`grid h-6 w-6 place-items-center rounded-lg ring-1 ${toneCls[s.tone]}`}><s.icon className="h-3.5 w-3.5" aria-hidden /></span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{i + 1}. {s.label}</span>
              </span>
              <span className="line-clamp-2 text-xs font-semibold text-navy" title={s.value}>{s.value}</span>
            </a>
            {i < stages.length - 1 && <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-canvas text-slate-400 sm:block" aria-hidden />}
          </li>
        ))}
      </ol>

      <Stage id="tools" n={1} title={`Read tools (${r.steps.length} controlled calls)`} icon={Wrench}>
        <ol className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-line">
          {r.steps.map((s: any) => (
            <li key={s.n} className="flex items-start gap-2.5 bg-white px-3 py-2">
              <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[11px] text-slate-400">{s.n}</span>
              {s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-label="failed" />}
              <span className="shrink-0"><Chip tone="info">{s.tool}</Chip></span>
              <span className="min-w-0 flex-1 text-[13px] text-slate-600">{s.summary}</span>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500" title="who selected this call">{s.selected_by}</span>
            </li>
          ))}
        </ol>
      </Stage>

      <Stage id="evidence" n={2} title="Evidence" icon={FileSearch}>
        {r.detected_issue && <p className="rounded-xl bg-slate-50 px-3 py-2 font-medium text-navy ring-1 ring-line">{r.detected_issue}</p>}
        {r.findings.length > 0 && <ul className="mt-2 space-y-1">{r.findings.map((f: string, i: number) => <li key={i} className="flex gap-2 text-slate-600"><CircleDot className="mt-1 h-3 w-3 shrink-0 text-teal-600" aria-hidden />{f}</li>)}</ul>}
        {r.conflicting_facts.length > 0 && (
          <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-orange-800"><ShieldAlert className="h-3.5 w-3.5" aria-hidden />Conflicting facts</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-orange-900">{r.conflicting_facts.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
          </div>
        )}
        {r.missing_facts.length > 0 && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-rose-800">Missing facts</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-rose-900">{r.missing_facts.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
          </div>
        )}
      </Stage>

      <Stage id="policy" n={3} title="Policy used (shared SOP)" icon={BookOpenCheck}>
        <div className="space-y-2">
          {r.policies.map((p: any) => (
            <div key={p.policy_id} className="rounded-xl border border-line bg-white p-3">
              <div className="flex flex-wrap items-center gap-2"><Chip tone="brand">{p.policy_id}</Chip><span className="font-semibold text-navy">{p.title}</span><span className="text-[11px] text-slate-400">cited by {p.cited_by}</span></div>
              <blockquote className="mt-2 border-l-2 border-teal-200 pl-3 text-[13px] italic text-slate-500">“{p.excerpt}”</blockquote>
              {p.why && <div className="mt-1.5 text-[13px] text-slate-700"><b className="text-navy">Why it applies:</b> {p.why}</div>}
            </div>
          ))}
          {r.policies.length === 0 && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800">No policy cited (policy gap → no action taken).</div>}
        </div>
      </Stage>

      <Stage id="decision" n={4} title="Guarded decision" icon={Gavel}>
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-line">
          {r.proposal && <span className="text-[13px] text-slate-600">Proposed by <b className="text-navy">{r.proposal.source}</b>: <Badge v={r.proposal.decision} /> {r.proposal.actions?.length ? <span className="font-mono text-xs text-slate-500">[{r.proposal.actions.join(', ')}]</span> : null}</span>}
          <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
          <span className="text-[13px] text-slate-600">Final: <Badge v={r.decision.kind} /></span>
          {r.guard.overridden && <Badge v="GUARD OVERRIDE" tone="danger" />}
        </div>
        {r.guard.notes.length > 0 && <ul className="mt-2 space-y-1">{r.guard.notes.map((n: string, i: number) => <li key={i} className="flex gap-2 text-[13px] text-slate-600"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />{n}</li>)}</ul>}
        {r.guard.llm_feedback?.length > 0 && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">Guard feedback sent to the model: {r.guard.llm_feedback.join(' | ')}</div>}
      </Stage>

      <Stage id="action" n={5} title="Actions — results confirmed by controlled tools" icon={ShieldCheck}>
        {r.actions.length === 0 && <div className="rounded-xl bg-slate-50 px-3 py-2 text-slate-500 ring-1 ring-line">No state-changing action.</div>}
        <ul className="space-y-2">
          {r.actions.map((a: any, i: number) => (
            <li key={i} className={`rounded-xl px-3 py-2 ring-1 ${a.ok ? 'bg-emerald-50/70 ring-emerald-200' : 'bg-rose-50 ring-rose-200'}`}>
              <div className="flex flex-wrap items-center gap-2">
                {a.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="succeeded" /> : <XCircle className="h-4 w-4 text-rose-600" aria-label="failed" />}
                <span className="font-mono text-[13px] font-semibold text-navy">{a.tool}</span>
                {a.duplicate && <span className="text-xs text-slate-500">(duplicate suppressed)</span>}
                {!a.ok && <span className="text-[13px] text-rose-800">{a.error?.code}: {a.error?.message}</span>}
              </div>
              {a.verification && <div className="mt-1 text-xs font-semibold text-rose-800">{a.verification}</div>}
              <div className="mt-1"><Json value={a.ok ? a.result : a.input} label={a.ok ? 'result' : 'input'} /></div>
            </li>
          ))}
        </ul>
        {(approval || escalation) && <div className="mt-3 space-y-3">{approval && <ApprovalCard a={approval} />}{escalation && <EscalationCard e={escalation} />}</div>}
      </Stage>

      <section className="rounded-xl border border-teal-200 bg-teal-50/50 p-4" aria-labelledby="rr-result">
        <h3 id="rr-result" className="text-xs font-semibold uppercase tracking-wide text-teal-800">6 · Result</h3>
        <p className="mt-1 text-slate-700">{r.narrative}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          Final state (re-read after actions): order <Badge v={r.final_state.order_status ?? '?'} /> exception <Badge v={r.final_state.exception_status ?? '?'} />
        </div>
      </section>
    </div>
  );
}

function Stage({ id, n, title, icon: I, children }: { id: string; n: number; title: string; icon: Icon; children: ReactNode }) {
  return (
    <section id={`rr-${id}`} className="scroll-mt-4" aria-labelledby={`rr-${id}-h`}>
      <h3 id={`rr-${id}-h`} className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-teal-700 text-[10px] font-bold text-white">{n}</span>
        <I className="h-3.5 w-3.5 text-teal-700" aria-hidden />{title}
      </h3>
      {children}
    </section>
  );
}
