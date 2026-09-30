import { useEffect, useState } from 'react';
import {
  TriangleAlert, Search as SearchIcon, FileClock, MessageSquareWarning, CheckCircle2, Layers, Boxes, Copy, RefreshCw, FileWarning, Truck, MapPin,
  ClipboardList, Microscope, Play, RotateCw, Info, History,
} from 'lucide-react';
import { api } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Callout, EmptyState, ErrorBox, LoadingState, PageHeader, ProgressNote, SearchInput, SectionCard, Select, Spinner, StatCard, dayhhmm, type Icon } from '../components/ui';
import RunReport from '../components/RunReport';

// Demo guidance for the seeded exceptions (unchanged text from the original UI).
const hint: Record<string, string> = {
  'EXC-2001': 'shortfall → hold (planner impact)', 'EXC-2002': 'duplicate → approval-gated cancel', 'EXC-2003': 'recoverable desync → autonomous',
  'EXC-2004': 'contradictory → escalation', 'EXC-2005': 'invalid data', 'EXC-2006': 'stale shipment', 'EXC-2007': 'ambiguous conflict',
};
const TYPE: Record<string, { icon: Icon; tile: string; label: string; desc: string }> = {
  INVENTORY_SHORTFALL: { icon: Boxes, tile: 'bg-rose-50 text-rose-600', label: 'Inventory shortfall', desc: 'Confirmed stock below the order quantity' },
  DUPLICATE_ORDER: { icon: Copy, tile: 'bg-violet-50 text-violet-600', label: 'Duplicate order', desc: 'Same customer, destination, lines, 30-min window' },
  STATUS_DESYNC: { icon: RefreshCw, tile: 'bg-sky-50 text-sky-600', label: 'Status desync', desc: 'Order status vs carrier scan evidence' },
  INVALID_DATA: { icon: FileWarning, tile: 'bg-emerald-50 text-emerald-600', label: 'Invalid data', desc: 'Impossible quantities or timestamps' },
  STALE_SHIPMENT: { icon: Truck, tile: 'bg-amber-50 text-amber-600', label: 'Stale shipment', desc: 'Label created, no carrier scan > 48 h' },
  DESTINATION_CONFLICT: { icon: MapPin, tile: 'bg-fuchsia-50 text-fuchsia-600', label: 'Destination conflict', desc: 'Shipment addressed to a different order' },
};
const HANDLED = ['RESOLVED', 'CLOSED', 'AWAITING_APPROVAL', 'ESCALATED'];
const hoursAgo = (from: string, now?: string) => (now ? Math.max(0, Math.round((new Date(now).getTime() - new Date(from).getTime()) / 36e5)) : null);

export default function Exceptions() {
  const list = useApi<any[]>('/api/exceptions');
  const meta = useApi<any>('/api/meta');
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<'auto' | 'deterministic' | 'llm'>('auto');
  const detail = useApi<any>(sel ? `/api/exceptions/${sel}` : null);
  const act = useAction();
  const [fresh, setFresh] = useState<any>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');

  useEffect(() => { setFresh(null); act.setError(null); }, [sel]);
  // Unchanged: POST /api/exceptions/:id/investigate {mode} → full resolver pipeline on the server.
  const investigate = (id: string) => act.run(id, async () => { setSel(id); const r = await api.post(`/api/exceptions/${id}/investigate`, { mode }); setFresh(r); });
  const report = fresh?.exception_id === sel ? fresh : detail.data?.runs?.[0]?.report;
  const llmOn = meta.data?.llm?.configured;
  const simNow = meta.data?.sim?.sim_now;

  const all = list.data ?? [];
  const rows = all.filter((e) => (!status || e.status === status) && (!type || e.type === type) &&
    (!q || [e.exception_id, e.order_id, e.type, e.summary].join(' ').toLowerCase().includes(q.toLowerCase())));
  const by = (s: string) => all.filter((e) => e.status === s).length;
  const types = [...new Set(all.map((e) => e.type))];

  return (
    <div className="space-y-5">
      <PageHeader icon={TriangleAlert} crumb="Exceptions" illustration="warehouse" title="Exceptions"
        subtitle="Investigate runs the Exception Resolver: read-only tool calls → evidence → shared SOP → guarded decision → controlled action or escalation."
        actions={<Select label="Agent mode" hideLabel={false} className="w-56" value={mode} onChange={(v) => setMode(v as any)} options={[
          { value: 'auto', label: `auto (${llmOn ? 'LLM' : 'deterministic'})` }, { value: 'deterministic', label: 'deterministic' }, { value: 'llm', label: `LLM${llmOn ? '' : ' (no key)'}`, disabled: !llmOn },
        ]} />} />
      {act.error && <ErrorBox operation={`Investigation of ${sel ?? 'exception'}`} msg={act.error} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={TriangleAlert} tone="rose" label="Open" value={by('OPEN')} active={status === 'OPEN'} />
        <StatCard icon={SearchIcon} tone="sky" label="Investigating" value={by('INVESTIGATING')} />
        <StatCard icon={FileClock} tone="fuchsia" label="Awaiting approval" value={by('AWAITING_APPROVAL')} />
        <StatCard icon={MessageSquareWarning} tone="orange" label="Escalated" value={by('ESCALATED')} />
        <StatCard icon={CheckCircle2} tone="emerald" label="Resolved / closed" value={by('RESOLVED') + by('CLOSED')} hint={by('FAILED') ? `${by('FAILED')} failed — retry available` : undefined} />
        <StatCard icon={Layers} tone="teal" label="Exception types" value={types.length} />
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <SearchInput className="min-w-56 flex-1" value={q} onChange={setQ} placeholder="Search exception id, order, type, summary…" />
        <Select label="Status" className="w-48" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...['OPEN', 'INVESTIGATING', 'AWAITING_APPROVAL', 'ESCALATED', 'RESOLVED', 'FAILED', 'CLOSED'].map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))]} />
        <Select label="Type" className="w-52" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...Object.entries(TYPE).map(([k, t]) => ({ value: k, label: t.label }))]} />
      </div>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <SectionCard icon={ClipboardList} title="Exception queue" subtitle={`${rows.length} of ${all.length} · click a row to open it`} bodyClassName="p-2">
          {!list.data ? <div className="p-3"><LoadingState label="Loading exceptions…" /></div> : rows.length === 0 ? <EmptyState illustration="check" title="No exceptions match">Clear the filters to see the full queue.</EmptyState> : (
            <ul className="space-y-1">
              {rows.map((e) => {
                const t = TYPE[e.type] ?? { icon: TriangleAlert, tile: 'bg-slate-100 text-slate-600', label: e.type, desc: '' };
                const selected = sel === e.exception_id;
                const handled = HANDLED.includes(e.status);
                const h = hoursAgo(e.detected_at, simNow);
                return (
                  <li key={e.exception_id}>
                    <div className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${selected ? 'border-teal-300 bg-teal-50/60 ring-1 ring-teal-200' : 'border-transparent hover:border-line hover:bg-slate-50'}`}
                      onClick={() => setSel(e.exception_id)} onKeyDown={(ev) => { if (ev.key === 'Enter') setSel(e.exception_id); }} tabIndex={0} role="button" aria-pressed={selected} aria-label={`Open ${e.exception_id}`}>
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${t.tile}`}><t.icon className="h-5 w-5" aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-[13px] font-bold text-navy">{e.exception_id}</span>
                          <span className="font-mono text-xs text-slate-500">· {e.order_id}</span>
                          <Badge v={e.status} />
                          {e.last_run && <Badge v={e.last_run.outcome} />}
                        </div>
                        <div className="text-[13px] font-semibold text-navy">{t.label}</div>
                        <div className="line-clamp-2 text-xs text-slate-500">{e.summary}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
                          <span>{h !== null ? `${h < 1 ? '<1' : h}h ago · ` : ''}{dayhhmm(e.detected_at)}</span>
                          {hint[e.exception_id] && <span className="text-teal-700">demo: {hint[e.exception_id]}</span>}
                          {e.last_run?.policies?.length > 0 && <span className="font-mono">{e.last_run.policies.map((p: any) => p.policy_id).join(', ')}</span>}
                        </div>
                      </div>
                      <button className="btn-primary btn-sm shrink-0" disabled={!!act.busy || handled}
                        title={handled ? `Already ${e.status.replace(/_/g, ' ').toLowerCase()} — re-running would duplicate side effects` : undefined}
                        onClick={(ev) => { ev.stopPropagation(); investigate(e.exception_id); }}>
                        {act.busy === e.exception_id ? <Spinner className="h-3.5 w-3.5" /> : e.status === 'FAILED' ? <RotateCw className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                        {act.busy === e.exception_id ? 'Investigating…' : e.status === 'FAILED' ? 'Retry' : 'Investigate'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard icon={Microscope} title={sel ? <>Investigation · <span className="font-mono">{sel}</span></> : 'Investigation detail'}
            actions={sel && report ? <a className="btn-ghost btn-sm" href="#/audit">Audit log</a> : undefined}>
            {!sel && (
              <div>
                <EmptyState illustration="search" title="Select an exception to investigate">
                  <ul className="mx-auto mt-1 max-w-sm list-disc space-y-0.5 pl-5 text-left">
                    <li>Read relevant records through controlled, read-only tools</li>
                    <li>Gather evidence and cite the shared SOP</li>
                    <li>Propose a decision that the policy guard validates</li>
                    <li>Execute a permitted action, request approval, or escalate</li>
                  </ul>
                </EmptyState>
                <Callout tone="info" icon={Info}>The model never writes to the database. Every action goes through validated tools with idempotency and a full audit trail.</Callout>
              </div>
            )}
            {sel && detail.data && (
              <div className="mb-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-line">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge v={detail.data.type} tone="brand" /><span>on <b className="font-mono text-navy">{detail.data.order_id}</b></span>
                  <span>detected <b className="font-mono">{dayhhmm(detail.data.detected_at)}</b></span>
                  <span>evidence refs <b className="font-mono">{detail.data.evidence_refs.map((r: any) => r.ref).join(', ')}</b></span>
                </div>
                <p className="mt-1.5 text-[13px] text-slate-700">“{detail.data.summary}”</p>
              </div>
            )}
            {act.busy === sel && <ProgressNote>Agent is investigating {sel} through controlled tools… (LLM runs can take 10–40 s)</ProgressNote>}
            {sel && !detail.data && act.busy !== sel && <LoadingState label="Loading exception…" rows={3} />}
            {sel && report && act.busy !== sel && <RunReport r={report} approvals={detail.data?.approvals ?? []} escalations={detail.data?.escalations ?? []} />}
            {sel && !report && act.busy !== sel && detail.data && (
              <EmptyState compact illustration="search" title="Not investigated yet" action={
                <button className="btn-primary" disabled={!!act.busy || HANDLED.includes(detail.data.status)} onClick={() => investigate(sel)}><Play className="h-4 w-4" aria-hidden />Investigate {sel}</button>
              }>Run the resolver to gather evidence and reach a guarded decision.</EmptyState>
            )}
            {sel && (detail.data?.runs?.length ?? 0) > 1 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-slate-500">
                <History className="h-3.5 w-3.5" aria-hidden />Earlier runs: {detail.data.runs.slice(1).map((r: any) => <span key={r.run_id} className="font-mono">{r.run_id} ({r.report?.outcome ?? r.status})</span>)}
              </div>
            )}
          </SectionCard>

          {!sel && (
            <SectionCard icon={Layers} title="Exception types (seeded)">
              <ul className="grid gap-2 sm:grid-cols-2">
                {Object.entries(TYPE).map(([k, t]) => (
                  <li key={k} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${t.tile}`}><t.icon className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0"><span className="block text-[13px] font-semibold text-navy">{t.label}</span><span className="block text-xs text-slate-500">{t.desc}</span></span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
