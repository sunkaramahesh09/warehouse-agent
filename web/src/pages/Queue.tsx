import { useState } from 'react';
import { ClipboardCheck, FileCheck2, MessageSquareWarning, CircleCheck, CircleX, Hourglass, History, Info, TriangleAlert } from 'lucide-react';
import { useApi } from '../hooks';
import { Badge, Callout, Chip, EmptyState, LoadingState, PageHeader, SearchInput, SectionCard, StatCard, Tabs, dayhhmm } from '../components/ui';
import ApprovalCard from '../components/ApprovalCard';
import EscalationCard from '../components/EscalationCard';

export default function Queue() {
  const approvals = useApi<any[]>('/api/approvals');
  const escalations = useApi<any[]>('/api/escalations');
  const policies = useApi<any[]>('/api/policies');
  const [aTab, setATab] = useState<'pending' | 'history'>('pending');
  const [eTab, setETab] = useState<'open' | 'resolved'>('open');
  const [aq, setAq] = useState('');
  const [eq, setEq] = useState('');

  const A = approvals.data ?? [];
  const E = escalations.data ?? [];
  const pending = A.filter((a) => ['PENDING', 'APPROVED'].includes(a.status));
  const decided = A.filter((a) => !['PENDING', 'APPROVED'].includes(a.status));
  const open = E.filter((e) => e.status === 'OPEN');
  const closed = E.filter((e) => e.status !== 'OPEN');
  const count = (s: string) => A.filter((a) => a.status === s).length;
  const matchA = (a: any) => !aq || [a.approval_id, a.exception_id, a.order_id, a.action_type, a.reason].join(' ').toLowerCase().includes(aq.toLowerCase());
  const matchE = (e: any) => !eq || [e.escalation_id, e.exception_id, e.order_id, e.type, e.payload?.detected_issue].join(' ').toLowerCase().includes(eq.toLowerCase());
  // Guidance comes from the live shared SOP (SOP-APR-001 params), not hard-coded text.
  const apr = (policies.data ?? []).find((p) => p.policy_id === 'SOP-APR-001');

  return (
    <div className="space-y-5">
      <PageHeader photo="queue" icon={ClipboardCheck} crumb="Approvals & Escalations" title="Approvals & Escalations"
        subtitle="Operators approve or reject proposed actions (nothing executes without it). Exception Reviewers resolve escalations. Switch role in the header." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={FileCheck2} tone="fuchsia" label="Pending approvals" value={pending.length} hint={count('APPROVED') ? `${count('APPROVED')} approved, awaiting execution` : undefined} />
        <StatCard icon={MessageSquareWarning} tone="orange" label="Open escalations" value={open.length} />
        <StatCard icon={CircleCheck} tone="emerald" label="Approved & executed" value={count('EXECUTED')} />
        <StatCard icon={CircleX} tone="rose" label="Rejected" value={count('REJECTED')} />
        <StatCard icon={Hourglass} tone="slate" label="Expired" value={count('EXPIRED')} hint="Not received in time" />
        <StatCard icon={History} tone="teal" label="Escalations resolved" value={closed.length} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard icon={FileCheck2} title={`Pending approvals (${pending.length})`} subtitle="Operator decisions — separate, explicit input">
          <Tabs value={aTab} onChange={setATab} className="-mt-1 mb-4" tabs={[{ value: 'pending', label: 'Pending', count: pending.length }, { value: 'history', label: 'Decided', count: decided.length }]} />
          <SearchInput className="mb-4" value={aq} onChange={setAq} placeholder="Search approvals…" />
          {!approvals.data ? <LoadingState label="Loading approvals…" /> : aTab === 'pending' ? (
            pending.filter(matchA).length ? <div className="space-y-3">{pending.filter(matchA).map((a) => <ApprovalCard key={a.approval_id} a={a} />)}</div> : (
              <>
                <EmptyState illustration="check" title="No pending approvals">When the agent proposes an approval-gated action it appears here. Nothing executes without operator approval.</EmptyState>
                <Callout tone="info" icon={Info} title={<>What requires approval? <span className="font-mono text-xs font-normal">({apr?.policy_id ?? 'SOP-APR-001'})</span></>}>
                  {apr ? (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap gap-1">{apr.params.approval_required.map((x: string) => <Chip key={x} tone="fuchsia">{x}</Chip>)}</div>
                      <div className="text-xs">Autonomous: {apr.params.autonomous.join(', ')} · Prohibited for agents: {apr.params.prohibited.join(', ')} · Approvals expire after {apr.params.approval_ttl_minutes} simulated minutes.</div>
                    </div>
                  ) : 'Loading policy…'}
                </Callout>
              </>
            )
          ) : decided.filter(matchA).length === 0 ? <EmptyState compact illustration="empty" title="No decided approvals yet" /> : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="tbl">
                <thead><tr><th>Approval</th><th>Action</th><th>Order</th><th>Status</th><th>Decided by</th><th>At (sim)</th></tr></thead>
                <tbody>{decided.filter(matchA).map((a) => <tr key={a.approval_id}><td className="font-mono text-xs">{a.approval_id}</td><td className="font-medium text-navy">{a.action_type.replace(/_/g, ' ')}</td><td className="font-mono">{a.params?.order_id}</td><td><Badge v={a.status} /></td><td>{a.decided_by ?? '—'}</td><td className="font-mono text-xs">{dayhhmm(a.decided_at ?? a.expires_at)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard icon={MessageSquareWarning} title={`Open escalations (${open.length})`} subtitle="Exception Reviewer queue — structured payloads">
          <Tabs value={eTab} onChange={setETab} className="-mt-1 mb-4" tabs={[{ value: 'open', label: 'Open', count: open.length }, { value: 'resolved', label: 'Resolved', count: closed.length }]} />
          <SearchInput className="mb-4" value={eq} onChange={setEq} placeholder="Search escalations…" />
          {!escalations.data ? <LoadingState label="Loading escalations…" /> : eTab === 'open' ? (
            open.filter(matchE).length ? <div className="space-y-3">{open.filter(matchE).map((e) => <EscalationCard key={e.escalation_id} e={e} compact />)}</div> : (
              <>
                <EmptyState illustration="people" title="No open escalations">Escalations appear when the agent cannot safely resolve an exception.</EmptyState>
                <Callout tone="warning" icon={TriangleAlert} title="When does the resolver escalate?">
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li>Authoritative records conflict or the case is ambiguous (SOP-EXC-005, SOP-SOT-002)</li>
                    <li>Malformed or missing data — never auto-corrected (SOP-EXC-003)</li>
                    <li>Stale shipments with no carrier scan (SOP-EXC-004)</li>
                    <li>Confirmed shortfall needing recount / replenishment (SOP-EXC-001)</li>
                    <li>An approval is rejected or expires (SOP-APR-001)</li>
                    <li>Evidence incomplete or a required policy was not retrieved (guard)</li>
                  </ul>
                </Callout>
              </>
            )
          ) : closed.filter(matchE).length === 0 ? <EmptyState compact illustration="empty" title="No resolved escalations yet" /> : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="tbl">
                <thead><tr><th>Escalation</th><th>Exception</th><th>Resolved by</th><th>Note</th></tr></thead>
                <tbody>{closed.filter(matchE).map((e) => <tr key={e.escalation_id}><td className="font-mono text-xs">{e.escalation_id}</td><td className="font-mono">{e.exception_id}</td><td>{e.resolved_by}</td><td className="text-xs">{e.resolution_note}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
