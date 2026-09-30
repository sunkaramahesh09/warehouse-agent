import { useApi } from '../hooks';
import { Card, PageHeader } from '../components/ui';

export default function Policies() {
  const { data } = useApi<any[]>('/api/policies');
  return (
    <div className="space-y-4">
      <PageHeader title="Shared SOP / policy store" subtitle="One source (policies table, seeded from sop.json). Both workflows retrieve from it via search_policies / get_policy, and read their parameters from it." />
      <div className="grid gap-3 lg:grid-cols-2">
        {(data ?? []).map((p) => (
          <Card key={p.policy_id} title={<><span className="font-mono">{p.policy_id}</span> — {p.title}</>}>
            <p className="text-sm text-slate-700">{p.rule}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>applies to: {p.applies_to.join(', ')}</span>
              {Object.keys(p.params).length > 0 && <span className="mono rounded bg-slate-100 px-1.5">params {JSON.stringify(p.params)}</span>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
