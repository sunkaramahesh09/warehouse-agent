import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Card, ErrorBox, PageHeader } from '../components/ui';

export default function Pickers() {
  const { data } = useApi<any>('/api/pickers');
  const act = useAction();
  const toggle = (p: any) => {
    const to = p.availability === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
    const reason = to === 'UNAVAILABLE' ? prompt(`Reason ${p.picker_id} becomes unavailable (simulated):`, 'Went home sick') : 'Back on shift';
    if (!reason) return;
    act.run(p.picker_id, () => api.post('/api/sim/picker', { picker_id: p.picker_id, availability: to, reason }));
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Pickers" subtitle="Capacity is productive minutes this shift; consumed minutes grow as the simulated clock advances. After changing availability, replan from the Shift Planner." />
      <ErrorBox msg={act.error} />
      <Card>
        <table className="tbl">
          <thead><tr><th>Picker</th><th>Availability</th><th>Skills</th><th>Home zone</th><th>Capacity (min)</th><th>Consumed</th><th>Planned load (active plan)</th><th /></tr></thead>
          <tbody>
            {(data?.data ?? []).map((p: any) => (
              <tr key={p.picker_id}>
                <td><span className="font-mono font-semibold">{p.picker_id}</span> <span className="text-slate-500">{p.display_name}</span></td>
                <td><Badge v={p.availability} />{p.unavailable_reason && <div className="text-[11px] text-rose-600">{p.unavailable_reason}</div>}</td>
                <td>{p.skills.map((s: string) => <span key={s} className="mr-1"><Badge v={s} /></span>)}</td>
                <td>{p.home_zone}</td>
                <td className="mono">{p.capacity_minutes}</td>
                <td className="mono">{p.consumed_minutes}</td>
                <td className="mono">{p.planned_load_minutes} min · {p.planned_orders} order(s)</td>
                <td><button className="btn-secondary py-1" disabled={getRole() !== 'operator' || act.busy === p.picker_id} onClick={() => toggle(p)}>{p.availability === 'AVAILABLE' ? 'Mark unavailable' : 'Mark available'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
