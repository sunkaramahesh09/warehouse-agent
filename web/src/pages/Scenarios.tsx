import { useState } from 'react';
import { api, getRole } from '../api';
import { useApi, useAction } from '../hooks';
import { Badge, Card, ErrorBox, PageHeader } from '../components/ui';

export default function Scenarios() {
  const { data } = useApi<any[]>('/api/scenarios');
  const meta = useApi<any>('/api/meta');
  const act = useAction();
  const [results, setResults] = useState<Record<string, any>>({});
  const [mode, setMode] = useState<'deterministic' | 'llm'>('deterministic');
  const isOp = getRole() === 'operator';
  const run = (id: string) => act.run(id, async () => { const r = await api.post(`/api/scenarios/${id}/run`, { mode }); setResults((x) => ({ ...x, [id]: r })); });
  const runAll = () => act.run('all', async () => {
    const all: any[] = await api.post('/api/scenarios/run-all');
    setResults(Object.fromEntries(all.map((r) => [r.id, r])));
  });
  const groups = ['exception', 'planner', 'integration', 'failure', 'safety'];
  const summary = Object.values(results);
  return (
    <div className="space-y-4">
      <PageHeader title="Scenarios & tests" subtitle="Each scenario RESETS the environment, drives the real workflows, then checks shared state (expected vs actual). Verdicts come from database state, never from agent text."
        actions={<>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="deterministic">deterministic agent</option>
            <option value="llm" disabled={!meta.data?.llm?.configured}>LLM agent {meta.data?.llm?.configured ? '' : '(no key)'}</option>
          </select>
          <button className="btn-primary" disabled={!isOp || !!act.busy} onClick={runAll}>{act.busy === 'all' ? 'Running all…' : 'Run all (deterministic)'}</button>
        </>} />
      <ErrorBox msg={act.error} />
      {!isOp && <div className="text-sm text-slate-500">Operator role required to run scenarios.</div>}
      {summary.length > 0 && (
        <div className="card flex flex-wrap gap-4 px-4 py-3 text-sm">
          <b>{summary.filter((r) => r.verdict === 'PASS').length}/{summary.length} PASS</b>
          <span>{summary.reduce((s, r) => s + r.passed, 0)}/{summary.reduce((s, r) => s + r.total, 0)} checks</span>
          <span className="text-slate-500">After “Run all” the environment is reset to baseline.</span>
        </div>
      )}
      {groups.map((g) => (
        <div key={g} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{g}</h2>
          <div className="grid gap-3 xl:grid-cols-2">
            {(data ?? []).filter((s) => s.category === g).map((s) => {
              const r = results[s.id];
              return (
                <Card key={s.id} title={<><span className="font-mono">{s.id}</span> — {s.title}</>}
                  actions={<>{(r?.verdict ?? s.last_result?.verdict) && <Badge v={r?.verdict ?? s.last_result?.verdict} title={r ? 'this session' : `last run ${s.last_result?.run_at}`} />}
                    <button className="btn-secondary py-1" disabled={!isOp || !!act.busy} onClick={() => run(s.id)}>{act.busy === s.id ? 'Running…' : 'Run'}</button></>}>
                  <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 text-xs">
                    <dt className="text-slate-500">Setup</dt><dd>{s.setup}</dd>
                    <dt className="text-slate-500">Trigger</dt><dd>{s.trigger}</dd>
                    <dt className="text-slate-500">Expected</dt><dd>{s.expected}</dd>
                    <dt className="text-slate-500">Boundary</dt><dd>{s.boundary}</dd>
                    <dt className="text-slate-500">Reset</dt><dd>Automatic (baseline seed) before the run; or header “Reset environment” / <code>npm run reset</code>.</dd>
                  </dl>
                  {r && (
                    <table className="tbl mt-3">
                      <thead><tr><th>Check</th><th>Expected</th><th>Actual</th><th /></tr></thead>
                      <tbody>{r.checks.map((c: any, i: number) => <tr key={i}><td className="text-xs">{c.name}</td><td className="mono">{c.expected}</td><td className="mono">{c.actual}</td><td>{c.pass ? '✅' : '❌'}</td></tr>)}</tbody>
                    </table>
                  )}
                  {r?.artifacts?.tool_sequence && <div className="mono mt-2 text-slate-500">tools: {r.artifacts.tool_sequence}</div>}
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
