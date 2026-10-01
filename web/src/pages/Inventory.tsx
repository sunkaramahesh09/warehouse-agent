import { useMemo, useState } from 'react';
import { Boxes, Package, MapPin, Scale, TriangleAlert, Truck, Snowflake, Weight, Warehouse } from 'lucide-react';
import { useApi } from '../hooks';
import { Badge, Chip, EmptyState, LoadingState, Meter, PageHeader, SearchInput, SectionCard, Segmented, Select, StatCard, dayhhmm } from '../components/ui';

const hoursBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 36e5);

export default function Inventory() {
  const inv = useApi<any[]>('/api/inventory');
  const ships = useApi<any[]>('/api/shipments');
  const orders = useApi<any[]>('/api/orders');
  const meta = useApi<any>('/api/meta');
  const [view, setView] = useState<'inventory' | 'shipments'>('inventory');
  const [q, setQ] = useState('');
  const [zone, setZone] = useState('');
  const [state, setState] = useState('');
  const simNow: string | undefined = meta.data?.sim?.sim_now;

  // Open demand = remaining (requested − picked) quantity on PENDING / PICKING orders. Display-only comparison
  // against the backend's effective_available; no stock value is recalculated here.
  const demand = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders.data ?? []) {
      if (!['PENDING', 'PICKING'].includes(o.status)) continue;
      for (const l of o.lines) if (l.requested_qty > l.picked_qty) m.set(l.sku, (m.get(l.sku) ?? 0) + (l.requested_qty - l.picked_qty));
    }
    return m;
  }, [orders.data]);

  const skus = inv.data ?? [];
  const zones = [...new Set(skus.flatMap((s) => s.locations.map((l: any) => l.zone)))].sort();
  const isShort = (s: any) => (demand.get(s.sku) ?? 0) > s.availability.effective_available;
  const rows = skus.filter((s) => {
    if (zone && !s.locations.some((l: any) => l.zone === zone)) return false;
    if (state === 'conflict' && !s.availability.count_supersedes_system) return false;
    if (state === 'short' && !isShort(s)) return false;
    if (state === 'skill' && !s.required_skill) return false;
    if (q && ![s.sku, s.description, ...s.locations.map((l: any) => l.location_id)].join(' ').toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const shipRows = (ships.data ?? []).filter((s) => !q || [s.shipment_id, s.order_id, s.carrier, s.tracking_ref, s.destination_ref].join(' ').toLowerCase().includes(q.toLowerCase()));
  const locCount = skus.reduce((n, s) => n + s.locations.length, 0);

  return (
    <div className="space-y-5">
      <PageHeader art="inventory" icon={Boxes} crumb="Inventory & Shipments" title="Inventory & Shipments"
        subtitle={<>Available = on_hand − reserved (generated column). A newer, lower cycle count supersedes system on_hand for exception decisions (<span className="font-mono text-teal-800">SOP-SOT-001</span>).</>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Package} tone="sky" label="SKUs" value={skus.length} hint={`${zones.length} zones`} />
        <StatCard icon={MapPin} tone="teal" label="Stock locations" value={locCount} />
        <StatCard icon={Scale} tone="rose" label="Count newer than system" value={skus.filter((s) => s.availability.count_supersedes_system).length} hint="Cycle count supersedes on_hand" />
        <StatCard icon={TriangleAlert} tone="amber" label="Short vs open demand" value={orders.data ? skus.filter(isShort).length : '…'} hint="Effective available < pending demand" />
        <StatCard icon={Truck} tone="violet" label="Shipments" value={ships.data?.length ?? '…'} />
        <StatCard icon={Truck} tone="slate" label="Awaiting carrier pickup" value={(ships.data ?? []).filter((s) => !s.picked_up_at).length} hint="No pickup scan yet" />
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <SearchInput className="min-w-56 flex-1" value={q} onChange={setQ} placeholder={view === 'inventory' ? 'Search SKU, description, location…' : 'Search shipment, order, carrier, destination…'} />
        {view === 'inventory' && <>
          <Select label="Zone" className="w-36" value={zone} onChange={setZone} options={[{ value: '', label: 'All zones' }, ...zones.map((z) => ({ value: z, label: `Zone ${z}` }))]} />
          <Select label="Stock state" className="w-52" value={state} onChange={setState} options={[{ value: '', label: 'All stock states' }, { value: 'short', label: 'Short vs open demand' }, { value: 'conflict', label: 'Count newer than system' }, { value: 'skill', label: 'Needs special skill' }]} />
        </>}
        <div className="ml-auto"><Segmented label="View" value={view} onChange={setView} options={[{ value: 'inventory', label: 'Inventory', icon: Warehouse }, { value: 'shipments', label: 'Shipments', icon: Truck }]} /></div>
      </div>

      {view === 'inventory' ? (
        <SectionCard icon={Boxes} title="Inventory by SKU" subtitle={`Showing ${rows.length} of ${skus.length} SKUs · stock bar = effective available ÷ system on_hand`} bodyClassName="p-0">
          {!inv.data ? <div className="p-5"><LoadingState label="Loading inventory…" /></div> : rows.length === 0 ? <EmptyState illustration="search" title="No SKUs match these filters" /> : (
            <div className="overflow-x-auto">
              <table className="tbl [&_td]:px-2.5 [&_th]:px-2.5">
                <thead><tr><th>SKU</th><th>Description</th><th>Locations</th><th className="text-right" title="Pick minutes per unit">Min/u</th><th className="text-right">On hand / reserved</th><th className="text-right">Available</th><th>Stock level</th><th>Last cycle count</th><th className="text-right">Open demand</th><th>Effective available</th></tr></thead>
                <tbody>
                  {rows.map((s) => {
                    const a = s.availability;
                    const d = demand.get(s.sku) ?? 0;
                    const short = isShort(s);
                    const onHand = a.system_on_hand;
                    return (
                      <tr key={s.sku}>
                        <td className="whitespace-nowrap font-mono font-bold text-navy">{s.sku}</td>
                        <td className="min-w-[7rem]">{s.description}{s.required_skill && <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle"><Badge v={s.required_skill} />{s.required_skill === 'COLD' ? <Snowflake className="h-3.5 w-3.5 text-sky-500" aria-hidden /> : <Weight className="h-3.5 w-3.5 text-violet-500" aria-hidden />}</span>}</td>
                        <td><div className="flex flex-wrap gap-1">{s.locations.map((l: any) => <Chip key={l.location_id} tone="info" title={`zone ${l.zone} · updated ${dayhhmm(l.last_updated)}`}>{l.location_id}</Chip>)}</div></td>
                        <td className="text-right tabular-nums">{s.pick_minutes_per_unit}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{onHand} <span className="text-slate-400">/ {s.locations.reduce((n: number, l: any) => n + l.reserved, 0)}</span></td>
                        <td className="text-right font-semibold tabular-nums text-emerald-700">{a.system_available}</td>
                        <td><Meter value={a.effective_available} max={onHand} tone={a.count_supersedes_system ? 'rose' : a.effective_available / Math.max(1, onHand) < 0.5 ? 'amber' : 'teal'} label={`${s.sku} effective available ${a.effective_available} of on hand ${onHand}`} /></td>
                        <td className="whitespace-nowrap">{a.latest_count ? <><div className="font-mono text-xs text-navy">{a.latest_count.count_id}</div><div className="font-mono text-[11px] text-slate-500">{a.latest_count.counted_qty} @ {dayhhmm(a.latest_count.counted_at)}</div></> : <span className="text-slate-400">—</span>}</td>
                        <td className={`text-right tabular-nums ${short ? 'font-semibold text-amber-700' : ''}`}>{orders.data ? d : '…'}</td>
                        <td className="min-w-[6.5rem]">
                          <span className={`text-base font-bold tabular-nums ${a.count_supersedes_system ? 'text-rose-700' : 'text-navy'}`}>{a.effective_available}</span>
                          {a.count_supersedes_system && <div className="text-[11px] leading-snug text-rose-600">count ({a.latest_count.counted_qty}) newer than system ({a.system_on_hand})</div>}
                          {short && <div className="mt-0.5"><Badge v="SHORT" tone="warning" title={`Open demand ${d} exceeds effective available ${a.effective_available}`} /></div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard icon={Truck} title="Shipments" subtitle={`Showing ${shipRows.length} of ${ships.data?.length ?? 0} · carrier scans are authoritative for movement (SOP-SOT-002)`} bodyClassName="p-0">
          {!ships.data ? <div className="p-5"><LoadingState label="Loading shipments…" /></div> : shipRows.length === 0 ? <EmptyState illustration="search" title="No shipments match" /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Shipment</th><th>Order</th><th>Status</th><th>Carrier / tracking</th><th>Destination</th><th>Label created</th><th>Pickup scan</th><th>Last scan</th></tr></thead>
                <tbody>
                  {shipRows.map((s) => (
                    <tr key={s.shipment_id}>
                      <td className="font-mono font-bold text-navy">{s.shipment_id}</td>
                      <td className="font-mono">{s.order_id ?? '—'}</td>
                      <td><Badge v={s.status} /></td>
                      <td>{s.carrier} <span className="mono text-slate-500">{s.tracking_ref}</span></td>
                      <td><Chip>{s.destination_ref}</Chip></td>
                      <td className="whitespace-nowrap font-mono text-xs">{dayhhmm(s.label_created_at)}{simNow && !s.picked_up_at && <div className="text-[11px] text-slate-500">{hoursBetween(s.label_created_at, simNow)}h ago · no pickup scan</div>}</td>
                      <td className="font-mono text-xs">{dayhhmm(s.picked_up_at)}</td>
                      <td className="font-mono text-xs">{dayhhmm(s.last_scan_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
