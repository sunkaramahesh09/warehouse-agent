import { useState } from 'react';
import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Card, ErrorBox, Json, PageHeader, hhmm } from '../components/ui';

const SWITCHES: Array<[key: string, label: string, help: string]> = [
  ['auto_detect', 'Auto-detect shortfalls', 'A recorded cycle count runs the deterministic detector, which raises INVENTORY_SHORTFALL exceptions for orders it makes unfulfillable.'],
  ['auto_investigate', 'Auto-investigate new exceptions', 'Detected exceptions are investigated immediately by the Exception Resolver (same guard, same tools). Approval-gated actions still wait for an Operator.'],
  ['auto_replan', 'Auto-replan on state changes', 'Holds, releases, cancellations, new orders, picker availability and inventory changes trigger ONE coalesced incremental replan.'],
];

export default function Events() {
  const meta = useApi<any>('/api/meta');
  const events = useApi<any[]>('/api/events');
  const inv = useApi<any[]>('/api/inventory');
  const act = useAction();
  const [sku, setSku] = useState('SKU-003');
  const [qty, setQty] = useState(12);
  const [last, setLast] = useState<any>(null);
  const isOp = getRole() === 'operator';
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

  return (
    <div className="space-y-4">
      <PageHeader title="Events & automation" subtitle="Every state change writes a domain event in the same transaction (outbox). The dispatcher routes events to automation handlers after each request. Automation reuses the guarded resolver and planner — it never approves anything." />
      <ErrorBox msg={act.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Automation switches (Operator)">
          <div className="space-y-3">
            {SWITCHES.map(([k, label, help]) => (
              <label key={k} className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4" disabled={!isOp} checked={!!(auto as any)[k]} onChange={(e) => toggle(k, e.target.checked)} />
                <span><span className="text-sm font-medium">{label}</span><span className="block text-xs text-slate-500">{help}</span></span>
              </label>
            ))}
          </div>
        </Card>
        <Card title="Ingest a cycle count (simulated event source)">
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col text-xs text-slate-500">SKU<select className="input" value={sku} onChange={(e) => setSku(e.target.value)}>{(inv.data ?? []).map((s) => <option key={s.sku}>{s.sku}</option>)}</select></label>
            <label className="flex flex-col text-xs text-slate-500">Location<select className="input" value={locId ?? ''} onChange={(e) => setLoc(e.target.value)}>{locs.map((l: any) => <option key={l.location_id}>{l.location_id}</option>)}</select></label>
            <label className="flex flex-col text-xs text-slate-500">Counted qty<input className="input w-24" type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></label>
            <button className="btn-primary" disabled={!isOp || !!act.busy || !locId} onClick={() => act.run('cc', async () => setLast(await api.post('/api/sim/cycle-count', { sku, location_id: locId, counted_qty: qty })))}>{act.busy === 'cc' ? 'Recording + dispatching…' : 'Record count'}</button>
          </div>
          {sys && <div className="mt-2 text-xs text-slate-500">System: on_hand {sys.on_hand}, reserved {sys.reserved}, available {sys.available}. Try SKU-003 @ B-01 = 12 (effective 7 → ORD-1002 and ORD-1016 become unfulfillable).</div>}
          {last && <div className="mt-2 text-xs">Recorded <span className="font-mono">{last.data?.count_id}</span>. See the dispatch results below, the new exceptions, and the plan version.</div>}
          <div className="mt-3"><button className="btn-secondary py-1" disabled={!isOp || !!act.busy} onClick={() => act.run('drain', () => api.post('/api/events/process'))}>Process pending events now</button></div>
        </Card>
      </div>
      <Card title={`Event log (${events.data?.length ?? 0})`}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>#</th><th>Sim</th><th>Type</th><th>Source</th><th>Payload</th><th>Status</th><th>Handled by</th><th>Result</th></tr></thead>
            <tbody>
              {(events.data ?? []).map((e) => (
                <tr key={e.event_id}>
                  <td className="mono text-slate-400">{e.event_id}</td>
                  <td className="mono">{hhmm(e.sim_time)}</td>
                  <td className="font-mono text-xs font-semibold">{e.type}</td>
                  <td className="mono text-slate-500">{e.source_tool}</td>
                  <td className="mono max-w-xs truncate" title={JSON.stringify(e.payload)}>{Object.entries(e.payload).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ')}</td>
                  <td><Badge v={e.status} /></td>
                  <td className="text-xs">{e.handled_by ?? '—'}</td>
                  <td><Json value={e.result} label="result" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
