import { useState, type ReactNode } from 'react';

const TONES: Record<string, string> = {
  // order / assignment statuses
  PENDING: 'bg-slate-100 text-slate-700 ring-slate-300',
  PICKING: 'bg-sky-50 text-sky-700 ring-sky-300',
  PICKED: 'bg-indigo-50 text-indigo-700 ring-indigo-300',
  PACKED: 'bg-violet-50 text-violet-700 ring-violet-300',
  SHIPPED: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  ON_HOLD: 'bg-amber-50 text-amber-800 ring-amber-300',
  CANCELLED: 'bg-zinc-100 text-zinc-500 ring-zinc-300 line-through',
  ASSIGNED: 'bg-teal-50 text-teal-700 ring-teal-300',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 ring-sky-300',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  BLOCKED: 'bg-amber-50 text-amber-800 ring-amber-300',
  INFEASIBLE: 'bg-rose-50 text-rose-700 ring-rose-300',
  // exception / run outcomes
  OPEN: 'bg-slate-100 text-slate-700 ring-slate-300',
  INVESTIGATING: 'bg-sky-50 text-sky-700 ring-sky-300',
  AWAITING_APPROVAL: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-300',
  RESOLVED: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  AUTO_RESOLVED: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  NO_ACTION_NEEDED: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  ESCALATED: 'bg-orange-50 text-orange-700 ring-orange-300',
  HELD_AND_ESCALATED: 'bg-orange-50 text-orange-700 ring-orange-300',
  FAILED: 'bg-rose-50 text-rose-700 ring-rose-300',
  CLOSED: 'bg-zinc-100 text-zinc-600 ring-zinc-300',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  EXECUTED: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-300',
  EXPIRED: 'bg-zinc-100 text-zinc-600 ring-zinc-300',
  AVAILABLE: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  UNAVAILABLE: 'bg-rose-50 text-rose-700 ring-rose-300',
  ACTIVE: 'bg-teal-50 text-teal-700 ring-teal-300',
  SUPERSEDED: 'bg-zinc-100 text-zinc-600 ring-zinc-300',
  PASS: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  PARTIAL: 'bg-amber-50 text-amber-800 ring-amber-300',
  FAIL: 'bg-rose-50 text-rose-700 ring-rose-300',
};

export function Badge({ v, title }: { v: string | null | undefined; title?: string }) {
  if (!v) return <span className="text-slate-400">—</span>;
  return (
    <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap ${TONES[v] ?? 'bg-slate-100 text-slate-700 ring-slate-300'}`}>
      {v.replace(/_/g, ' ')}
    </span>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone = 'slate', hint }: { label: string; value: ReactNode; tone?: string; hint?: string }) {
  const color: Record<string, string> = { slate: 'text-slate-800', amber: 'text-amber-700', rose: 'text-rose-700', teal: 'text-teal-700', emerald: 'text-emerald-700', fuchsia: 'text-fuchsia-700', orange: 'text-orange-700' };
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color[tone]}`}>{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function ErrorBox({ msg }: { msg: string | null | undefined }) {
  if (!msg) return null;
  return <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{msg}</div>;
}

export function Json({ value, collapsed = true, label = 'details' }: { value: unknown; collapsed?: boolean; label?: string }) {
  const [open, setOpen] = useState(!collapsed);
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  return (
    <div>
      <button className="text-xs text-teal-700 hover:underline" onClick={() => setOpen(!open)}>{open ? `hide ${label}` : `show ${label}`}</button>
      {open && <pre className="mono mt-1 max-h-80 overflow-auto rounded bg-slate-900 p-2 text-slate-100">{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}

export const hhmm = (iso?: string | null) => (iso ? iso.slice(11, 16) : '—');
export const dayhhmm = (iso?: string | null) => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : '—');

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-sm text-slate-400">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
