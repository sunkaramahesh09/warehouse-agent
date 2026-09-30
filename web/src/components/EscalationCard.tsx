import { useState, type ReactNode } from 'react';
import { MessageSquareWarning, HelpCircle, ShieldAlert, ListChecks, Lightbulb } from 'lucide-react';
import { api, getRole } from '../api';
import { useAction } from '../hooks';
import { Badge, Chip, ErrorBox, Spinner } from './ui';

/** Structured escalation (all payload fields) + the reviewer's simulated resolution input. */
export default function EscalationCard({ e, compact = false }: { e: any; compact?: boolean }) {
  const p = e.payload ?? {};
  const act = useAction();
  const [note, setNote] = useState('');
  const [release, setRelease] = useState(false);
  const isReviewer = getRole() === 'reviewer';
  const L = ({ t, items, icon }: { t: string; items?: string[]; icon?: ReactNode }) => items && items.length ? (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{icon}{t}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-slate-700">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  ) : null;
  const open = e.status === 'OPEN';
  return (
    <article className={`overflow-hidden rounded-2xl border bg-white text-sm ${open ? 'border-orange-200 shadow-[0_0_0_4px_rgba(249,115,22,0.06)]' : 'border-line'}`} aria-label={`Escalation ${e.escalation_id}`}>
      <header className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${open ? 'bg-orange-50/70' : 'bg-slate-50'}`}>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-orange-100 text-orange-700"><MessageSquareWarning className="h-4 w-4" aria-hidden /></span>
          <div className="leading-tight">
            <div className="text-[11px] font-bold uppercase tracking-wider text-orange-800">Structured escalation</div>
            <div className="font-mono text-xs text-slate-500">{e.escalation_id} · {p.exception_id} / {p.order_id}{e.type ? ` · ${e.type.replace(/_/g, ' ').toLowerCase()}` : ''}</div>
          </div>
        </div>
        <Badge v={e.status} dot />
      </header>
      <div className="space-y-3 px-4 py-3">
        <div className="rounded-lg bg-orange-50/60 px-3 py-2 ring-1 ring-orange-100"><span className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">Detected issue</span><div className="font-semibold text-navy">{p.detected_issue}</div></div>
        {!compact && <L t="Evidence checked" items={p.evidence_checked} />}
        {!compact && p.tool_results?.length > 0 && <L t="Tool results" items={p.tool_results.map((t: any) => `${t.ok ? '✓' : '✗'} ${t.tool}: ${t.summary}`)} />}
        <L t="Conflicting facts" icon={<ShieldAlert className="h-3.5 w-3.5 text-orange-600" aria-hidden />} items={p.conflicting_facts} />
        <L t="Missing facts" items={p.missing_facts} />
        {p.policy_refs?.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Policy references</div>
            <ul className="mt-1 space-y-1">{p.policy_refs.map((x: any) => <li key={x.policy_id} className="text-[13px] text-slate-700"><Chip tone="brand">{x.policy_id}</Chip> <b className="text-navy">{x.title}</b>: {x.why}</li>)}</ul>
          </div>
        )}
        <div className="rounded-lg bg-teal-50/60 px-3 py-2 ring-1 ring-teal-100">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-teal-800"><Lightbulb className="h-3.5 w-3.5" aria-hidden />Recommended human action</div>
          <div className="text-[13px] text-slate-700">{p.recommended_human_action}</div>
        </div>
        <L t="Actions already taken" icon={<ListChecks className="h-3.5 w-3.5 text-teal-600" aria-hidden />} items={p.actions_already_taken} />
        {p.current_state && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">Current state: order <Badge v={p.current_state.order_status} /> exception <Badge v={p.current_state.exception_status} /></div>}
        <L t="Unresolved questions" icon={<HelpCircle className="h-3.5 w-3.5 text-orange-600" aria-hidden />} items={p.unresolved_questions} />
      </div>
      {open && (
        <div className="space-y-2 border-t border-line bg-slate-50/60 px-4 py-3">
          <label className="block text-xs font-medium text-slate-600" htmlFor={`res-${e.escalation_id}`}>Exception Reviewer records a simulated resolution</label>
          <textarea id={`res-${e.escalation_id}`} className="input w-full" rows={2} placeholder="Resolution note (e.g. 'Recounted B-02: 5 units confirmed; replenishment ordered')" value={note} onChange={(ev) => setNote(ev.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-700"><input type="checkbox" className="h-4 w-4 accent-teal-700" checked={release} onChange={(ev) => setRelease(ev.target.checked)} /> release the order hold</label>
            <button className="btn-primary btn-sm" disabled={!isReviewer || note.length < 5 || !!act.busy} onClick={() => act.run('resolve', () => api.post(`/api/escalations/${e.escalation_id}/resolve`, { resolution_note: note, release_hold: release }))}>
              {act.busy && <Spinner className="h-3.5 w-3.5" />}Record resolution
            </button>
            {!isReviewer && <span className="text-xs text-slate-500">Switch role to <b>Exception Reviewer</b> to resolve.</span>}
          </div>
          {act.error && <ErrorBox operation="Record resolution" msg={act.error} />}
        </div>
      )}
      {e.status === 'RESOLVED' && <div className="border-t border-line px-4 py-2 text-xs text-slate-600">Resolved by <b className="text-navy">{e.resolved_by}</b>: “{e.resolution_note}”</div>}
    </article>
  );
}
