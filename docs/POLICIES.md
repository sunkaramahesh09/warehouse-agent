# Shared Policy / SOP Set

**Single source:** `server/src/policy/sop.json`, loaded into the `policies` table on reset. Both workflows use the **same** retrieval tools (`search_policies` keyword scoring, `get_policy` by id) and read their numeric parameters from the same records (`params`). No workflow has a private copy of any rule.

- **Retrieval:** deterministic keyword/phrase scoring (`server/src/policy/retrieval.ts`). Each keyword hit scores 3, a title-token hit 2, and a rule-token hit 1. The excerpt returned is the rule sentence with the most query-term hits. An empty result is surfaced as `policy_gap: true`.
- **Citation rule:** a decision may cite only policy ids that were **returned by a retrieval tool in the same run**. The guard rejects anything else (see the `unsafe-llm-proposal` scenario). Every action tool also refuses a `policy_id` that does not exist (`POLICY_NOT_FOUND`).
- **Policy gap:** if a required policy was never retrieved, the guard escalates instead of acting.

| ID | Title | Applies to | Parameters |
|---|---|---|---|
| SOP-SOT-001 | Inventory source of truth | exception_resolver, shift_planner | — |
| SOP-SOT-002 | Shipment and order-status source of truth | exception_resolver | `{"forward_sync_requires": ["pickup_scan", "all_lines_picked", "destination_match"]}` |
| SOP-EXC-001 | Inventory shortfall handling | exception_resolver, shift_planner | — |
| SOP-EXC-002 | Duplicate orders | exception_resolver | `{"duplicate_window_minutes": 30}` |
| SOP-EXC-003 | Invalid or malformed data | exception_resolver, shift_planner | — |
| SOP-EXC-004 | Stale shipments | exception_resolver | `{"stale_after_hours": 48}` |
| SOP-EXC-005 | Conflicting or ambiguous records | exception_resolver | — |
| SOP-APR-001 | Action authority and approvals | exception_resolver, shift_planner | `{"autonomous": ["HOLD_ORDER", "SYNC_ORDER_STATUS_FORWARD", "CREATE_ESCALATION", "REQUEST_APPROVAL"], "approval_required": ["CANCEL_ORDER", "RELINK_SHIPMENT", "ADJUST_INVENTORY", "RELEASE_HOLD"], "prohibited": ["DELETE_ORDER", "MERGE_ORDERS", "BACKWARD_STATUS_CHANGE"], "approval_ttl_minutes": 120}` |
| SOP-PLN-001 | Planning eligibility and prioritization | shift_planner | `{"urgency_bucket_minutes": [120, 240], "plannable_statuses": ["PENDING", "PICKING"]}` |
| SOP-PLN-002 | Capacity, skills and inventory constraints | shift_planner, exception_resolver | `{"minutes_per_location": 2, "minutes_per_extra_zone": 3}` |
| SOP-PLN-003 | Replanning | shift_planner | — |

## SOP-SOT-001 — Inventory source of truth

> The inventory table is the system of record for stock; available = on_hand - reserved. A physical cycle count that is newer than the inventory record's last_updated supersedes system on_hand for exception decisions: the resolver treats the lower, counted value as the effective available quantity. Discrepancies are reconciled through the exception process (hold the affected order and escalate), and the planner consumes the result through the order hold rather than by reading raw counts. Agents must never increase stock, invent stock, or change on_hand; correcting on_hand is an inventory adjustment that requires human approval.

- **Applies to:** exception_resolver, shift_planner
- **Retrieval keywords:** inventory, stock, on_hand, available, reserved, cycle count, count, mismatch, source of truth, shortfall, shortage
- **Where it is enforced:** Resolver: `get_inventory` computes effective availability (count vs system). Assessment for INVENTORY_SHORTFALL. Planner consumes the outcome via the order hold.

## SOP-SOT-002 — Shipment and order-status source of truth

> Carrier scan events (pickup scan, last scan) are authoritative for physical shipment movement. A shipment record or shipping label alone is NOT evidence that an order shipped. An order may be moved forward to SHIPPED only when ALL of the following hold: (a) the linked shipment has a carrier pickup scan, (b) every order line is fully picked, (c) the shipment destination equals the order destination. When all three hold, a forward status sync is a permitted autonomous correction. Order status must never be moved backwards by an agent.

- **Applies to:** exception_resolver
- **Retrieval keywords:** shipment, shipped, status, desync, desynchronization, carrier, scan, label, packed, in transit, sync, mismatch
- **Machine-readable params:** `{"forward_sync_requires": ["pickup_scan", "all_lines_picked", "destination_match"]}`
- **Where it is enforced:** Resolver: the three forward-sync conditions are checked in the assessment AND re-checked inside `sync_order_status` (defense in depth). Contradictory cases escalate.

## SOP-EXC-001 — Inventory shortfall handling

> When confirmed available stock (per SOP-SOT-001) is below the remaining quantity of an order line, place the order ON_HOLD with the exception as the blocking reference. Holding is reversible and may be done autonomously. Do not reduce requested quantities, do not partially ship, and do not reallocate stock from other orders. Escalate to inventory control for recount or replenishment. The planner must not schedule a held order.

- **Applies to:** exception_resolver, shift_planner
- **Retrieval keywords:** inventory, shortfall, shortage, insufficient, stock, hold, blocked, replenishment, not ready
- **Where it is enforced:** Resolver: hold + escalation on confirmed shortfall. Planner: held orders are BLOCKED with the exception reference.

## SOP-EXC-002 — Duplicate orders

> Two orders are probable duplicates when they share customer_ref and destination_ref, have identical line items (sku and quantity), and were created within 30 minutes of each other. The later order is the suspected duplicate. It may be placed ON_HOLD autonomously so it is not picked. Cancelling or merging either order requires explicit operator approval; an agent must never cancel, merge or delete an order on its own.

- **Applies to:** exception_resolver
- **Retrieval keywords:** duplicate, near-duplicate, same customer, double order, cancel, merge, repeat
- **Machine-readable params:** `{"duplicate_window_minutes": 30}`
- **Where it is enforced:** `find_duplicate_orders` reads `duplicate_window_minutes` from this record. Resolver holds the later order and requests approval for CANCEL_ORDER.

## SOP-EXC-003 — Invalid or malformed data

> Records with impossible values (non-positive requested quantity, picked quantity above requested, created_at after deadline, unknown status) must never be silently corrected, because the intended value is unknown. Place the affected order ON_HOLD and escalate with the exact fields and values. The planner treats such orders as blocked even if no exception has been raised.

- **Applies to:** exception_resolver, shift_planner
- **Retrieval keywords:** invalid, malformed, negative, quantity, timestamp, corrupt, data quality, impossible, validation
- **Where it is enforced:** Shared `validateOrderData()` is used by the resolver (to describe the issues) and by the planner (as a hard gate). Nothing is auto-corrected.

## SOP-EXC-004 — Stale shipments

> A shipment in LABEL_CREATED with no carrier scan for more than 48 hours is stale. The agent has no carrier integration, so it must not change order or shipment status, must not re-label, and must escalate to the carrier liaison with the label age and tracking reference.

- **Applies to:** exception_resolver
- **Retrieval keywords:** stale, no movement, label, carrier, delay, stuck, aging, no scan
- **Machine-readable params:** `{"stale_after_hours": 48}`
- **Where it is enforced:** Resolver calls `get_policy(SOP-EXC-004)` to read `stale_after_hours` (48) at run time.

## SOP-EXC-005 — Conflicting or ambiguous records

> When authoritative records conflict and no policy establishes which one wins (for example, an order destination that differs from its linked shipment destination, or a shipment that appears to belong to a different order), preserve all current values, place the affected unshipped order ON_HOLD, and escalate with the conflicting facts and the questions a human must answer. Relinking shipments or changing destinations requires approval and must not be proposed while the correct target is uncertain.

- **Applies to:** exception_resolver
- **Retrieval keywords:** conflict, conflicting, ambiguous, destination, address, wrong order, linked, link, mismatch, contradictory, unclear
- **Where it is enforced:** Resolver: ambiguous destination/link. Hold and escalate with unresolved questions. RELINK is deliberately not proposed.

## SOP-APR-001 — Action authority and approvals

> Agents may autonomously: hold an order, perform a forward status sync that satisfies SOP-SOT-002, create an escalation, and request approval. The following require explicit approval from an Operator before execution: cancel order, relink shipment, adjust inventory, release a hold. The following are prohibited for agents: delete order, merge orders, move status backwards. Approvals expire after 120 simulated minutes; an expired or rejected proposal is never executed and the exception is escalated.

- **Applies to:** exception_resolver, shift_planner
- **Retrieval keywords:** approval, approve, authority, autonomous, permission, cancel, confirm, boundary, prohibited, allowed
- **Machine-readable params:** `{"autonomous": ["HOLD_ORDER", "SYNC_ORDER_STATUS_FORWARD", "CREATE_ESCALATION", "REQUEST_APPROVAL"], "approval_required": ["CANCEL_ORDER", "RELINK_SHIPMENT", "ADJUST_INVENTORY", "RELEASE_HOLD"], "prohibited": ["DELETE_ORDER", "MERGE_ORDERS", "BACKWARD_STATUS_CHANGE"], "approval_ttl_minutes": 120}`
- **Where it is enforced:** Machine-readable `autonomous / approval_required / prohibited` lists are read by the guard AND by every action tool. `approval_ttl_minutes` drives approval expiry.

## SOP-PLN-001 — Planning eligibility and prioritization

> Only PENDING and PICKING orders are plannable. ON_HOLD orders are shown as BLOCKED with their exception reference; orders with invalid data or insufficient available inventory are BLOCKED. Orders already being picked keep their picker. Remaining orders are ordered by: (1) deadline urgency bucket (due within 2h, within 4h, within the shift, after the shift; overdue counts as most urgent), (2) explicit priority (1 highest), (3) earlier deadline, (4) earlier creation, (5) order id. Inventory is allocated to orders in this order.

- **Applies to:** shift_planner
- **Retrieval keywords:** planning, priority, prioritization, sla, deadline, urgency, eligible, sequence, plan, order
- **Machine-readable params:** `{"urgency_bucket_minutes": [120, 240], "plannable_statuses": ["PENDING", "PICKING"]}`
- **Where it is enforced:** Planner reads `urgency_bucket_minutes` and `plannable_statuses`. Implements the sort key.

## SOP-PLN-002 — Capacity, skills and inventory constraints

> Work may only be assigned to AVAILABLE pickers who hold every skill the order's SKUs require. A picker's assigned workload may never exceed capacity_minutes. Orders are not split across pickers. Workload is remaining units times pick minutes per unit, plus 2 minutes per distinct location and 3 minutes per additional zone. Among feasible pickers prefer one who finishes before the deadline, then the earliest finish, then the nearest zone. If a picker has capacity but no picker can meet the deadline, assign and flag SLA risk. If no picker has capacity or skill, mark the order INFEASIBLE with the reason. Inventory is re-checked when an assignment is dispatched.

- **Applies to:** shift_planner, exception_resolver
- **Retrieval keywords:** capacity, picker, workload, skill, cold, bulky, assignment, feasible, infeasible, location, zone, proximity
- **Machine-readable params:** `{"minutes_per_location": 2, "minutes_per_extra_zone": 3}`
- **Where it is enforced:** Planner reads `minutes_per_location` / `minutes_per_extra_zone`. Capacity/skill/inventory are hard constraints. Dispatch re-checks inventory.

## SOP-PLN-003 — Replanning

> Replanning is incremental. Completed assignments are never changed. In-progress assignments stay with their picker if that picker is still available; if not, picked quantities are preserved and only the remaining work is reassigned. Future assignments keep their previous picker when still feasible. Every replan creates a new plan version recording the trigger and, for each order, what changed and why. A planner error never replaces the active plan.

- **Applies to:** shift_planner
- **Retrieval keywords:** replan, replanning, change, unavailable, urgent, mid-shift, version, reassign, preserve
- **Where it is enforced:** Incremental replanning, stickiness, version history, and "planner error never replaces the active plan".
