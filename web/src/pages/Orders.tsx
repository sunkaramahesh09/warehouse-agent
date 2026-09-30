import { Fragment, useState } from 'react';
import { useApi } from '../hooks';
import { Badge, Card, PageHeader, dayhhmm } from '../components/ui';

export default function Orders() {
  const { data } = useApi<any[]>('/api/orders');
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const rows = (data ?? []).filter((o) => !filter || o.status === filter);
  return (
    <div className="space-y-4">
      <PageHeader title="Orders" subtitle="Order headers, lines and linked records. Inventory readiness comes from the active plan (planner's deterministic check)."
        actions={<select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All statuses</option>
          {['PENDING', 'PICKING', 'PICKED', 'PACKED', 'SHIPPED', 'ON_HOLD', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
        </select>} />
      <Card>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Order</th><th>Status</th><th>Prio</th><th>Deadline</th><th>Lines (picked/req)</th><th>Inventory readiness (plan)</th><th>Exceptions</th><th>Shipments</th><th>Picker</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <Fragment key={o.order_id}>
                  <tr className="cursor-pointer" onClick={() => setOpen(open === o.order_id ? null : o.order_id)}>
                    <td className="font-mono font-semibold">{o.order_id}</td>
                    <td><Badge v={o.status} />{o.hold_exception_id && <div className="mt-0.5 text-[11px] text-amber-700">held by {o.hold_exception_id}</div>}</td>
                    <td>P{o.priority}</td>
                    <td className="mono">{dayhhmm(o.deadline)}</td>
                    <td className="mono">{o.lines.map((l: any) => <div key={l.line_id} className={l.requested_qty <= 0 ? 'text-rose-600' : ''}>{l.sku} {l.picked_qty}/{l.requested_qty}</div>)}</td>
                    <td className="max-w-xs text-xs">{o.plan ? <><Badge v={o.plan.status} /> <span className="text-slate-500">{o.plan.block_reason ?? o.plan.inventory_readiness}</span></> : <span className="text-slate-400">not in active plan</span>}</td>
                    <td>{o.exceptions.map((e: any) => <div key={e.exception_id} className="text-xs"><span className="font-mono">{e.exception_id}</span> <Badge v={e.status} /></div>)}</td>
                    <td className="text-xs">{o.shipments.map((s: any) => <div key={s.shipment_id}><span className="font-mono">{s.shipment_id}</span> {s.status}</div>)}</td>
                    <td className="mono">{o.assigned_picker_id ?? '—'}</td>
                  </tr>
                  {open === o.order_id && (
                    <tr><td colSpan={9} className="bg-slate-50 text-xs text-slate-600">
                      customer <b>{o.customer_ref}</b> · destination <b>{o.destination_ref}</b> · created {dayhhmm(o.created_at)} · updated {dayhhmm(o.updated_at)}
                      {o.hold_reason && <> · hold reason: <b>{o.hold_reason}</b> (previous status {o.hold_prev_status})</>}
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
