import { useState } from 'react';
import { api, getRole } from '../api';
import { useAction } from '../hooks';
import { Badge, ErrorBox } from './ui';

/** The explicit, separate approval input. Nothing executes until an Operator clicks Approve. */
export default function ApprovalCard({ a }: { a: any }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [result, setResult] = useState<any>(null);
  const isOperator = getRole() === 'operator';
  const decide = (decision: 'APPROVE' | 'REJECT') =>
    act.run(decision, async () => setResult(await api.post(`/api/approvals/${a.approval_id}/decide`, { decision, note: note || undefined })));
  const policies: string[] = a.policy_ids ?? [];
  return (
    <div className="rounded-lg border-2 border-fuchsia-300 bg-fuchsia-50/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-fuchsia-800">Proposed action — requires explicit approval</div>
        <Badge v={a.status} />
      </div>
      <dl className="mt-2 grid grid-cols-[90px_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">Action</dt><dd className="font-semibold">{a.action_type?.replace(/_/g, ' ')} <span className="mono font-normal">{JSON.stringify(a.params ?? {})}</span></dd>
        <dt className="text-slate-500">Reason</dt><dd>{a.reason}</dd>
        {policies.length > 0 && <><dt className="text-slate-500">Policy</dt><dd className="font-mono">{policies.join(', ')}</dd></>}
        <dt className="text-slate-500">Effect</dt><dd>{a.effect}</dd>
        {a.expires_at && <><dt className="text-slate-500">Expires</dt><dd className="mono">{a.expires_at.slice(11, 16)} (simulated clock)</dd></>}
        <dt className="text-slate-500">ID</dt><dd className="mono">{a.approval_id}</dd>
      </dl>
      {a.status === 'PENDING' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input className="input min-w-48 flex-1" placeholder="Decision note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-success" disabled={!isOperator || !!act.busy} onClick={() => decide('APPROVE')}>{act.busy === 'APPROVE' ? 'Executing…' : 'Approve & execute'}</button>
          <button className="btn-danger" disabled={!isOperator || !!act.busy} onClick={() => decide('REJECT')}>Reject</button>
          {!isOperator && <span className="text-xs text-slate-500">Switch role to Operator to decide.</span>}
        </div>
      )}
      {a.status === 'APPROVED' && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          Approved but not executed (e.g. execution timed out).
          <button className="btn-secondary" disabled={!isOperator || !!act.busy} onClick={() => act.run('exec', async () => setResult(await api.post(`/api/approvals/${a.approval_id}/execute`)))}>Retry execution</button>
        </div>
      )}
      {a.decided_by && <div className="mt-2 text-xs text-slate-500">Decided by {a.decided_by}{a.decision_note ? ` — “${a.decision_note}”` : ''}</div>}
      <ErrorBox msg={act.error} />
      {result && <div className="mt-2 rounded bg-white p-2 text-xs"><b>Result:</b> {result.executed ? `executed ✓ ${JSON.stringify(result.result?.state_changes ?? '')}` : result.decision === 'REJECTED' ? `rejected — nothing executed; escalated as ${result.escalation_id}` : result.message ?? JSON.stringify(result)}</div>}
    </div>
  );
}
