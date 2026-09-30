import { useState } from 'react';
import { FlaskConical, Play, PlayCircle, TriangleAlert, CalendarClock, GitMerge, Bug, ShieldCheck, CheckCircle2, XCircle, RotateCcw, Timer } from 'lucide-react';
import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Callout, ErrorBox, LoadingState, PageHeader, ProgressNote, SearchInput, Segmented, Spinner, Select, type Icon } from '../components/ui';

const CATS: Record<string, { label: string; icon: Icon; tile: string; tone: any }> = {
  exception: { label: 'Exceptions', icon: TriangleAlert, tile: 'bg-rose-50 text-rose-600', tone: 'danger' },
  planner: { label: 'Planner', icon: CalendarClock, tile: 'bg-teal-50 text-teal-700', tone: 'brand' },
  integration: { label: 'Integration', icon: GitMerge, tile: 'bg-violet-50 text-violet-600', tone: 'violet' },
  failure: { label: 'Failure handling', icon: Bug, tile: 'bg-amber-50 text-amber-600', tone: 'warning' },
  safety: { label: 'Safety', icon: ShieldCheck, tile: 'bg-sky-50 text-sky-600', tone: 'info' },
};

export default function Scenarios() {
  const { data } = useApi<any[]>('/api/scenarios');
  const meta = useApi<any>('/api/meta');
  const act = useAction();
  const [results, setResults] = useState<Record<string, any>>({});
  const [mode, setMode] = useState<'deterministic' | 'llm'>('deterministic');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const isOp = getRole() === 'operator';
  // Unchanged: real scenario execution on the server (reset → workflows → state checks).
  const run = (id: string) => act.run(id, async () => { const r = await api.post(`/api/scenarios/${id}/run`, { mode }); setResults((x) => ({ ...x, [id]: r })); });
  const runAll = () => act.run('all', async () => {
    const all: any[] = await api.post('/api/scenarios/run-all');
    setResults(Object.fromEntries(all.map((r) => [r.id, r])));
  });
  const groups = ['exception', 'planner', 'integration', 'failure', 'safety'];
  const summary = Object.values(results);
  const llmOn = !!meta.data?.llm?.configured;
  const list = (data ?? []).filter((s) => (!cat || s.category === cat) && (!q || `${s.id} ${s.title} ${s.setup} ${s.expected}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-5">
      <PageHeader icon={FlaskConical} crumb="Scenarios & Tests" illustration="warehouse" title="Scenarios & Tests"
        subtitle="Each scenario RESETS the environment, drives the real workflows, then checks shared state (expected vs actual). Verdicts come from database state, never from agent text."
        actions={<>
          <Select label="Agent mode" className="w-48" value={mode} onChange={(v) => setMode(v as any)} options={[{ value: 'deterministic', label: 'deterministic agent' }, { value: 'llm', label: `LLM agent${llmOn ? '' : ' (no key)'}`, disabled: !llmOn }]} />
          <button className="btn-primary" disabled={!isOp || !!act.busy} onClick={runAll}>{act.busy === 'all' ? <Spinner /> : <PlayCircle className="h-4 w-4" aria-hidden />}{act.busy === 'all' ? 'Running all…' : 'Run all (deterministic)'}</button>
        </>} />
      {act.error && <ErrorBox operation={act.busy === 'all' ? 'Run all scenarios' : 'Run scenario'} msg={act.error} />}
      {!isOp && <Callout tone="warning" icon={TriangleAlert}>Operator role required to run scenarios (they reset the shared environment).</Callout>}
      {act.busy === 'all' && <ProgressNote>Running all {data?.length ?? ''} scenarios — each resets the environment first; the environment is reset to baseline at the end.</ProgressNote>}

      {summary.length > 0 && (
        <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 text-sm" role="status">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden /><b className="text-lg text-navy">{summary.filter((r) => r.verdict === 'PASS').length}/{summary.length}</b> PASS</span>
          <span className="text-slate-600">{summary.reduce((s, r) => s + r.passed, 0)}/{summary.reduce((s, r) => s + r.total, 0)} checks</span>
          {summary.some((r) => r.verdict !== 'PASS') && <span className="flex items-center gap-1 font-semibold text-rose-700"><XCircle className="h-4 w-4" aria-hidden />{summary.filter((r) => r.verdict !== 'PASS').map((r) => r.id).join(', ')}</span>}
          <span className="flex items-center gap-1 text-slate-500"><RotateCcw className="h-3.5 w-3.5" aria-hidden />After “Run all” the environment is reset to baseline.</span>
        </div>
      )}

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <SearchInput className="min-w-56 flex-1" value={q} onChange={setQ} placeholder="Search scenarios…" />
        <Segmented label="Category" value={cat} onChange={setCat} options={[{ value: '', label: 'All' }, ...groups.map((g) => ({ value: g, label: CATS[g].label }))]} />
      </div>

      {!data ? <LoadingState label="Loading scenarios…" rows={5} /> : groups.filter((g) => list.some((s) => s.category === g)).map((g) => {
        const C = CATS[g];
        return (
          <section key={g} className="space-y-3" aria-labelledby={`cat-${g}`}>
            <h2 id={`cat-${g}`} className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500"><C.icon className="h-4 w-4" aria-hidden />{C.label}<span className="font-normal normal-case">({list.filter((s) => s.category === g).length})</span></h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {list.filter((s) => s.category === g).map((s) => {
                const r = results[s.id];
                const verdict = r?.verdict ?? s.last_result?.verdict;
                return (
                  <article key={s.id} className="card flex flex-col overflow-hidden" aria-label={s.id}>
                    <header className="flex items-start gap-3 border-b border-line px-5 py-4">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${C.tile}`}><C.icon className="h-5 w-5" aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><Badge v={C.label.toUpperCase()} tone={C.tone} />{s.exception_id && <span className="font-mono text-xs text-slate-500">{s.exception_id}</span>}</div>
                        <h3 className="mt-1 font-mono text-[15px] font-bold text-navy">{s.id}</h3>
                        <p className="text-[13px] text-slate-500">{s.title}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button className="btn-primary btn-sm" disabled={!isOp || !!act.busy} onClick={() => run(s.id)}>{act.busy === s.id ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" aria-hidden />}{act.busy === s.id ? 'Running…' : 'Run'}</button>
                        {verdict && <Badge v={verdict} dot title={r ? 'this session' : `last run ${s.last_result?.run_at}`} />}
                      </div>
                    </header>
                    <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-1.5 px-5 py-4 text-[13px]">
                      <dt className="text-slate-400">Setup</dt><dd className="text-slate-700">{s.setup}</dd>
                      <dt className="text-slate-400">Trigger</dt><dd className="text-slate-700">{s.trigger}</dd>
                      <dt className="text-slate-400">Expected</dt><dd className="text-slate-700">{s.expected}</dd>
                      <dt className="text-slate-400">Boundary</dt><dd className="text-slate-700">{s.boundary}</dd>
                      <dt className="text-slate-400">Reset</dt><dd className="text-slate-500">Automatic (baseline seed) before the run; or header “Reset environment” / <code className="font-mono">npm run reset</code>.</dd>
                    </dl>
                    {act.busy === s.id && <div className="px-5 pb-4"><ProgressNote>Resetting, running the workflows ({mode}) and checking state…</ProgressNote></div>}
                    {r && (
                      <div className="border-t border-line bg-slate-50/60 px-5 py-4">
                        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          <Badge v={r.verdict} dot /><span>{r.passed}/{r.total} checks</span><span className="inline-flex items-center gap-1"><Timer className="h-3.5 w-3.5" aria-hidden />{r.ms} ms</span><span>mode: {r.mode}</span>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-line bg-white">
                          <table className="tbl">
                            <thead><tr><th>Check</th><th>Expected</th><th>Actual</th><th className="w-8"><span className="sr-only">Pass</span></th></tr></thead>
                            <tbody>{r.checks.map((c: any, i: number) => (
                              <tr key={i}><td className="text-xs">{c.name}</td><td className="font-mono text-xs">{c.expected}</td><td className="font-mono text-xs">{c.actual}</td><td>{c.pass ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="pass" /> : <XCircle className="h-4 w-4 text-rose-600" aria-label="fail" />}</td></tr>
                            ))}</tbody>
                          </table>
                        </div>
                        {r.notes && <div className="mt-2 text-xs text-slate-500">{r.notes}</div>}
                        {r.artifacts?.tool_sequence && <div className="mt-2 font-mono text-[11px] text-slate-500">tools: {r.artifacts.tool_sequence}</div>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
