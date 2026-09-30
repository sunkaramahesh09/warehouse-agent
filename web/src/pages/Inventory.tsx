import { useApi } from '../hooks';
import { Badge, Card, PageHeader, dayhhmm } from '../components/ui';

export default function Inventory() {
  const inv = useApi<any[]>('/api/inventory');
  const ships = useApi<any[]>('/api/shipments');
  return (
    <div className="space-y-4">
      <PageHeader title="Inventory & shipments" subtitle="available = on_hand − reserved (generated column). A newer, lower cycle count supersedes system on_hand for exception decisions (SOP-SOT-001)." />
      <Card title="Inventory by SKU">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>SKU</th><th>Description</th><th>Skill</th><th>Min/unit</th><th>Location · on hand / reserved / available</th><th>Last cycle count</th><th>Effective available</th></tr></thead>
            <tbody>
              {(inv.data ?? []).map((s) => (
                <tr key={s.sku}>
                  <td className="font-mono font-semibold">{s.sku}</td>
                  <td>{s.description}</td>
                  <td>{s.required_skill ? <Badge v={s.required_skill} /> : '—'}</td>
                  <td className="mono">{s.pick_minutes_per_unit}</td>
                  <td className="mono">{s.locations.map((l: any) => <div key={l.location_id}>{l.location_id} (zone {l.zone}) · {l.on_hand} / {l.reserved} / <b>{l.available}</b> <span className="text-slate-400">upd {dayhhmm(l.last_updated)}</span></div>)}</td>
                  <td className="mono">{s.counts[0] ? <>{s.counts[0].count_id}: {s.counts[0].counted_qty} @ {dayhhmm(s.counts[0].counted_at)}</> : '—'}</td>
                  <td className={s.availability.count_supersedes_system ? 'font-semibold text-rose-700' : ''}>
                    {s.availability.effective_available}
                    {s.availability.count_supersedes_system && <div className="text-[11px] font-normal">count ({s.availability.latest_count.counted_qty}) newer than system ({s.availability.system_on_hand})</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Shipments">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Shipment</th><th>Order</th><th>Status</th><th>Carrier / tracking</th><th>Destination</th><th>Label created</th><th>Pickup scan</th><th>Last scan</th></tr></thead>
            <tbody>
              {(ships.data ?? []).map((s) => (
                <tr key={s.shipment_id}>
                  <td className="font-mono font-semibold">{s.shipment_id}</td><td className="font-mono">{s.order_id ?? '—'}</td><td><Badge v={s.status} /></td>
                  <td>{s.carrier} <span className="mono text-slate-500">{s.tracking_ref}</span></td><td className="mono">{s.destination_ref}</td>
                  <td className="mono">{dayhhmm(s.label_created_at)}</td><td className="mono">{dayhhmm(s.picked_up_at)}</td><td className="mono">{dayhhmm(s.last_scan_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
