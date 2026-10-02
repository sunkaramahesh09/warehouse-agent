/**
 * Shared presentation components (design system). Presentation only — no data fetching,
 * no business rules. Every page composes these so the app reads as one product.
 */
import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ChevronDown, Info, Loader2, Search, type LucideProps } from 'lucide-react';
import { Illustration, type IllustrationKind } from './Illustration';
import { HeroArt, type HeroScene } from './HeroArt';

export type Icon = ComponentType<LucideProps>;

// ------------------------------------------------------------------ status badges
type Tone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'orange' | 'danger' | 'violet' | 'fuchsia' | 'muted';
const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  brand: 'bg-teal-50 text-teal-800 ring-teal-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  muted: 'bg-zinc-100 text-zinc-500 ring-zinc-200',
};
const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400', info: 'bg-sky-500', brand: 'bg-teal-600', success: 'bg-emerald-500', warning: 'bg-amber-500',
  orange: 'bg-orange-500', danger: 'bg-rose-500', violet: 'bg-violet-500', fuchsia: 'bg-fuchsia-500', muted: 'bg-zinc-400',
};

/** Single status → tone map used everywhere (orders, plans, exceptions, approvals, events, tests). */
const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'neutral', PICKING: 'info', PICKED: 'violet', PACKED: 'violet', SHIPPED: 'success', ON_HOLD: 'warning', CANCELLED: 'muted',
  ASSIGNED: 'brand', IN_PROGRESS: 'info', COMPLETED: 'success', BLOCKED: 'warning', INFEASIBLE: 'danger',
  OPEN: 'neutral', INVESTIGATING: 'info', AWAITING_APPROVAL: 'fuchsia', RESOLVED: 'success', AUTO_RESOLVED: 'success', NO_ACTION_NEEDED: 'success',
  ESCALATED: 'orange', HELD_AND_ESCALATED: 'orange', FAILED: 'danger', CLOSED: 'muted',
  APPROVED: 'success', EXECUTED: 'success', EXECUTING: 'info', REJECTED: 'danger', EXPIRED: 'muted',
  AVAILABLE: 'success', UNAVAILABLE: 'danger', ACTIVE: 'brand', SUPERSEDED: 'muted',
  PROCESSED: 'success', SKIPPED: 'muted', PASS: 'success', PARTIAL: 'warning', FAIL: 'danger',
  REQUEST_APPROVAL: 'fuchsia', ESCALATE: 'orange', AUTO_ACTION: 'success',
  LABEL_CREATED: 'neutral', PICKED_UP: 'info', IN_TRANSIT: 'info', DELIVERED: 'success',
  COLD: 'info', BULKY: 'violet', STANDARD: 'neutral',
};
export const toneOf = (v: string) => STATUS_TONE[v] ?? 'neutral';

export function Badge({ v, title, tone, dot = false, className = '', wrap = false }: { v: string | null | undefined; title?: string; tone?: Tone; dot?: boolean; className?: string; wrap?: boolean }) {
  if (!v) return <span className="text-slate-400">—</span>;
  const t = tone ?? toneOf(v);
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${wrap ? 'text-left leading-tight' : 'whitespace-nowrap'} ${TONE_CLASS[t]} ${v === 'CANCELLED' ? 'line-through' : ''} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOT[t]}`} aria-hidden />}
      {v.replace(/_/g, ' ')}
    </span>
  );
}
export const StatusBadge = Badge;

/** Neutral chip for ids / codes (SKU, location, policy id…). */
export function Chip({ children, tone = 'neutral', mono = true, title }: { children: ReactNode; tone?: Tone; mono?: boolean; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE_CLASS[tone]} ${mono ? 'font-mono' : ''}`}>{children}</span>;
}

// ------------------------------------------------------------------ cards
const ICON_TILE: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-600', teal: 'bg-teal-50 text-teal-700', emerald: 'bg-emerald-50 text-emerald-600', sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600', orange: 'bg-orange-50 text-orange-600', rose: 'bg-rose-50 text-rose-600', violet: 'bg-violet-50 text-violet-600', fuchsia: 'bg-fuchsia-50 text-fuchsia-600',
};
const VALUE_COLOR: Record<string, string> = {
  slate: 'text-navy', teal: 'text-teal-800', emerald: 'text-emerald-700', sky: 'text-sky-700', amber: 'text-amber-700',
  orange: 'text-orange-700', rose: 'text-rose-700', violet: 'text-violet-700', fuchsia: 'text-fuchsia-700',
};

export function SectionCard({ title, icon: I, subtitle, actions, children, className = '', bodyClassName = 'p-5', id }: {
  title?: ReactNode; icon?: Icon; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string;
}) {
  const hid = useId();
  return (
    <section className={`card ${className}`} aria-labelledby={title ? hid : undefined} id={id}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {I && <I className="h-[18px] w-[18px] shrink-0 text-teal-700" aria-hidden />}
            <div className="min-w-0">
              <h2 id={hid} className="text-[15px] font-semibold leading-tight text-navy">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Backwards-compatible alias used by existing pages. */
export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <SectionCard title={title} actions={actions} className={className}>{children}</SectionCard>;
}

export function StatCard({ icon: I, label, value, hint, tone = 'slate', active = false, title }: {
  icon?: Icon; label: string; value: ReactNode; hint?: ReactNode; tone?: string; active?: boolean; title?: string;
}) {
  // Container query: side-by-side when the card is wide enough, stacked (never truncated) when narrow.
  return (
    <div className={`card @container px-4 py-3.5 ${active ? 'ring-2 ring-teal-600/30' : ''}`} title={title}>
      <div className="flex flex-col gap-2 @[210px]:flex-row @[210px]:items-center @[210px]:gap-3.5">
        {I && <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl @[210px]:h-11 @[210px]:w-11 ${ICON_TILE[tone] ?? ICON_TILE.slate}`}><I className="h-[18px] w-[18px] @[210px]:h-5 @[210px]:w-5" aria-hidden /></div>}
        <div className="min-w-0">
          <div className={`text-2xl font-bold leading-tight tabular-nums ${VALUE_COLOR[tone] ?? VALUE_COLOR.slate}`}>{value}</div>
          <div className="text-[13px] font-medium leading-snug text-slate-600">{label}</div>
          {hint && <div className="text-xs leading-snug text-slate-400">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

/** Backwards-compatible alias. */
export function Stat({ label, value, tone = 'slate', hint }: { label: string; value: ReactNode; tone?: string; hint?: string }) {
  return <StatCard label={label} value={value} tone={tone} hint={hint} />;
}

// ------------------------------------------------------------------ page header
/** Page-header banner with original isometric artwork (components/HeroArt.tsx); one scene per page. */
export function PageHeader({ title, subtitle, actions, icon: I, crumb, illustration, aside, art }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: Icon; crumb?: string; illustration?: IllustrationKind; aside?: ReactNode; art?: HeroScene;
}) {
  return (
    <div className={`relative mb-5 overflow-hidden ${art ? 'rounded-3xl border border-line bg-white px-5 py-5 md:px-7 lg:min-h-[220px]' : 'rounded-2xl'}`} style={art ? { boxShadow: 'var(--shadow-card)' } : undefined}>
      {art && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {/* soft brand wash + dot grid, fading in from the right */}
          <div className="absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,#d9f4ef_0%,#eef8f6_35%,rgba(255,255,255,0)_70%)]" />
          <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(#cbd9e6_1px,transparent_1.2px)] [background-size:16px_16px] [mask-image:linear-gradient(to_right,transparent_30%,#000_80%)]" />
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-teal-200/30 blur-3xl" />
          <HeroArt scene={art} tilt className="absolute inset-y-0 right-0 hidden h-full w-[56%] lg:block" />
        </div>
      )}
      {!art && illustration && <Illustration kind={illustration} className="pointer-events-none absolute -right-2 -top-3 hidden h-[150px] w-[340px] opacity-90 xl:block" />}
      <div className={`relative flex flex-wrap items-end justify-between gap-4 ${art ? 'h-full lg:min-h-[176px]' : 'py-1'}`}>
        <div className={`min-w-0 ${art ? 'max-w-3xl self-center lg:max-w-[48%]' : 'max-w-3xl'}`}>
          {crumb && (
            <div className={`mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-teal-800 ${art ? 'rounded-full bg-teal-50 px-2.5 py-1 ring-1 ring-teal-100' : ''}`}>
              {I && <I className="h-4 w-4" aria-hidden />}{crumb}
            </div>
          )}
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-navy md:text-[32px]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{subtitle}</p>}
          {art && (aside || actions) && <div className="mt-4 flex flex-wrap items-center gap-2">{aside}{actions}</div>}
        </div>
        {!art && (aside || actions) && <div className={`relative flex flex-wrap items-center gap-2 ${illustration ? 'xl:rounded-2xl xl:bg-white/85 xl:p-2 xl:shadow-sm xl:ring-1 xl:ring-line xl:backdrop-blur' : ''}`}>{aside}{actions}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ states
export function EmptyState({ illustration = 'empty', title, children, action, compact = false }: { illustration?: IllustrationKind; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'py-6' : 'py-10'}`} role="status">
      <Illustration kind={illustration} className={compact ? 'h-16 w-24' : 'h-24 w-36'} />
      <h3 className="mt-3 text-[15px] font-semibold text-navy">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Backwards-compatible simple empty line. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-slate-400" role="status">{children}</div>;
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden />;
}

/** Shown while a real request is in flight. */
export function LoadingState({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-3 py-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium text-teal-800"><Spinner />{label}</div>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-9" style={{ opacity: 1 - i * 0.18 }} />)}
    </div>
  );
}

/** Inline progress for a long-running operation (investigation, planning, scenario…). */
export function ProgressNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-teal-200 bg-teal-50/70 px-3.5 py-2.5 text-sm font-medium text-teal-900" role="status" aria-live="polite">
      <Spinner className="h-4 w-4 text-teal-700" />{children}
    </div>
  );
}

/**
 * Error presentation: what failed + the server's message + what to do next. Never hides the
 * error and never implies success.
 */
export function ErrorBox({ msg, operation }: { msg: string | null | undefined; operation?: string }) {
  if (!msg) return null;
  return (
    <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />
      <div className="min-w-0">
        <div className="font-semibold text-rose-800">{operation ? `${operation} failed` : 'The last operation failed'}</div>
        <div className="mt-0.5 break-words text-rose-700">{msg}</div>
        <div className="mt-1 text-xs text-rose-600/90">No success was recorded for this request. Check the Audit Log to confirm what, if anything, changed, then retry.</div>
      </div>
    </div>
  );
}

export function Callout({ tone = 'info', title, children, icon: I = Info }: { tone?: 'info' | 'warning' | 'brand'; title?: ReactNode; children: ReactNode; icon?: Icon }) {
  const c = tone === 'warning' ? 'border-amber-200 bg-amber-50/70 text-amber-900' : tone === 'brand' ? 'border-teal-200 bg-teal-50/60 text-teal-900' : 'border-sky-200 bg-sky-50/70 text-sky-900';
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${c}`}>
      <I className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
      <div className="min-w-0">{title && <div className="font-semibold">{title}</div>}<div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div></div>
    </div>
  );
}

// ------------------------------------------------------------------ controls
export function SearchInput({ value, onChange, placeholder, label, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; className?: string }) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label ?? placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input type="search" className="input w-full pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

type SelectOption = { value: string; label: string; disabled?: boolean };
/**
 * Custom listbox (replaces the native <select> so the open menu matches the design system).
 * The closed trigger keeps the `.input` look; the menu is portalled so headers/tables never clip it.
 * Keyboard: ↑/↓/Home/End move, Enter/Space pick, Esc/Tab close, letters jump (typeahead).
 */
export function Select({ value, onChange, options, label, className = '', disabled, hideLabel = true, icon: I, triggerClassName = '' }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; label: string; className?: string; disabled?: boolean; hideLabel?: boolean;
  icon?: Icon; triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ q: '', t: 0 });
  const id = useId();
  const sel = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[sel];

  const place = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const h = Math.min(288, options.length * 36 + 12);
    const up = r.bottom + h + 8 > window.innerHeight && r.top > h + 8;
    setPos({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: r.width, up });
  };
  const show = () => { if (disabled) return; btn.current?.focus(); place(); setActive(sel); setOpen(true); };
  const hide = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };
  const pick = (i: number) => { const o = options[i]; if (!o || o.disabled) return; if (o.value !== value) onChange(o.value); hide(); };
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i;
    return from;
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { const t = e.target as Node; if (!btn.current?.contains(t) && !list.current?.contains(t)) hide(false); };
    const onScroll = (e: Event) => { if (!list.current?.contains(e.target as Node)) place(); };
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', place); };
  }, [open]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(k)) { e.preventDefault(); show(); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
    else if (k === 'Tab') hide(false);
    else if (k === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)); }
    else if (k === 'Home') { e.preventDefault(); setActive(step(-1, 1)); }
    else if (k === 'End') { e.preventDefault(); setActive(step(options.length, -1)); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(active); }
    else if (k.length === 1) {
      const now = Date.now(); const t = typed.current;
      t.q = (now - t.t > 600 ? '' : t.q) + k.toLowerCase(); t.t = now;
      const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(t.q));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <div className={`relative block ${className}`}>
      <span id={`${id}-l`} className={hideLabel ? 'sr-only' : 'mb-1 block text-xs font-medium text-slate-500'} onClick={() => btn.current?.focus()}>{label}</span>
      {I && <I className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />}
      <button ref={btn} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-lb` : undefined}
        aria-labelledby={`${id}-l ${id}-v`} onClick={() => (open ? hide() : show())} onKeyDown={onKey}
        className={`input flex w-full cursor-pointer items-center pr-8 text-left disabled:cursor-not-allowed ${open ? 'border-brand/60 ring-2 ring-brand/15' : ''} ${triggerClassName}`}>
        {/* Like a native <select>, size to the widest option: every label shares one grid cell, only the current one shows. */}
        <span className="grid min-w-0">
          {options.map((o, i) => <span key={o.value} id={i === sel ? `${id}-v` : undefined} aria-hidden={i !== sel || undefined}
            className={`col-start-1 row-start-1 truncate ${i === sel ? '' : 'invisible'}`}>{o.label}</span>)}
          {!current && <span className="col-start-1 row-start-1">{'\u00a0'}</span>}
        </span>
      </button>
      <ChevronDown className={`pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''} ${hideLabel ? 'top-1/2 -translate-y-1/2' : 'bottom-2.5'}`} aria-hidden />
      {open && pos && createPortal(
        <ul ref={list} id={`${id}-lb`} role="listbox" aria-labelledby={`${id}-l`} aria-activedescendant={`${id}-o${active}`} tabIndex={-1}
          className={`select-menu fixed z-[55] max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-line bg-white p-1.5 shadow-xl shadow-slate-900/10 ${pos.up ? '-translate-y-full origin-bottom' : 'origin-top'}`}
          style={{ left: pos.left, top: pos.top, minWidth: pos.width }}>
          {options.map((o, i) => {
            const on = i === sel, hot = i === active;
            return (
              <li key={o.value} id={`${id}-o${i}`} data-i={i} role="option" aria-selected={on} aria-disabled={o.disabled || undefined}
                onMouseEnter={() => !o.disabled && setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg py-2 pl-2.5 pr-3 text-sm ${o.disabled ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-navy'} ${hot && !o.disabled ? 'bg-teal-50' : ''} ${on ? 'font-semibold text-brand' : ''}`}>
                <Check className={`h-4 w-4 shrink-0 ${on ? 'text-brand' : 'invisible'}`} aria-hidden />
                {o.label}
              </li>
            );
          })}
        </ul>, document.body)}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className = '' }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: ReactNode; icon?: Icon; count?: number }>; className?: string }) {
  return (
    <div role="tablist" className={`flex flex-wrap gap-1 border-b border-line ${className}`}>
      {tabs.map((t) => {
        const on = t.value === value;
        const I = t.icon;
        return (
          <button key={t.value} role="tab" aria-selected={on} onClick={() => onChange(t.value)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${on ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500 hover:text-navy'}`}>
            {I && <I className="h-4 w-4" aria-hidden />}{t.label}
            {t.count !== undefined && <span className={`rounded-full px-1.5 text-[11px] ${on ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-500'}`}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: Icon }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-white p-0.5 shadow-sm">
      {options.map((o) => {
        const I = o.icon;
        return (
          <button key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${o.value === value ? 'bg-teal-50 text-teal-800 ring-1 ring-teal-200' : 'text-slate-500 hover:text-navy'}`}>
            {I && <I className="h-4 w-4" aria-hidden />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-teal-600' : 'bg-slate-300'}`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

/** Client-side pagination over an already-fetched list (presentation only). */
export function usePaged<T>(rows: T[], pageSize = 25) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(page, pages);
  return { page: p, pages, setPage, slice: rows.slice((p - 1) * pageSize, p * pageSize), total: rows.length, from: rows.length ? (p - 1) * pageSize + 1 : 0, to: Math.min(p * pageSize, rows.length) };
}

export function Pagination({ page, pages, setPage, from, to, total, noun }: { page: number; pages: number; setPage: (n: number) => void; from: number; to: number; total: number; noun: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-slate-500">
      <span>Showing {from}–{to} of {total} {noun}</span>
      <div className="flex items-center gap-1">
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-16 text-center font-medium text-navy">{page} / {pages}</span>
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function Json({ value, collapsed = true, label = 'details' }: { value: unknown; collapsed?: boolean; label?: string }) {
  const [open, setOpen] = useState(!collapsed);
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  return (
    <div>
      <button className="text-xs font-medium text-teal-700 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? `Hide ${label}` : `Show ${label}`}</button>
      {open && <pre className="mono mt-1.5 max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-slate-100">{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}

/** Horizontal meter for a real ratio (e.g. available/on_hand, planned/capacity). */
export function Meter({ value, max, tone = 'teal', label }: { value: number; max: number; tone?: 'teal' | 'amber' | 'rose' | 'sky'; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const c = { teal: 'bg-teal-600', amber: 'bg-amber-500', rose: 'bg-rose-500', sky: 'bg-sky-500' }[tone];
  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${c}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-slate-500">{Math.round(pct)}%</span>
    </div>
  );
}

export const hhmm = (iso?: string | null) => (iso ? iso.slice(11, 16) : '—');
export const dayhhmm = (iso?: string | null) => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : '—');
