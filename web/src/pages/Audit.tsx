import { Fragment, useState } from 'react';
import { useApi } from '../hooks';
import { Badge, Card, Json, PageHeader, hhmm } from '../components/ui';

const EVENTS = ['', 'RUN_STARTED', 'TOOL_CALL', 'DECISION', 'STATE_CHANGE', 'APPROVAL_REQUESTED', 'APPROVAL_DECISION', 'APPROVED_ACTION_EXECUTED', 'ESCALATION_CREATED', 'ESCALATION_RESOLVED', 'PLAN_CREATED', 'PLAN_CHANGE', 'DISPATCH_BLOCKED', 'SIM_CHANGE', 'TOOL_ERROR', 'TOOL_FAILURE', 'TOOL_REJECTED', 'DUPLICATE_SUPPRESSED', 'FAILURE', 'LLM_FALLBACK', 'RUN_REFUSED', 'RUN_COMPLETED', 'ENVIRONMENT_RESET'];

export default function Audit() {
  const [workflow, setWorkflow] = useState('');
  const [eventType, setEventType] = useState('');
  const [runId, setRunId] = useState('');
  const [reads, setReads] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const qs = new URLSearchParams({ limit: '400', include_reads: String(reads), ...(workflow && { workflow }), ...(eventType && { event_type: eventType }), ...(runId && { run_id: runId }) });
  const { data } = useApi<any[]>(`/api/audit?${qs}`);
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Sequence-ordered trail of every tool call, decision, approval, state change, escalation, plan change and failure. Inputs are sanitised (secret-looking keys redacted)."
        actions={<a className="btn-secondary" href="/api/audit/export.jsonl">Export JSONL</a>} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <select className="input" value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
            <option value="">All workflows</option>{['EXCEPTION_RESOLVER', 'SHIFT_PLANNER', 'OPERATOR', 'SCENARIO', 'SYSTEM'].map((w) => <option key={w}>{w}</option>)}
          </select>
          <select className="input" value={eventType} onChange={(e) => setEventType(e.target.value)}>{EVENTS.map((e) => <option key={e} value={e}>{e || 'All event types'}</option>)}</select>
          <input className="input w-44" placeholder="run id (RUN-…, PLN-…)" value={runId} onChange={(e) => setRunId(e.target.value.trim())} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={reads} onChange={(e) => setReads(e.target.checked)} /> include read tool calls</label>
          <span className="text-xs text-slate-400">{data?.length ?? 0} events</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>#</th><th>Sim time</th><th>Workflow</th><th>Run</th><th>Event</th><th>Tool</th><th>Decision / summary</th><th>Policy</th><th>Approval</th><th>Outcome</th></tr></thead>
            <tbody>
              {(data ?? []).map((e) => (
                <Fragment key={e.seq}>
                  <tr className="cursor-pointer" onClick={() => setOpen(open === e.seq ? null : e.seq)}>
                    <td className="mono text-slate-400">{e.seq}</td>
                    <td className="mono">{hhmm(e.sim_time)}</td>
                    <td className="text-xs">{e.workflow}</td>
                    <td className="mono text-slate-500"><button className="hover:underline" onClick={(ev) => { ev.stopPropagation(); setRunId(e.run_id ?? ''); }}>{e.run_id ?? '—'}</button></td>
                    <td><Badge v={e.event_type} /></td>
                    <td className="mono">{e.tool_name ?? '—'}</td>
                    <td className="max-w-md text-xs">{e.decision_summary ?? (e.error ? <span className="text-rose-700">{e.error.code}: {e.error.message}</span> : '')}</td>
                    <td className="mono">{(e.policy_refs ?? []).join(', ')}</td>
                    <td className="text-xs">{e.approval_state ?? ''}</td>
                    <td className="text-xs">{e.outcome}</td>
                  </tr>
                  {open === e.seq && (
                    <tr><td colSpan={10} className="bg-slate-50">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div><div className="text-xs font-semibold">input</div><Json value={e.input} collapsed={false} label="input" /></div>
                        <div><div className="text-xs font-semibold">{e.error ? 'error' : 'result'}</div><Json value={e.error ?? e.result} collapsed={false} label="result" /></div>
                        {e.state_changes && <div><div className="text-xs font-semibold">state changes</div><Json value={e.state_changes} collapsed={false} label="state changes" /></div>}
                        {e.proposed_action && <div><div className="text-xs font-semibold">proposed action</div><Json value={e.proposed_action} collapsed={false} label="proposal" /></div>}
                        <div className="text-xs text-slate-500">wall clock {e.ts} · actor {e.actor}</div>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
