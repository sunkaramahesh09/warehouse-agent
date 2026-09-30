/** Evidence ledger: every tool call made during one resolver run, in order. */
import type { ToolResult } from '../../tools/framework.js';

export interface LedgerEntry {
  n: number;
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  data?: any;
  error?: { code: string; message: string };
  selected_by: 'llm' | 'deterministic' | 'orchestrator';
  summary: string;
  audit_seq?: number;
}

export const keyOf = (tool: string, input: Record<string, unknown>) =>
  `${tool}:${Object.keys(input).sort().map((k) => String(input[k])).join(',')}`;

export class Ledger {
  entries: LedgerEntry[] = [];

  record(tool: string, input: Record<string, unknown>, r: ToolResult, selected_by: LedgerEntry['selected_by']): LedgerEntry {
    const e: LedgerEntry = {
      n: this.entries.length + 1,
      tool,
      input,
      ok: r.success,
      data: r.success ? r.data : undefined,
      error: r.success ? undefined : { code: r.error.code, message: r.error.message },
      selected_by,
      summary: summarize(tool, input, r),
      audit_seq: r.auditSeq,
    };
    this.entries.push(e);
    return e;
  }

  has(tool: string, input: Record<string, unknown>) {
    const k = keyOf(tool, input);
    return this.entries.some((e) => keyOf(e.tool, e.input) === k);
  }

  /** Latest successful result for tool+input. */
  get<T = any>(tool: string, input: Record<string, unknown>): T | undefined {
    const k = keyOf(tool, input);
    return [...this.entries].reverse().find((e) => e.ok && keyOf(e.tool, e.input) === k)?.data as T | undefined;
  }

  failed(tool: string, input: Record<string, unknown>) {
    const k = keyOf(tool, input);
    return [...this.entries].reverse().find((e) => keyOf(e.tool, e.input) === k && !e.ok);
  }

  /** Policy ids actually returned by retrieval tools in this run (the only citable ones). */
  retrievedPolicies(): Map<string, { title: string; excerpt: string }> {
    const m = new Map<string, { title: string; excerpt: string }>();
    for (const e of this.entries) {
      if (!e.ok) continue;
      if (e.tool === 'search_policies') for (const h of e.data.hits) m.set(h.policy_id, { title: h.title, excerpt: h.excerpt });
      if (e.tool === 'get_policy') m.set(e.data.policy_id, { title: e.data.title, excerpt: e.data.rule });
    }
    return m;
  }
}

function summarize(tool: string, input: Record<string, unknown>, r: ToolResult): string {
  if (!r.success) return `${tool}(${Object.values(input).join(', ')}) → ${r.error.code}: ${r.error.message}`;
  const d: any = r.data;
  switch (tool) {
    case 'get_exception': return `${d.exception_id} ${d.type} on ${d.order_id} (status ${d.status})`;
    case 'get_order': return `${d.order_id}: status ${d.status}, P${d.priority}, deadline ${d.deadline}, dest ${d.destination_ref}, shipments [${d.linked_shipment_ids.join(', ')}]`;
    case 'get_order_lines': return `${d.lines.length} line(s): ${d.lines.map((l: any) => `${l.sku} ${l.picked_qty}/${l.requested_qty}`).join(', ')}${d.data_issues.length ? `; ${d.data_issues.length} data issue(s)` : ''}`;
    case 'get_inventory': return d.availability ? `${d.sku.sku}: system available ${d.availability.system_available}, effective ${d.availability.effective_available} (${d.availability.basis})` : `${d.sku.sku}: ${d.warning}`;
    case 'get_shipment': return `${d.shipment.shipment_id}: ${d.shipment.status}, dest ${d.shipment.destination_ref}, pickup scan ${d.shipment.picked_up_at ?? 'none'}${d.facts ? `, label age ${d.facts.label_age_hours}h` : ''}`;
    case 'find_shipments_for_order': return `${d.shipments.length} shipment(s) linked to ${d.order_id}`;
    case 'find_orders_by_destination': return `${d.destination_ref}: orders [${d.orders.map((o: any) => o.order_id).join(', ')}], shipments [${d.shipments.map((s: any) => `${s.shipment_id}→${s.order_id}`).join(', ')}]`;
    case 'find_duplicate_orders': return `${d.candidates.filter((c: any) => c.probable_duplicate).length} probable duplicate(s) among ${d.candidates.length} same-customer order(s)`;
    case 'search_policies': return d.hits.length ? `hits: ${d.hits.map((h: any) => h.policy_id).join(', ')}` : 'no applicable policy found (policy gap)';
    case 'get_policy': return `${d.policy_id} "${d.title}"`;
    default: return 'ok';
  }
}
