import { useApi } from '../hooks';
import { Badge, Card, Empty, PageHeader, dayhhmm } from '../components/ui';
import ApprovalCard from '../components/ApprovalCard';
import EscalationCard from '../components/EscalationCard';

export default function Queue() {
  const approvals = useApi<any[]>('/api/approvals');
  const escalations = useApi<any[]>('/api/escalations');
  const pending = (approvals.data ?? []).filter((a) => ['PENDING', 'APPROVED'].includes(a.status));
  const decided = (approvals.data ?? []).filter((a) => !['PENDING', 'APPROVED'].includes(a.status));
  const open = (escalations.data ?? []).filter((e) => e.status === 'OPEN');
  const closed = (escalations.data ?? []).filter((e) => e.status !== 'OPEN');
  return (
    <div className="space-y-4">
      <PageHeader title="Approvals & escalations" subtitle="Operators approve or reject proposed actions (nothing executes without it). Exception Reviewers resolve escalations. Switch role in the header." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`Pending approvals (${pending.length})`}>
          <div className="space-y-3">{pending.map((a) => <ApprovalCard key={a.approval_id} a={a} />)}{!pending.length && <Empty>No proposals waiting.</Empty>}</div>
          {decided.length > 0 && (
            <table className="tbl mt-4">
              <thead><tr><th>Approval</th><th>Action</th><th>Order</th><th>Status</th><th>Decided by</th><th>At (sim)</th></tr></thead>
              <tbody>{decided.map((a) => <tr key={a.approval_id}><td className="mono">{a.approval_id}</td><td>{a.action_type}</td><td className="mono">{a.params?.order_id}</td><td><Badge v={a.status} /></td><td>{a.decided_by ?? '—'}</td><td className="mono">{dayhhmm(a.decided_at ?? a.expires_at)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
        <Card title={`Open escalations (${open.length})`}>
          <div className="space-y-3">{open.map((e) => <EscalationCard key={e.escalation_id} e={e} compact />)}{!open.length && <Empty>No open escalations.</Empty>}</div>
          {closed.length > 0 && (
            <table className="tbl mt-4">
              <thead><tr><th>Escalation</th><th>Exception</th><th>Resolved by</th><th>Note</th></tr></thead>
              <tbody>{closed.map((e) => <tr key={e.escalation_id}><td className="mono">{e.escalation_id}</td><td className="mono">{e.exception_id}</td><td>{e.resolved_by}</td><td className="text-xs">{e.resolution_note}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
