import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Card, ErrorBox, PageHeader, dayhhmm } from '../components/ui';
import RunReport from '../components/RunReport';

const hint: Record<string, string> = {
  'EXC-2001': 'shortfall → hold (planner impact)', 'EXC-2002': 'duplicate → approval-gated cancel', 'EXC-2003': 'recoverable desync → autonomous',
  'EXC-2004': 'contradictory → escalation', 'EXC-2005': 'invalid data', 'EXC-2006': 'stale shipment', 'EXC-2007': 'ambiguous conflict',
};

export default function Exceptions() {
  const list = useApi<any[]>('/api/exceptions');
  const meta = useApi<any>('/api/meta');
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<'auto' | 'deterministic' | 'llm'>('auto');
  const detail = useApi<any>(sel ? `/api/exceptions/${sel}` : null);
  const act = useAction();
  const [fresh, setFresh] = useState<any>(null);

  useEffect(() => { setFresh(null); act.setError(null); }, [sel]);
  const investigate = (id: string) => act.run(id, async () => { setSel(id); const r = await api.post(`/api/exceptions/${id}/investigate`, { mode }); setFresh(r); });
  const report = fresh?.exception_id === sel ? fresh : detail.data?.runs?.[0]?.report;
  const llmOn = meta.data?.llm?.configured;

  return (
    <div className="space-y-4">
      <PageHeader title="Exceptions" subtitle="Investigate runs the Exception Resolver: read-only tool calls → evidence → shared SOP → guarded decision → controlled action or escalation."
        actions={<label className="flex items-center gap-2 text-sm">Agent mode
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="auto">auto ({llmOn ? 'LLM' : 'deterministic'})</option>
            <option value="deterministic">deterministic</option>
            <option value="llm" disabled={!llmOn}>LLM {llmOn ? '' : '(no key)'}</option>
          </select></label>} />
      <ErrorBox msg={act.error} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card title="Exception queue">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Exception</th><th>Status</th><th>Last outcome</th><th /></tr></thead>
              <tbody>
                {(list.data ?? []).map((e) => (
                  <tr key={e.exception_id} className={`cursor-pointer ${sel === e.exception_id ? 'bg-teal-50/60' : ''}`} onClick={() => setSel(e.exception_id)}>
                    <td><div><span className="font-mono font-semibold">{e.exception_id}</span> <span className="font-mono text-xs text-slate-500">· {e.order_id}</span></div><div className="text-[11px] text-slate-600">{e.type.replace(/_/g, ' ')}</div><div className="text-[11px] text-slate-400">{hint[e.exception_id] ?? dayhhmm(e.detected_at)}</div></td>
                    <td><Badge v={e.status} /></td>
                    <td className="text-xs">{e.last_run ? <><Badge v={e.last_run.outcome} /> <div className="mono mt-0.5 text-slate-500">{(e.last_run.policies ?? []).map((p: any) => p.policy_id).join(', ')}</div></> : '—'}</td>
                    <td>
                      <button className="btn-primary py-1" disabled={!!act.busy || ['RESOLVED', 'CLOSED', 'AWAITING_APPROVAL', 'ESCALATED'].includes(e.status)}
                        onClick={(ev) => { ev.stopPropagation(); investigate(e.exception_id); }}>
                        {act.busy === e.exception_id ? 'Investigating…' : e.status === 'FAILED' ? 'Retry' : 'Investigate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={sel ? <>Investigation · <span className="font-mono">{sel}</span></> : 'Investigation'}>
          {!sel && <div className="text-sm text-slate-400">Select an exception, or click Investigate.</div>}
          {sel && detail.data && (
            <div className="mb-3 rounded bg-slate-50 p-2 text-xs text-slate-600">
              <b>{detail.data.type}</b> on <span className="font-mono">{detail.data.order_id}</span> — “{detail.data.summary}” · detected {dayhhmm(detail.data.detected_at)} · evidence refs {detail.data.evidence_refs.map((r: any) => r.ref).join(', ')}
            </div>
          )}
          {act.busy === sel && <div className="animate-pulse text-sm text-teal-700">Agent is investigating via controlled tools…</div>}
          {sel && report && <RunReport r={report} approvals={detail.data?.approvals ?? []} escalations={detail.data?.escalations ?? []} />}
          {sel && !report && act.busy !== sel && detail.data && <div className="text-sm text-slate-400">Not investigated yet.</div>}
          {sel && (detail.data?.runs?.length ?? 0) > 1 && <div className="mt-3 text-xs text-slate-500">Earlier runs: {detail.data.runs.slice(1).map((r: any) => `${r.run_id} (${r.report?.outcome ?? r.status})`).join(', ')}</div>}
        </Card>
      </div>
    </div>
  );
}
