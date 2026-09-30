import { Fragment, useMemo, useState } from 'react';
import { Package, ClipboardList, Lock, TriangleAlert, Truck, CircleCheckBig, Clock, ChevronRight, AlertTriangle, UserRound } from 'lucide-react';
import { useApi } from '../hooks';
import { Badge, Chip, EmptyState, LoadingState, PageHeader, SearchInput, SectionCard, Select, StatCard, dayhhmm } from '../components/ui';

const STATUSES = ['PENDING', 'PICKING', 'PICKED', 'PACKED', 'SHIPPED', 'ON_HOLD', 'CANCELLED'];
const OPEN_EXC = (e: any) => !['RESOLVED', 'CLOSED'].includes(e.status);
const DONE = new Set(['SHIPPED', 'CANCELLED']);

export default function Orders() {
  const { data, error } = useApi<any[]>('/api/orders');
  const meta = useApi<any>('/api/meta');
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [prio, setPrio] = useState('');
  const [exc, setExc] = useState('');
  const [q, setQ] = useState('');
  const simNow: string | undefined = meta.data?.sim?.sim_now;

  const all = data ?? [];
  const rows = useMemo(() => all.filter((o) => {
    if (filter && o.status !== filter) return false;
    if (prio && String(o.priority) !== prio) return false;
    if (exc === 'open' && !o.exceptions.some(OPEN_EXC)) return false;
    if (exc === 'none' && o.exceptions.length) return false;
    if (q) {
      const hay = [o.order_id, o.customer_ref, o.destination_ref, o.assigned_picker_id, ...o.lines.map((l: any) => l.sku), ...o.shipments.map((s: any) => s.shipment_id), ...o.exceptions.map((e: any) => e.exception_id)].join(' ').toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [all, filter, prio, exc, q]);

  const count = (s: string) => all.filter((o) => o.status === s).length;
  const withOpenExc = all.filter((o) => o.exceptions.some(OPEN_EXC)).length;
  const overdue = (o: any) => !!simNow && !DONE.has(o.status) && o.deadline < simNow;

  return (
    <div className="space-y-5">
      <PageHeader icon={Package} crumb="Orders" illustration="warehouse" title="Orders"
        subtitle="Order headers, lines and linked records. Inventory readiness comes from the active plan (planner's deterministic check)." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <StatCard icon={Package} tone="sky" label="Total orders" value={all.length} />
        <StatCard icon={ClipboardList} tone="emerald" label="Pending / picking" value={`${count('PENDING')} / ${count('PICKING')}`} />
        <StatCard icon={Lock} tone="amber" label="On hold (blocked)" value={count('ON_HOLD')} />
        <StatCard icon={TriangleAlert} tone="rose" label="With open exception" value={withOpenExc} />
        <StatCard icon={Truck} tone="violet" label="Packed / shipped" value={`${count('PACKED')} / ${count('SHIPPED')}`} />
        <StatCard icon={CircleCheckBig} tone="slate" label="Cancelled" value={count('CANCELLED')} />
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <SearchInput className="min-w-56 flex-1" value={q} onChange={setQ} placeholder="Search order, SKU, shipment, customer, exception…" />
        <Select label="Status" className="w-40" value={filter} onChange={setFilter} options={[{ value: '', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))]} />
        <Select label="Priority" className="w-36" value={prio} onChange={setPrio} options={[{ value: '', label: 'All priorities' }, { value: '1', label: 'P1' }, { value: '2', label: 'P2' }, { value: '3', label: 'P3' }]} />
        <Select label="Exceptions" className="w-44" value={exc} onChange={setExc} options={[{ value: '', label: 'All exceptions' }, { value: 'open', label: 'With open exception' }, { value: 'none', label: 'No exception' }]} />
      </div>

      <SectionCard icon={ClipboardList} title="Order register" subtitle={`Showing ${rows.length} of ${all.length} orders · click a row for customer, destination and hold details`} bodyClassName="p-0">
        {!data ? <div className="p-5">{error ? <div className="text-sm text-rose-700">Could not load orders: {error}</div> : <LoadingState label="Loading orders…" />}</div> : rows.length === 0 ? (
          <EmptyState illustration="search" title="No orders match these filters">Clear the search or filters to see all {all.length} orders.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="w-6" /><th>Order</th><th>Status</th><th>Prio</th><th>Deadline</th><th>Lines (picked/req)</th><th>Inventory readiness (plan)</th><th>Exceptions</th><th>Shipments</th><th>Picker</th></tr></thead>
              <tbody>
                {rows.map((o) => {
                  const isOpen = open === o.order_id;
                  const late = overdue(o);
                  return (
                    <Fragment key={o.order_id}>
                      <tr className="cursor-pointer" onClick={() => setOpen(isOpen ? null : o.order_id)}>
                        <td className="pr-0"><button className="rounded p-0.5 text-slate-400 hover:text-navy" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${o.order_id}`} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : o.order_id); }}><ChevronRight className={`h-4 w-4 transition ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                        <td className="whitespace-nowrap font-mono text-[13px] font-bold text-navy">{o.order_id}</td>
                        <td><Badge v={o.status} />{o.hold_exception_id && <div className="mt-1 whitespace-nowrap text-[11px] font-medium text-amber-700">held by {o.hold_exception_id}</div>}</td>
                        <td><span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-bold ${o.priority === 1 ? 'bg-rose-50 text-rose-700' : o.priority === 2 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>P{o.priority}</span></td>
                        <td className="whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs ${late ? 'bg-rose-50 font-semibold text-rose-700 ring-1 ring-rose-200' : 'text-slate-700'}`} title={late ? 'Deadline is before the simulated clock' : undefined}>
                            {dayhhmm(o.deadline)}{late && <Clock className="h-3.5 w-3.5" aria-label="overdue" />}
                          </span>
                        </td>
                        <td className="font-mono text-xs">
                          {o.lines.map((l: any) => (
                            <div key={l.line_id} className={`flex items-center gap-1 whitespace-nowrap ${l.requested_qty <= 0 ? 'font-semibold text-rose-600' : ''}`}>
                              {l.sku} {l.picked_qty}/{l.requested_qty}{l.requested_qty <= 0 && <AlertTriangle className="h-3.5 w-3.5" aria-label="invalid quantity" />}
                            </div>
                          ))}
                        </td>
                        <td className="min-w-[9rem] max-w-[14rem] text-xs">{o.plan ? <><Badge v={o.plan.status} /> <span className="mt-1 block text-slate-500">{o.plan.block_reason ?? o.plan.inventory_readiness}</span></> : <span className="text-slate-400">not in active plan</span>}</td>
                        <td>{o.exceptions.length ? o.exceptions.map((e: any) => <div key={e.exception_id} className="mb-1.5 whitespace-nowrap"><div className="font-mono text-xs text-navy">{e.exception_id}</div><Badge v={e.status} /></div>) : <span className="text-slate-400">—</span>}</td>
                        <td className="text-xs">{o.shipments.length ? o.shipments.map((s: any) => <div key={s.shipment_id} className="mb-1.5 whitespace-nowrap"><div className="font-mono text-navy">{s.shipment_id}</div><Badge v={s.status} /></div>) : <span className="text-slate-400">—</span>}</td>
                        <td>{o.assigned_picker_id ? <Chip tone="brand">{o.assigned_picker_id}</Chip> : <span className="text-slate-400">—</span>}</td>
                      </tr>
                      {isOpen && (
                        <tr><td colSpan={10} className="bg-slate-50/80">
                          <div className="flex flex-wrap gap-x-6 gap-y-1 py-1 pl-7 text-xs text-slate-600">
                            <span><UserRound className="mr-1 inline h-3.5 w-3.5" aria-hidden />customer <b className="text-navy">{o.customer_ref}</b></span>
                            <span>destination <b className="text-navy">{o.destination_ref}</b></span>
                            <span>created <b className="font-mono text-navy">{dayhhmm(o.created_at)}</b></span>
                            <span>updated <b className="font-mono text-navy">{dayhhmm(o.updated_at)}</b></span>
                            {o.hold_reason && <span>hold reason: <b className="text-amber-800">{o.hold_reason}</b> (previous status {o.hold_prev_status})</span>}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
