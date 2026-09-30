import { useState } from 'react';
import { BookOpen, ShieldCheck, TriangleAlert, FileCheck2, CalendarClock, Database, Copy, Check, ChevronDown, LayoutGrid, List, Tags } from 'lucide-react';
import { useApi } from '../hooks';
import { Badge, Chip, EmptyState, LoadingState, PageHeader, SearchInput, Segmented, Select, type Icon } from '../components/ui';

// Category is derived from the policy id prefix (display only; policy content is shown verbatim).
const CAT: Record<string, { label: string; icon: Icon; tile: string; tone: any }> = {
  SOT: { label: 'Source of truth', icon: Database, tile: 'bg-sky-50 text-sky-600', tone: 'info' },
  EXC: { label: 'Exception handling', icon: TriangleAlert, tile: 'bg-rose-50 text-rose-600', tone: 'danger' },
  APR: { label: 'Approvals', icon: FileCheck2, tile: 'bg-fuchsia-50 text-fuchsia-600', tone: 'fuchsia' },
  PLN: { label: 'Planning', icon: CalendarClock, tile: 'bg-teal-50 text-teal-700', tone: 'brand' },
};
const catOf = (id: string) => id.split('-')[1] ?? '';

export default function Policies() {
  const { data, error } = useApi<any[]>('/api/policies');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const all = data ?? [];
  const rows = all.filter((p) => (!cat || catOf(p.policy_id) === cat) &&
    (!q || [p.policy_id, p.title, p.rule, ...(p.keywords ?? [])].join(' ').toLowerCase().includes(q.toLowerCase())));
  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={BookOpen} crumb="Policies (SOP)" illustration="warehouse" title="Shared SOP / policy store"
        subtitle={<>One source (policies table, seeded from <span className="font-mono">sop.json</span>). Both workflows retrieve from it via <span className="font-mono text-teal-800">search_policies</span> / <span className="font-mono text-teal-800">get_policy</span>, and read their parameters from it.</>} />

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <SearchInput className="min-w-56 flex-1" value={q} onChange={setQ} placeholder="Search policy id, title, rule text, keywords…" />
        <Select label="Category" className="w-52" value={cat} onChange={setCat} options={[{ value: '', label: 'All categories' }, ...Object.entries(CAT).map(([k, c]) => ({ value: k, label: c.label }))]} />
        <Segmented label="Layout" value={layout} onChange={setLayout} options={[{ value: 'grid', label: 'Grid', icon: LayoutGrid }, { value: 'list', label: 'List', icon: List }]} />
        <span className="text-xs text-slate-500">{rows.length} of {all.length} policies</span>
      </div>

      {!data ? (error ? <div className="text-sm text-rose-700">Could not load policies: {error}</div> : <LoadingState label="Loading shared SOP…" rows={4} />) : rows.length === 0 ? (
        <div className="card"><EmptyState illustration="shield" title="No policies match">Try a different keyword or category.</EmptyState></div>
      ) : (
        <div className={layout === 'grid' ? 'grid items-start gap-4 xl:grid-cols-2' : 'space-y-3'}>
          {rows.map((p) => {
            const c = CAT[catOf(p.policy_id)] ?? { label: 'Other', icon: ShieldCheck, tile: 'bg-slate-100 text-slate-600', tone: 'neutral' };
            const isOpen = !!open[p.policy_id];
            const params = JSON.stringify(p.params);
            const hasParams = Object.keys(p.params ?? {}).length > 0;
            return (
              <article key={p.policy_id} className="card flex flex-col p-5" aria-labelledby={`pol-${p.policy_id}`}>
                <header className="flex items-start gap-3">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${c.tile}`}><c.icon className="h-5 w-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[15px] font-bold text-navy">{p.policy_id}</div>
                    <h2 id={`pol-${p.policy_id}`} className="text-[15px] font-semibold leading-snug text-navy">{p.title}</h2>
                  </div>
                  <Badge v={c.label.toUpperCase()} tone={c.tone} />
                </header>
                <p className={`mt-3 text-[13.5px] leading-relaxed text-slate-700 ${isOpen ? '' : 'line-clamp-4'}`}>{p.rule}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-semibold uppercase tracking-wide text-slate-400">Applies to</span>
                  {p.applies_to.map((a: string) => <Chip key={a} tone="brand">{a}</Chip>)}
                </div>
                {hasParams && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-line">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="label-xs">params (machine-readable)</span>
                      <button className="btn-ghost btn-sm" onClick={() => copy(p.policy_id, params)} aria-label={`Copy ${p.policy_id} params`}>
                        {copied === p.policy_id ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}{copied === p.policy_id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className={`overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-700 ${isOpen ? '' : 'line-clamp-3'}`}>{isOpen ? JSON.stringify(p.params, null, 2) : params}</pre>
                  </div>
                )}
                {isOpen && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-slate-400"><Tags className="h-3 w-3" aria-hidden />Retrieval keywords</span>
                    {p.keywords.map((k: string) => <Chip key={k} mono={false}>{k}</Chip>)}
                  </div>
                )}
                <div className="mt-auto pt-3">
                  <button className="btn-ghost btn-sm -ml-2" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [p.policy_id]: !isOpen }))}>
                    <ChevronDown className={`h-3.5 w-3.5 transition ${isOpen ? 'rotate-180' : ''}`} aria-hidden />{isOpen ? 'Show less' : 'View full policy'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
