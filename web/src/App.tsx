import { useEffect, useState } from 'react';
import { api, getRole, setRole, notifyChanged, type Role } from './api';
import { useApi, useAction } from './hooks';
import { ErrorBox, hhmm } from './components/ui';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Inventory from './pages/Inventory';
import Pickers from './pages/Pickers';
import Exceptions from './pages/Exceptions';
import Queue from './pages/Queue';
import Planner from './pages/Planner';
import Audit from './pages/Audit';
import Scenarios from './pages/Scenarios';
import Policies from './pages/Policies';
import Events from './pages/Events';
import Metrics from './pages/Metrics';

const NAV = [
  ['dashboard', 'Dashboard'], ['orders', 'Orders'], ['inventory', 'Inventory & Shipments'], ['pickers', 'Pickers'],
  ['exceptions', 'Exceptions'], ['queue', 'Approvals & Escalations'], ['planner', 'Shift Planner'], ['events', 'Events & Automation'], ['audit', 'Audit Log'], ['metrics', 'Metrics & Evaluation'],
  ['scenarios', 'Scenarios & Tests'], ['policies', 'Policies (SOP)'],
] as const;
type Page = (typeof NAV)[number][0];

const currentPage = (): Page => {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (NAV.find(([k]) => k === h)?.[0] ?? 'dashboard') as Page;
};

export default function App() {
  const [page, setPage] = useState<Page>(currentPage());
  const [role, setRoleState] = useState<Role>(getRole());
  const meta = useApi<any>('/api/meta');
  const counts = useApi<any>('/api/dashboard');
  const reset = useAction();

  useEffect(() => {
    const on = () => setPage(currentPage());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const changeRole = (r: Role) => { setRole(r); setRoleState(r); notifyChanged(); };
  const pending = counts.data?.pending_approvals ?? 0;
  const escal = counts.data?.open_escalations ?? 0;
  const llm = meta.data?.llm;

  return (
    <div className="min-h-screen">
      <div className="bg-amber-100 px-4 py-1 text-center text-xs font-medium text-amber-900">
        SIMULATED ENVIRONMENT — fictional data, no connection to any real warehouse, carrier or customer system. All actions are simulated.
      </div>
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded bg-teal-700 text-sm font-bold text-white">W</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Warehouse Ops</div>
            <div className="text-[11px] text-slate-500">Exception Resolver + Shift Planner</div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded bg-slate-100 px-2 py-1 font-mono" title="Simulated shift clock">
            ⏱ sim {meta.data ? `${meta.data.sim.sim_now.slice(0, 10)} ${hhmm(meta.data.sim.sim_now)}` : '…'} · shift ends {hhmm(meta.data?.sim.shift_end)}
          </span>
          <span className={`rounded px-2 py-1 ${llm?.configured ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-600'}`} title="Agent mode">
            {llm?.configured ? `LLM: ${llm.model}` : 'LLM not configured → deterministic agent'}
          </span>
          <label className="flex items-center gap-1">
            <span className="text-slate-500">Role</span>
            <select className="input py-1" value={role} onChange={(e) => changeRole(e.target.value as Role)}>
              <option value="operator">Operator / Supervisor</option>
              <option value="reviewer">Exception Reviewer</option>
            </select>
          </label>
          <button className="btn-secondary py-1" disabled={!!reset.busy || role !== 'operator'} title={role !== 'operator' ? 'Operator only' : 'Restore the baseline seed'}
            onClick={() => { if (confirm('Reset the simulated environment to the baseline seed? All runs, plans and approvals are cleared.')) reset.run('reset', () => api.post('/api/reset')); }}>
            {reset.busy ? 'Resetting…' : '↺ Reset environment'}
          </button>
        </div>
      </header>
      <div className="flex">
        <nav className="sticky top-[88px] hidden h-[calc(100vh-88px)] w-56 shrink-0 border-r border-slate-200 bg-white p-2 md:block">
          {NAV.map(([k, label]) => (
            <a key={k} href={`#/${k}`} className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${page === k ? 'bg-teal-50 font-semibold text-teal-800' : 'text-slate-600 hover:bg-slate-50'}`}>
              {label}
              {k === 'queue' && pending + escal > 0 && <span className="rounded-full bg-fuchsia-600 px-1.5 text-[10px] font-bold text-white">{pending + escal}</span>}
            </a>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <div className="mb-3 md:hidden">
            <select className="input w-full" value={page} onChange={(e) => { window.location.hash = `#/${e.target.value}`; }}>
              {NAV.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <ErrorBox msg={reset.error} />
          {page === 'dashboard' && <Dashboard />}
          {page === 'orders' && <Orders />}
          {page === 'inventory' && <Inventory />}
          {page === 'pickers' && <Pickers />}
          {page === 'exceptions' && <Exceptions />}
          {page === 'queue' && <Queue />}
          {page === 'planner' && <Planner />}
          {page === 'events' && <Events />}
          {page === 'audit' && <Audit />}
          {page === 'metrics' && <Metrics />}
          {page === 'scenarios' && <Scenarios />}
          {page === 'policies' && <Policies />}
        </main>
      </div>
    </div>
  );
}
