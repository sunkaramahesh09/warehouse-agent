import { useState } from 'react';
import { Zap, Database, CircleCheck, CircleSlash, Hourglass, Settings2, ScanLine, Play, Info, ListTree, ArrowRight } from 'lucide-react';
import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Callout, Chip, EmptyState, ErrorBox, Json, LoadingState, PageHeader, ProgressNote, SearchInput, SectionCard, Select, Spinner, StatCard, Toggle, hhmm, usePaged, Pagination } from '../components/ui';

// Real event types consumed by each automation (server/src/events/dispatcher.ts).
const SWITCHES: Array<[key: string, label: string, help: string, triggers: string[], produces: string]> = [
  ['auto_detect', 'Auto-detect shortfalls', 'A recorded cycle count runs the deterministic detector, which raises INVENTORY_SHORTFALL exceptions for orders it makes unfulfillable.', ['CYCLE_COUNT_RECORDED'], 'EXCEPTION_DETECTED'],
  ['auto_investigate', 'Auto-investigate new exceptions', 'Detected exceptions are investigated immediately by the Exception Resolver (same guard, same tools). Approval-gated actions still wait for an Operator.', ['EXCEPTION_DETECTED'], 'resolver run (hold / escalation / approval request)'],
  ['auto_replan', 'Auto-replan on state changes', 'Holds, releases, cancellations, new orders, picker availability and inventory changes trigger ONE coalesced incremental replan.', ['ORDER_HELD', 'ORDER_RELEASED', 'ORDER_CANCELLED', 'ORDER_CREATED', 'PICKER_AVAILABILITY_CHANGED', 'INVENTORY_CHANGED'], 'new plan version'],
];

export default function Events() {
  const meta = useApi<any>('/api/meta');
  const events = useApi<any[]>('/api/events');
  const inv = useApi<any[]>('/api/inventory');
  const act = useAction();
  const [sku, setSku] = useState('SKU-003');
  const [qty, setQty] = useState(12);
  const [last, setLast] = useState<any>(null);
  const [q, setQ] = useState('');
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSource, setFSource] = useState('');
  const isOp = getRole() === 'operator';
  // Unchanged: optimistic switch + POST /api/automation, reverted if the request fails.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const auto = { ...(meta.data?.sim?.automation ?? {}), ...optimistic };
  const toggle = (k: string, on: boolean) => {
    setOptimistic((o) => ({ ...o, [k]: on }));
    act.run(k, () => api.post('/api/automation', { [k]: on })).then((r) => { if (r === undefined) setOptimistic((o) => { const n = { ...o }; delete n[k]; return n; }); });
  };
  const locs = (inv.data ?? []).find((s) => s.sku === sku)?.locations ?? [];
  const [loc, setLoc] = useState('B-01');
  const locId = locs.some((l: any) => l.location_id === loc) ? loc : locs[0]?.location_id;
  const sys = locs.find((l: any) => l.location_id === locId);

  const E = events.data ?? [];
  const count = (s: string) => E.filter((e) => e.status === s).length;
  const types = [...new Set(E.map((e) => e.type))].sort();
  const sources = [...new Set(E.map((e) => e.source_tool))].sort();
  const rows = E.filter((e) => (!fType || e.type === fType) && (!fStatus || e.status === fStatus) && (!fSource || e.source_tool === fSource) &&
    (!q || `${e.event_id} ${e.type} ${e.source_tool} ${JSON.stringify(e.payload)} ${e.handled_by ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const paged = usePaged(rows, 20);
  const onCount = SWITCHES.filter(([k]) => (auto as any)[k]).length;

  return (
    <div className="space-y-5">
      <PageHeader photo="events" icon={Zap} crumb="Events & Automation" title="Events & Automation"
        subtitle="Every state change writes a domain event in the same transaction (outbox). The dispatcher routes events to automation handlers after each request. Automation reuses the guarded resolver and planner — it never approves anything." />
      {act.error && <ErrorBox operation={act.busy === 'cc' ? 'Record cycle count' : 'Automation request'} msg={act.error} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={Database} tone="teal" label="Events in log" value={E.length} hint="Current environment" />
        <StatCard icon={CircleCheck} tone="emerald" label="Processed" value={count('PROCESSED')} />
        <StatCard icon={CircleSlash} tone="slate" label="Skipped" value={count('SKIPPED')} hint="Automation off / informational" />
        <StatCard icon={Hourglass} tone={count('PENDING') || count('FAILED') ? 'amber' : 'slate'} label="Pending / failed" value={`${count('PENDING')} / ${count('FAILED')}`} />
        <StatCard icon={Settings2} tone="violet" label="Automation switches on" value={`${onCount} / ${SWITCHES.length}`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <SectionCard icon={Settings2} title="Automation switches (Operator)" subtitle="Each switch routes real domain events to an existing, guarded workflow" bodyClassName="divide-y divide-slate-100 px-5">
          {SWITCHES.map(([k, label, help, triggers, produces]) => {
            const on = !!(auto as any)[k];
            return (
              <div key={k} className="flex flex-wrap items-start gap-4 py-4">
                <Toggle checked={on} onChange={(v) => toggle(k, v)} disabled={!isOp} label={label} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-navy">{label}<Badge v={on ? 'ON' : 'OFF'} tone={on ? 'success' : 'muted'} /></div>
                  <p className="mt-0.5 text-[13px] text-slate-500">{help}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-semibold uppercase tracking-wide text-slate-400">Triggers</span>
                    {triggers.map((t) => <Chip key={t} tone="brand">{t}</Chip>)}
                    <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden />
                    <span className="text-slate-500">{produces}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {!isOp && <div className="py-3 text-xs text-slate-500">Operator role required to change switches.</div>}
        </SectionCard>

        <SectionCard icon={ScanLine} title="Ingest a cycle count" subtitle="Simulated event source → CYCLE_COUNT_RECORDED">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Select label="SKU" hideLabel={false} value={sku} onChange={setSku} options={(inv.data ?? []).map((s) => ({ value: s.sku, label: s.sku }))} />
            <Select label="Location" hideLabel={false} value={locId ?? ''} onChange={setLoc} options={locs.map((l: any) => ({ value: l.location_id, label: l.location_id }))} />
            <label className="col-span-2 block sm:col-span-1"><span className="mb-1 block text-xs font-medium text-slate-500">Counted qty</span>
              <input className="input w-full" type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </label>
          </div>
          {sys && <div className="mt-3"><Callout tone="info" icon={Info}>System: on_hand <b>{sys.on_hand}</b>, reserved <b>{sys.reserved}</b>, available <b>{sys.available}</b>. Try <b>SKU-003 @ B-01 = 12</b> (effective 7 → ORD-1002 and ORD-1016 become unfulfillable).</Callout></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!isOp || !!act.busy || !locId} onClick={() => act.run('cc', async () => setLast(await api.post('/api/sim/cycle-count', { sku, location_id: locId, counted_qty: qty })))}>
              {act.busy === 'cc' ? <Spinner /> : <ScanLine className="h-4 w-4" aria-hidden />}{act.busy === 'cc' ? 'Recording + dispatching…' : 'Record count'}
            </button>
            <button className="btn-secondary" disabled={!isOp || !!act.busy} onClick={() => act.run('drain', () => api.post('/api/events/process'))}>
              {act.busy === 'drain' ? <Spinner /> : <Play className="h-4 w-4" aria-hidden />}Process pending events now
            </button>
          </div>
          {act.busy === 'cc' && <div className="mt-3"><ProgressNote>Recording the count and dispatching events (detection → investigation → replan if enabled)…</ProgressNote></div>}
          {last && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200" role="status">Recorded <span className="font-mono font-semibold">{last.data?.count_id}</span>. See the dispatch results in the event log, the new exceptions, and the plan version.</div>}
        </SectionCard>
      </div>

      <SectionCard icon={ListTree} title={`Event log (${E.length})`} subtitle="Newest first · every event ends PROCESSED, SKIPPED (with reason) or FAILED" bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput className="min-w-52 flex-1" value={q} onChange={setQ} placeholder="Search events, payload, handler…" />
          <Select label="Type" className="w-56" value={fType} onChange={setFType} options={[{ value: '', label: 'All types' }, ...types.map((t) => ({ value: t, label: t }))]} />
          <Select label="Source" className="w-56" value={fSource} onChange={setFSource} options={[{ value: '', label: 'All sources' }, ...sources.map((t) => ({ value: t, label: t }))]} />
          <Select label="Status" className="w-40" value={fStatus} onChange={setFStatus} options={[{ value: '', label: 'All statuses' }, ...['PENDING', 'PROCESSED', 'SKIPPED', 'FAILED'].map((t) => ({ value: t, label: t }))]} />
        </div>
        {!events.data ? <div className="p-5"><LoadingState label="Loading events…" /></div> : rows.length === 0 ? (
          <EmptyState illustration="conveyor" title={E.length ? 'No events match these filters' : 'No events yet'}>{E.length ? 'Clear the filters to see all events.' : 'Events appear when you take actions that change state, record a cycle count, or process pending events.'}</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>#</th><th>Sim</th><th>Type</th><th>Source</th><th>Payload</th><th>Status</th><th>Handled by</th><th>Result</th></tr></thead>
                <tbody>
                  {paged.slice.map((e) => (
                    <tr key={e.event_id}>
                      <td className="font-mono text-xs text-slate-400">{e.event_id}</td>
                      <td className="font-mono text-xs">{hhmm(e.sim_time)}</td>
                      <td className="whitespace-nowrap font-mono text-xs font-bold text-navy">{e.type}</td>
                      <td><Chip>{e.source_tool}</Chip></td>
                      <td className="max-w-[16rem] truncate font-mono text-xs text-slate-600" title={JSON.stringify(e.payload)}>{Object.entries(e.payload).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ')}</td>
                      <td><Badge v={e.status} dot /></td>
                      <td className="text-xs">{e.handled_by ?? '—'}</td>
                      <td><Json value={e.result} label="result" /></td>
                    </tr>
                  ))}
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
