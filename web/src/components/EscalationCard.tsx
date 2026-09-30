import { useState } from 'react';
import { api, getRole } from '../api';
import { useAction } from '../hooks';
import { Badge, ErrorBox } from './ui';

export default function EscalationCard({ e, compact = false }: { e: any; compact?: boolean }) {
  const p = e.payload ?? {};
  const act = useAction();
  const [note, setNote] = useState('');
  const [release, setRelease] = useState(false);
  const isReviewer = getRole() === 'reviewer';
  const L = ({ t, items }: { t: string; items?: string[] }) => items && items.length ? (
    <div><div className="text-xs font-semibold text-slate-500">{t}</div><ul className="list-disc pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
  ) : null;
  return (
    <div className="rounded-lg border-2 border-orange-300 bg-orange-50/40 p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-orange-800">Structured escalation · <span className="font-mono">{e.escalation_id}</span></div>
        <Badge v={e.status} />
      </div>
      <div className="mt-2 space-y-2">
        <div><span className="text-xs text-slate-500">Exception / order:</span> <span className="font-mono">{p.exception_id} / {p.order_id}</span></div>
        <div><span className="text-xs text-slate-500">Detected issue:</span> <b>{p.detected_issue}</b></div>
        {!compact && <L t="Evidence checked" items={p.evidence_checked} />}
        {!compact && p.tool_results?.length > 0 && <L t="Tool results" items={p.tool_results.map((t: any) => `${t.ok ? '✓' : '✗'} ${t.tool}: ${t.summary}`)} />}
        <L t="Conflicting facts" items={p.conflicting_facts} />
        <L t="Missing facts" items={p.missing_facts} />
        {p.policy_refs?.length > 0 && <L t="Policy references" items={p.policy_refs.map((x: any) => `${x.policy_id} — ${x.title}: ${x.why}`)} />}
        <div><span className="text-xs font-semibold text-slate-500">Recommended human action</span><div>{p.recommended_human_action}</div></div>
        <L t="Actions already taken" items={p.actions_already_taken} />
        {p.current_state && <div><span className="text-xs font-semibold text-slate-500">Current state</span> <span className="mono">{JSON.stringify({ order_status: p.current_state.order_status, exception_status: p.current_state.exception_status })}</span></div>}
        <L t="Unresolved questions" items={p.unresolved_questions} />
      </div>
      {e.status === 'OPEN' && (
        <div className="mt-3 space-y-2 border-t border-orange-200 pt-2">
          <div className="text-xs text-slate-600">Exception Reviewer records a simulated resolution:</div>
          <textarea className="input w-full" rows={2} placeholder="Resolution note (e.g. 'Recounted B-02: 5 units confirmed; replenishment ordered')" value={note} onChange={(ev) => setNote(ev.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={release} onChange={(ev) => setRelease(ev.target.checked)} /> release the order hold</label>
            <button className="btn-primary" disabled={!isReviewer || note.length < 5 || !!act.busy} onClick={() => act.run('resolve', () => api.post(`/api/escalations/${e.escalation_id}/resolve`, { resolution_note: note, release_hold: release }))}>Record resolution</button>
            {!isReviewer && <span className="text-xs text-slate-500">Switch role to Exception Reviewer to resolve.</span>}
          </div>
          <ErrorBox msg={act.error} />
        </div>
      )}
      {e.status === 'RESOLVED' && <div className="mt-2 text-xs text-slate-600">Resolved by {e.resolved_by}: “{e.resolution_note}”</div>}
    </div>
  );
}
