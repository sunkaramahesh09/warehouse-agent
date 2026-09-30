import { useState } from 'react';
import { Users, UserX, Clock, Gauge, UserCheck, Lightbulb, Layers } from 'lucide-react';
import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Callout, EmptyState, ErrorBox, LoadingState, Meter, PageHeader, SearchInput, SectionCard, Select, Spinner, StatCard } from '../components/ui';

const AVATAR = ['bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-emerald-500', 'bg-rose-500', 'bg-teal-600'];
const round = (n: number) => Math.round(n * 10) / 10;

export default function Pickers() {
  const { data, error } = useApi<any>('/api/pickers');
  const act = useAction();
  const [q, setQ] = useState('');
  const [avail, setAvail] = useState('');
  const [zone, setZone] = useState('');
  const [skill, setSkill] = useState('');
  const isOperator = getRole() === 'operator';

  // Unchanged behaviour: prompt for a reason, then the controlled simulation tool (operator only).
  const toggle = (p: any) => {
    const to = p.availability === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
    const reason = to === 'UNAVAILABLE' ? prompt(`Reason ${p.picker_id} becomes unavailable (simulated):`, 'Went home sick') : 'Back on shift';
    if (!reason) return;
    act.run(p.picker_id, () => api.post('/api/sim/picker', { picker_id: p.picker_id, availability: to, reason }));
  };

  const pickers: any[] = data?.data ?? [];
  const zones = [...new Set(pickers.map((p) => p.home_zone))].sort();
  const skills = [...new Set(pickers.flatMap((p) => p.skills))].sort();
  const rows = pickers.filter((p) =>
    (!avail || p.availability === avail) && (!zone || p.home_zone === zone) && (!skill || p.skills.includes(skill)) &&
    (!q || `${p.picker_id} ${p.display_name}`.toLowerCase().includes(q.toLowerCase())));
  const available = pickers.filter((p) => p.availability === 'AVAILABLE');
  const cap = available.reduce((s, p) => s + p.capacity_minutes, 0);
  const consumed = pickers.reduce((s, p) => s + Number(p.consumed_minutes), 0);
  const planned = pickers.reduce((s, p) => s + Number(p.planned_load_minutes), 0);

  return (
    <div className="space-y-5">
      <PageHeader photo="pickers" icon={Users} crumb="Pickers" title="Pickers"
        subtitle="Capacity is productive minutes this shift; consumed minutes grow as the simulated clock advances. After changing availability, replan from the Shift Planner." />
      <ErrorBox operation={act.busy ? undefined : 'Change picker availability'} msg={act.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={UserCheck} tone="emerald" label="Available pickers" value={`${available.length} / ${pickers.length}`} hint={pickers.length ? `${Math.round((available.length / pickers.length) * 100)}% available` : undefined} />
        <StatCard icon={UserX} tone="rose" label="Unavailable" value={pickers.length - available.length} hint={pickers.filter((p) => p.availability !== 'AVAILABLE').map((p) => `${p.picker_id}: ${p.unavailable_reason ?? 'no reason'}`).join(' · ') || 'Everyone on shift'} />
        <StatCard icon={Clock} tone="sky" label="Capacity of available pickers" value={`${cap} min`} />
        <StatCard icon={Gauge} tone="violet" label="Consumed / planned" value={`${round(consumed)} / ${round(planned)} min`} hint="Consumed this shift · load in active plan" />
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <SearchInput className="min-w-56 flex-1" value={q} onChange={setQ} placeholder="Search by picker id or name…" />
        <Select label="Availability" className="w-44" value={avail} onChange={setAvail} options={[{ value: '', label: 'All availability' }, { value: 'AVAILABLE', label: 'Available' }, { value: 'UNAVAILABLE', label: 'Unavailable' }]} />
        <Select label="Home zone" className="w-36" value={zone} onChange={setZone} options={[{ value: '', label: 'All zones' }, ...zones.map((z) => ({ value: z, label: `Zone ${z}` }))]} />
        <Select label="Skill" className="w-36" value={skill} onChange={setSkill} options={[{ value: '', label: 'All skills' }, ...skills.map((s) => ({ value: s, label: s }))]} />
      </div>

      <SectionCard icon={Users} title="Picker details" subtitle={`Showing ${rows.length} of ${pickers.length} · utilisation = planned load ÷ remaining capacity`} bodyClassName="p-0">
        {!data ? <div className="p-5">{error ? <div className="text-sm text-rose-700">Could not load pickers: {error}</div> : <LoadingState label="Loading pickers…" />}</div> : rows.length === 0 ? <EmptyState illustration="people" title="No pickers match these filters" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Picker</th><th>Availability</th><th>Skills</th><th>Home zone</th><th className="text-right">Capacity</th><th className="text-right">Consumed</th><th>Utilisation · planned load (active plan)</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {rows.map((p) => {
                  const remaining = Math.max(0, p.capacity_minutes - Number(p.consumed_minutes));
                  const idx = pickers.indexOf(p);
                  return (
                    <tr key={p.picker_id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${AVATAR[idx % AVATAR.length]}`} aria-hidden>{p.display_name?.[0] ?? '?'}</span>
                          <div className="leading-tight"><div className="font-mono font-bold text-navy">{p.picker_id}</div><div className="text-xs text-slate-500">{p.display_name}</div></div>
                        </div>
                      </td>
                      <td><Badge v={p.availability} dot />{p.unavailable_reason && <div className="mt-1 text-[11px] text-rose-600">{p.unavailable_reason}</div>}</td>
                      <td><div className="flex flex-wrap gap-1">{p.skills.map((s: string) => <Badge key={s} v={s} />)}</div></td>
                      <td className="font-medium text-navy">Zone {p.home_zone}</td>
                      <td className="text-right tabular-nums">{p.capacity_minutes} min</td>
                      <td className="text-right tabular-nums">{p.consumed_minutes} min</td>
                      <td>
                        <Meter value={Number(p.planned_load_minutes)} max={remaining} tone={Number(p.planned_load_minutes) > remaining ? 'rose' : 'teal'} label={`${p.picker_id} planned ${p.planned_load_minutes} of ${remaining} remaining minutes`} />
                        <div className="mt-1 whitespace-nowrap font-mono text-[11px] text-slate-500">{p.planned_load_minutes} min · {p.planned_orders} order(s)</div>
                      </td>
                      <td className="text-right">
                        <button className={p.availability === 'AVAILABLE' ? 'btn-danger-soft btn-sm' : 'btn-secondary btn-sm'} disabled={!isOperator || act.busy === p.picker_id} onClick={() => toggle(p)} title={isOperator ? undefined : 'Operator role required'}>
                          {act.busy === p.picker_id && <Spinner className="h-3.5 w-3.5" />}{p.availability === 'AVAILABLE' ? 'Mark unavailable' : 'Mark available'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-3">
        <SectionCard icon={Layers} title="Skills overview" subtitle="Pickers holding each skill (available / total)">
          <ul className="space-y-3">
            {skills.map((s) => {
              const holders = pickers.filter((p) => p.skills.includes(s));
              const on = holders.filter((p) => p.availability === 'AVAILABLE').length;
              return (
                <li key={s} className="flex items-center gap-3">
                  <span className="w-20"><Badge v={s} /></span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-600" style={{ width: `${pickers.length ? (on / pickers.length) * 100 : 0}%` }} /></div>
                  <span className="w-12 text-right text-sm font-semibold tabular-nums text-navy">{on} / {holders.length}</span>
                </li>
              );
            })}
          </ul>
        </SectionCard>
        <SectionCard icon={Gauge} title="Capacity & utilisation" subtitle="Available pickers, this shift">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Capacity</dt><dd className="text-xl font-bold tabular-nums text-navy">{cap} min</dd></div>
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Consumed</dt><dd className="text-xl font-bold tabular-nums text-navy">{round(available.reduce((s, p) => s + Number(p.consumed_minutes), 0))} min</dd></div>
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Planned (active plan)</dt><dd className="text-xl font-bold tabular-nums text-navy">{round(available.reduce((s, p) => s + Number(p.planned_load_minutes), 0))} min</dd></div>
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Free</dt><dd className="text-xl font-bold tabular-nums text-emerald-700">{round(available.reduce((s, p) => s + Math.max(0, p.capacity_minutes - Number(p.consumed_minutes) - Number(p.planned_load_minutes)), 0))} min</dd></div>
          </dl>
        </SectionCard>
        <Callout tone="info" icon={Lightbulb} title="How it works">
          <ul className="list-disc space-y-1 pl-4">
            <li>Capacity is productive minutes this shift; consumed minutes grow as the simulated clock advances.</li>
            <li>The planner never assigns work to an unavailable picker and never exceeds remaining capacity (SOP-PLN-002).</li>
            <li>COLD / BULKY SKUs can only be picked by pickers holding that skill.</li>
            <li>Change availability here, then replan from the Shift Planner (or enable auto-replan in Events &amp; Automation).</li>
          </ul>
        </Callout>
      </div>
    </div>
  );
}
