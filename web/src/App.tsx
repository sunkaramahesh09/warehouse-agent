import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Package, Boxes, Users, TriangleAlert, ClipboardCheck, CalendarClock, Zap, ScrollText, BarChart3,
  FlaskConical, BookOpen, RotateCcw, CircleAlert, CalendarDays, UserRound, Menu, X, ShieldCheck, ChevronDown,
} from 'lucide-react';
import { api, getRole, setRole, notifyChanged, type Role } from './api';
import { useApi, useAction } from './hooks';
import { ErrorBox, Spinner, hhmm, type Icon } from './components/ui';
import { Illustration } from './components/Illustration';
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

// Route keys are unchanged from the original UI (hash routing: #/dashboard, #/orders, …).
const NAV: ReadonlyArray<readonly [string, string, Icon]> = [
  ['dashboard', 'Dashboard', LayoutDashboard], ['orders', 'Orders', Package], ['inventory', 'Inventory & Shipments', Boxes], ['pickers', 'Pickers', Users],
  ['exceptions', 'Exceptions', TriangleAlert], ['queue', 'Approvals & Escalations', ClipboardCheck], ['planner', 'Shift Planner', CalendarClock],
  ['events', 'Events & Automation', Zap], ['audit', 'Audit Log', ScrollText], ['metrics', 'Metrics & Evaluation', BarChart3],
  ['scenarios', 'Scenarios & Tests', FlaskConical], ['policies', 'Policies (SOP)', BookOpen],
];
type Page = string;

const currentPage = (): Page => {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return NAV.find(([k]) => k === h)?.[0] ?? 'dashboard';
};

function Brand() {
  return (
    <a href="#/dashboard" className="flex shrink-0 items-center gap-3 whitespace-nowrap">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-lg font-bold text-white shadow-sm">W</div>
      <div className="leading-tight">
        <div className="text-[17px] font-bold text-navy">Warehouse Ops</div>
        <div className="text-xs text-slate-500">Exception Resolver + Shift Planner</div>
      </div>
    </a>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(currentPage());
  const [role, setRoleState] = useState<Role>(getRole());
  const [navOpen, setNavOpen] = useState(false);
  const meta = useApi<any>('/api/meta');
  const counts = useApi<any>('/api/dashboard');
  const reset = useAction();

  useEffect(() => {
    const on = () => { setPage(currentPage()); setNavOpen(false); document.getElementById('main')?.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const changeRole = (r: Role) => { setRole(r); setRoleState(r); notifyChanged(); };
  const pending = counts.data?.pending_approvals ?? 0;
  const escal = counts.data?.open_escalations ?? 0;
  const openExc = (counts.data?.exceptions ?? []).filter((x: any) => !['RESOLVED', 'CLOSED'].includes(x.status)).reduce((s: number, x: any) => s + x.n, 0);
  const badge: Record<string, number> = { queue: pending + escal, exceptions: openExc };
  const llm = meta.data?.llm;
  const sim = meta.data?.sim;

  const nav = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <ul className="space-y-0.5">
        {NAV.map(([k, label, I]) => {
          const on = page === k;
          return (
            <li key={k}>
              <a href={`#/${k}`} aria-current={on ? 'page' : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition [@media(max-height:800px)]:py-2 ${on ? 'bg-teal-50 text-teal-900 ring-1 ring-teal-100' : 'text-slate-600 hover:bg-white hover:text-navy'}`}>
                <I className={`h-[18px] w-[18px] shrink-0 ${on ? 'text-teal-700' : 'text-slate-400 group-hover:text-slate-600'}`} aria-hidden />
                <span className="flex-1 leading-tight">{label}</span>
                {badge[k] > 0 && <span className="rounded-full bg-rose-500 px-1.5 py-px text-[10px] font-bold text-white" aria-label={`${badge[k]} open`}>{badge[k]}</span>}
              </a>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto pt-6 [@media(max-height:760px)]:hidden">
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="border-b border-line bg-gradient-to-b from-sky-50/80 to-white px-3 pt-2 [@media(max-height:880px)]:hidden"><Illustration kind="warehouse" className="mx-auto block h-[72px] w-full" /></div>
          <div className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-teal-900"><ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden />One shared environment</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">The Exception Resolver writes to it; the Shift Planner reads from it.</p>
          <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />All actions are logged
          </div>
          </div>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>

      {/* ---------------- header ---------------- */}
      <header className="relative z-30 shrink-0 border-b border-line bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-5">
          <button className="btn-secondary btn-sm lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu className="h-4 w-4" /></button>
          <div className="lg:w-[236px]"><Brand /></div>

          {/* Always-visible simulation notice (required). */}
          <div className="order-last flex w-full min-w-0 items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 min-[1400px]:order-none min-[1400px]:w-auto min-[1400px]:flex-1" role="note">
            <CircleAlert className="mt-px h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <span><b className="font-semibold">SIMULATED ENVIRONMENT</b> — fictional data, no connection to any real warehouse, carrier or customer system. All actions are simulated.</span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-1.5 ring-1 ring-line" title="Simulated shift clock">
              <CalendarDays className="h-5 w-5 text-teal-700" aria-hidden />
              <div className="leading-tight">
                <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Sim time</div>
                <div className="font-mono text-[13px] font-semibold text-navy">{sim ? `${sim.sim_now.slice(0, 10)} ${hhmm(sim.sim_now)}` : '…'}</div>
                <div className="text-[10px] text-slate-500">Shift ends {hhmm(sim?.shift_end)}</div>
              </div>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ring-1 ${llm?.configured ? 'bg-emerald-50 ring-emerald-100' : 'bg-slate-50 ring-line'}`} title="Agent mode">
              <span className={`h-2.5 w-2.5 rounded-full ${llm?.configured ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden />
              <div className="leading-tight">
                <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">LLM</div>
                <div className="text-[13px] font-semibold text-navy">{llm?.configured ? llm.model : 'Deterministic (no key)'}</div>
              </div>
            </div>
            <label className="relative flex items-center">
              <span className="sr-only">Role</span>
              <UserRound className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500" aria-hidden />
              <select className="input appearance-none py-2.5 pl-9 pr-8 font-medium" value={role} onChange={(e) => changeRole(e.target.value as Role)}>
                <option value="operator">Operator / Supervisor</option>
                <option value="reviewer">Exception Reviewer</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400" aria-hidden />
            </label>
            <button className="btn-primary py-2.5" disabled={!!reset.busy || role !== 'operator'} title={role !== 'operator' ? 'Operator only' : 'Restore the baseline seed'}
              onClick={() => { if (confirm('Reset the simulated environment to the baseline seed? All runs, plans and approvals are cleared.')) reset.run('reset', () => api.post('/api/reset')); }}>
              {reset.busy ? <Spinner /> : <RotateCcw className="h-4 w-4" aria-hidden />}{reset.busy ? 'Resetting…' : 'Reset environment'}
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------------- sidebar ---------------- */}
        <aside className="hidden w-[260px] shrink-0 overflow-y-auto overscroll-contain border-r border-line bg-canvas/60 px-3 py-4 lg:block">{nav}</aside>

        {navOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button className="absolute inset-0 bg-navy/30" onClick={() => setNavOpen(false)} aria-label="Close navigation" />
            <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-canvas p-3 shadow-xl">
              <div className="mb-3 flex items-center justify-between"><Brand /><button className="btn-secondary btn-sm" onClick={() => setNavOpen(false)} aria-label="Close navigation"><X className="h-4 w-4" /></button></div>
              {nav}
            </div>
          </div>
        )}

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 outline-none md:px-6 lg:px-8 lg:py-6">
          {reset.error && <div className="mb-4"><ErrorBox operation="Reset environment" msg={reset.error} /></div>}
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
