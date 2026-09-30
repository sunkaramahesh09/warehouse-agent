import { useState } from 'react';
import { FileCheck2, Check, X, RotateCw, CircleCheck, CircleX, Clock } from 'lucide-react';
import { api, getRole } from '../api';
import { useAction } from '../hooks';
import { Badge, Chip, ErrorBox, Spinner } from './ui';

/** The explicit, separate approval input. Nothing executes until an Operator clicks Approve. */
export default function ApprovalCard({ a }: { a: any }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [result, setResult] = useState<any>(null);
  const isOperator = getRole() === 'operator';
  // Unchanged: POST /api/approvals/:id/decide {decision, note} → server decides (operator-only) and executes via controlled tool.
  const decide = (decision: 'APPROVE' | 'REJECT') =>
    act.run(decision, async () => setResult(await api.post(`/api/approvals/${a.approval_id}/decide`, { decision, note: note || undefined })));
  const policies: string[] = a.policy_ids ?? [];
  const pending = a.status === 'PENDING';
  return (
    <article className={`overflow-hidden rounded-2xl border bg-white ${pending ? 'border-fuchsia-200 shadow-[0_0_0_4px_rgba(217,70,239,0.06)]' : 'border-line'}`} aria-label={`Approval ${a.approval_id}`}>
      <header className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${pending ? 'bg-fuchsia-50/70' : 'bg-slate-50'}`}>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-fuchsia-100 text-fuchsia-700"><FileCheck2 className="h-4 w-4" aria-hidden /></span>
          <div className="leading-tight">
            <div className="text-[11px] font-bold uppercase tracking-wider text-fuchsia-800">Proposed action — requires explicit approval</div>
            <div className="font-mono text-xs text-slate-500">{a.approval_id}{a.exception_id ? ` · ${a.exception_id}` : ''}{a.order_id ? ` · ${a.order_id}` : ''}</div>
          </div>
        </div>
        <Badge v={a.status} dot />
      </header>
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 px-4 py-3 text-sm">
        <dt className="text-slate-500">Action</dt><dd><span className="font-semibold text-navy">{a.action_type?.replace(/_/g, ' ')}</span> <span className="font-mono text-xs text-slate-500">{JSON.stringify(a.params ?? {})}</span></dd>
        <dt className="text-slate-500">Reason</dt><dd className="text-slate-700">{a.reason}</dd>
        {policies.length > 0 && <><dt className="text-slate-500">Policy</dt><dd className="flex flex-wrap gap-1">{policies.map((p) => <Chip key={p} tone="brand">{p}</Chip>)}</dd></>}
        <dt className="text-slate-500">Effect</dt><dd className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-slate-700 ring-1 ring-line">{a.effect}</dd>
        {a.expires_at && <><dt className="text-slate-500">Expires</dt><dd className="flex items-center gap-1 font-mono text-xs text-slate-600"><Clock className="h-3.5 w-3.5" aria-hidden />{a.expires_at.slice(11, 16)} (simulated clock)</dd></>}
      </dl>
      {pending && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <label className="min-w-48 flex-1"><span className="sr-only">Decision note</span>
            <input className="input w-full" placeholder="Decision note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="btn-success" disabled={!isOperator || !!act.busy} onClick={() => decide('APPROVE')}>
            {act.busy === 'APPROVE' ? <Spinner /> : <Check className="h-4 w-4" aria-hidden />}{act.busy === 'APPROVE' ? 'Executing…' : 'Approve & execute'}
          </button>
          <button className="btn-danger" disabled={!isOperator || !!act.busy} onClick={() => decide('REJECT')}>
            {act.busy === 'REJECT' ? <Spinner /> : <X className="h-4 w-4" aria-hidden />}Reject
          </button>
          {!isOperator && <span className="w-full text-xs text-slate-500">Switch role to <b>Operator</b> to decide. Agents and reviewers cannot approve.</span>}
        </div>
      )}
      {a.status === 'APPROVED' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm text-slate-700">
          Approved but not executed (e.g. execution timed out).
          <button className="btn-secondary btn-sm" disabled={!isOperator || !!act.busy} onClick={() => act.run('exec', async () => setResult(await api.post(`/api/approvals/${a.approval_id}/execute`)))}>
            {act.busy === 'exec' ? <Spinner className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" aria-hidden />}Retry execution
          </button>
        </div>
      )}
      {a.decided_by && <div className="border-t border-line px-4 py-2 text-xs text-slate-500">Decided by <b className="text-navy">{a.decided_by}</b>{a.decision_note ? ` — “${a.decision_note}”` : ''}</div>}
      {act.error && <div className="px-4 pb-3"><ErrorBox operation="Approval decision" msg={act.error} /></div>}
      {result && (
        <div className={`mx-4 mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ring-1 ${result.executed ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : result.decision === 'REJECTED' ? 'bg-slate-50 text-slate-700 ring-line' : 'bg-rose-50 text-rose-800 ring-rose-200'}`} role="status">
          {result.executed ? <CircleCheck className="h-4 w-4 shrink-0" aria-hidden /> : <CircleX className="h-4 w-4 shrink-0" aria-hidden />}
          <span><b>Result:</b> {result.executed ? `executed ✓ ${JSON.stringify(result.result?.state_changes ?? '')}` : result.decision === 'REJECTED' ? `rejected — nothing executed; escalated as ${result.escalation_id}` : result.message ?? JSON.stringify(result)}</span>
        </div>
      )}
    </article>
  );
}
