import { Fragment, useState } from 'react';
import { ScrollText, Download, FilterX, ChevronRight, Layers, Activity, Hash, Link2, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { useApi } from '../hooks';
import { Badge, Chip, EmptyState, Json, LoadingState, PageHeader, Pagination, SearchInput, SectionCard, Select, hhmm, usePaged } from '../components/ui';

// Every event type the server writes (filter options only; the server query is unchanged).
const EVENTS = ['RUN_STARTED', 'TOOL_CALL', 'DECISION', 'STATE_CHANGE', 'EXCEPTION_UPDATED', 'APPROVAL_REQUESTED', 'APPROVAL_DECISION', 'APPROVED_ACTION_EXECUTED', 'ESCALATION_CREATED', 'ESCALATION_RESOLVED', 'PLAN_CREATED', 'PLAN_CHANGE', 'DISPATCH_BLOCKED', 'SIM_CHANGE', 'CONFIG_CHANGE', 'EXCEPTION_DETECTED', 'EVENT_PROCESSED', 'AUTO_REPLAN', 'TOOL_ERROR', 'TOOL_FAILURE', 'TOOL_REJECTED', 'DUPLICATE_SUPPRESSED', 'FAILURE', 'LLM_FALLBACK', 'RUN_REFUSED', 'RUN_COMPLETED', 'ENVIRONMENT_RESET'];
const WF_SHORT: Record<string, string> = { EXCEPTION_RESOLVER: 'RESOLVER', SHIFT_PLANNER: 'PLANNER' };
const WORKFLOW_TONE: Record<string, any> = { EXCEPTION_RESOLVER: 'violet', SHIFT_PLANNER: 'brand', OPERATOR: 'info', SCENARIO: 'warning', SYSTEM: 'neutral' };
const EVENT_TONE = (t: string): any => /FAIL|ERROR|REJECTED|REFUSED/.test(t) ? 'danger' : /STATE_CHANGE|EXECUTED|RESOLVED/.test(t) ? 'success' : /ESCALATION|FALLBACK|BLOCKED/.test(t) ? 'orange' : /APPROVAL/.test(t) ? 'fuchsia' : /PLAN|REPLAN/.test(t) ? 'brand' : /DUPLICATE/.test(t) ? 'warning' : 'info';
const outcomeIcon = (o?: string | null) => !o ? null : /FAIL|ERROR|REJECT|TIMEOUT|FORBIDDEN|INVALID|NOT_FOUND/.test(o) ? <XCircle className="h-3.5 w-3.5 text-rose-600" aria-hidden /> : /SKIPPED|DUPLICATE|NO_CHANGE/.test(o) ? <MinusCircle className="h-3.5 w-3.5 text-slate-400" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;

export default function Audit() {
  const [workflow, setWorkflow] = useState('');
  const [eventType, setEventType] = useState('');
  const [runId, setRunId] = useState('');
  const [reads, setReads] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [q, setQ] = useState('');
  // Unchanged server query.
  const qs = new URLSearchParams({ limit: '400', include_reads: String(reads), ...(workflow && { workflow }), ...(eventType && { event_type: eventType }), ...(runId && { run_id: runId }) });
  const { data, error } = useApi<any[]>(`/api/audit?${qs}`);
  const rows = (data ?? []).filter((e) => !q || [e.seq, e.tool_name, e.decision_summary, e.outcome, e.actor, (e.policy_refs ?? []).join(' '), e.error?.code].join(' ').toLowerCase().includes(q.toLowerCase()));
  const paged = usePaged(rows, 25);
  const clear = () => { setWorkflow(''); setEventType(''); setRunId(''); setReads(true); setQ(''); };
  const filtered = workflow || eventType || runId || !reads || q;

  return (
    <div className="space-y-5">
      <PageHeader art="audit" icon={ScrollText} crumb="Audit Log" title="Audit Log"
        subtitle="Sequence-ordered trail of every tool call, decision, approval, state change, escalation, plan change and failure. Inputs are sanitised (secret-looking keys redacted)."
        actions={<a className="btn-secondary" href="/api/audit/export.jsonl"><Download className="h-4 w-4" aria-hidden />Export JSONL</a>} />

      <div className="card p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.3fr]">
          <Select label="Workflow" hideLabel={false} value={workflow} onChange={setWorkflow} options={[{ value: '', label: 'All workflows' }, ...['EXCEPTION_RESOLVER', 'SHIFT_PLANNER', 'OPERATOR', 'SCENARIO', 'SYSTEM'].map((w) => ({ value: w, label: w }))]} />
          <Select label="Event type" hideLabel={false} value={eventType} onChange={setEventType} options={[{ value: '', label: 'All event types' }, ...EVENTS.map((e) => ({ value: e, label: e }))]} />
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Run id</span>
            <input className="input w-full font-mono" placeholder="RUN-…, PLN-…, OPR-…" value={runId} onChange={(e) => setRunId(e.target.value.trim())} />
          </label>
          <div><span className="mb-1 block text-xs font-medium text-slate-500">Search loaded events</span><SearchInput value={q} onChange={setQ} placeholder="Tool, summary, policy, outcome…" /></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-teal-700" checked={reads} onChange={(e) => setReads(e.target.checked)} />Include read tool calls</label>
          <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800 ring-1 ring-teal-100">{rows.length} events{data && data.length >= 400 ? ' (latest 400)' : ''}</span>
          {filtered && <button className="btn-ghost btn-sm" onClick={clear}><FilterX className="h-3.5 w-3.5" aria-hidden />Clear filters</button>}
          {runId && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Link2 className="h-3.5 w-3.5" aria-hidden />showing one run: <span className="font-mono text-navy">{runId}</span></span>}
        </div>
      </div>

      <SectionCard icon={Activity} title="Event trail" subtitle="Newest first · click a row for input, result, state changes and proposal · click a run id to follow that run" bodyClassName="p-0">
        {!data ? <div className="p-5">{error ? <div className="text-sm text-rose-700">Could not load the audit log: {error}</div> : <LoadingState label="Loading audit log…" rows={6} />}</div> : rows.length === 0 ? (
          <EmptyState illustration="search" title="No audit events match" action={filtered ? <button className="btn-secondary" onClick={clear}>Clear filters</button> : undefined}>Every tool call and state change is recorded here as it happens.</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tbl [&_td]:px-2.5 [&_th]:px-2.5">
                <thead><tr><th className="w-6" /><th><span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" aria-hidden />Seq</span></th><th>Sim time</th><th><span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" aria-hidden />Workflow</span></th><th>Run</th><th>Event</th><th>Tool</th><th>Decision / summary</th><th>Policy</th><th>Outcome · approval</th></tr></thead>
                <tbody>
                  {paged.slice.map((e) => {
                    const isOpen = open === e.seq;
                    return (
                      <Fragment key={e.seq}>
                        <tr className="cursor-pointer" onClick={() => setOpen(isOpen ? null : e.seq)}>
                          <td className="pr-0"><button className="rounded p-0.5 text-slate-400 hover:text-navy" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} event ${e.seq}`} onClick={(ev) => { ev.stopPropagation(); setOpen(isOpen ? null : e.seq); }}><ChevronRight className={`h-4 w-4 transition ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                          <td className="font-mono text-xs font-semibold text-slate-500">{e.seq}</td>
                          <td className="whitespace-nowrap font-mono text-xs">{hhmm(e.sim_time)}</td>
                          <td><Badge v={WF_SHORT[e.workflow] ?? e.workflow} title={e.workflow} tone={WORKFLOW_TONE[e.workflow] ?? 'neutral'} /></td>
                          <td className="whitespace-nowrap">{e.run_id ? <button className="rounded font-mono text-xs text-teal-700 hover:underline" onClick={(ev) => { ev.stopPropagation(); setRunId(e.run_id ?? ''); }} title="Show only this run">{e.run_id}</button> : <span className="text-slate-400">—</span>}</td>
                          <td className="max-w-[9rem]"><Badge wrap v={e.event_type} tone={EVENT_TONE(e.event_type)} /></td>
                          <td className="max-w-[9rem]">{e.tool_name ? <span className="break-words font-mono text-[11px] text-navy [overflow-wrap:anywhere]">{e.tool_name}</span> : <span className="text-slate-400">—</span>}</td>
                          <td className="min-w-[12rem] text-xs">{e.decision_summary ?? (e.error ? <span className="text-rose-700">{e.error.code}: {e.error.message}</span> : <span className="text-slate-400">—</span>)}</td>
                          <td><div className="flex flex-col items-start gap-1">{(e.policy_refs ?? []).map((p: string) => <Chip key={p} tone="brand">{p}</Chip>)}</div></td>
                          <td className="max-w-[8rem] text-xs"><span className="inline-flex items-start gap-1 [overflow-wrap:anywhere]">{outcomeIcon(e.outcome)}{e.outcome ?? <span className="text-slate-400">—</span>}</span>{e.approval_state && <div className="mt-1"><Badge v={e.approval_state} /></div>}</td>
                        </tr>
                        {isOpen && (
                          <tr><td colSpan={10} className="bg-slate-50/80">
                            <div className="grid gap-4 py-1 pl-6 md:grid-cols-2">
                              <div><div className="label-xs mb-1">Input</div><Json value={e.input} collapsed={false} label="input" /></div>
                              <div><div className="label-xs mb-1">{e.error ? 'Error' : 'Result'}</div><Json value={e.error ?? e.result} collapsed={false} label="result" /></div>
                              {e.state_changes && <div><div className="label-xs mb-1">State changes</div><Json value={e.state_changes} collapsed={false} label="state changes" /></div>}
                              {e.proposed_action && <div><div className="label-xs mb-1">Proposed action</div><Json value={e.proposed_action} collapsed={false} label="proposal" /></div>}
                              <div className="text-xs text-slate-500">wall clock <span className="font-mono">{e.ts}</span> · actor <b className="text-navy">{e.actor}</b></div>
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination {...paged} noun="events" />
          </>
        )}
      </SectionCard>
    </div>
  );
}
