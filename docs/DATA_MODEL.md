# Data Model

Schema: `server/src/db/schema.sql` (recreated on every reset). Seed: `server/src/db/seed.ts`. The relationship diagram is in [PHASE_0_DESIGN.md §1](PHASE_0_DESIGN.md#1-entity-model-and-relationships).

## Integrity enforced in the database

| Constraint | Purpose |
|---|---|
| FKs `order_lines → orders, skus`, `inventory → skus, locations`, `plan_assignments → plans, orders, pickers`, `approvals/escalations → exceptions` | Linked records, no orphans |
| `inventory.available` is `GENERATED ALWAYS AS (on_hand - reserved) STORED` | Available stock can never drift from its parts |
| `CHECK (on_hand >= 0)`, `CHECK (reserved <= on_hand)` | Physically impossible stock is rejected |
| `CHECK ((status = 'ON_HOLD') = (hold_prev_status IS NOT NULL))` | A hold always remembers what to release to |
| status `CHECK` lists on orders, shipments, exceptions, approvals, plans, assignments | No unknown statuses |
| `UNIQUE INDEX approvals_one_pending ON approvals(exception_id) WHERE status IN ('PENDING','APPROVED','EXECUTING')` | At most one live proposal per exception |
| `UNIQUE INDEX plans_one_active ON plans(status) WHERE status = 'ACTIVE'` | Exactly one active plan |
| `action_log.idempotency_key PRIMARY KEY` | A mutation executes at most once |
| `sim_state.id = 1` | A single simulated clock |

**Deliberately not enforced in the database:** `order_lines.requested_qty > 0` and `orders.created_at <= deadline`. The environment has to be able to *hold* the seeded malformed data (EXC-2005) so the system can demonstrate detecting it. Validity is enforced at the tool/planner layer (`validateOrderData`). `exceptions.order_id` has no FK, so an exception can reference a missing order (failure mode F1).

## Tables

| Table | Rows (baseline) | Notes |
|---|---|---|
| `orders` | 20 | 13 plannable (11 PENDING, 2 PICKING), 4 PACKED, 3 SHIPPED |
| `order_lines` | 33 | multi-line and multi-location orders |
| `skus` | 10 | `pick_minutes_per_unit`, optional `required_skill` (COLD, BULKY) |
| `locations` | 8 | zones A–D. Zone distance is the location-proximity heuristic |
| `inventory` | 11 | SKU-005 is stored in two locations |
| `inventory_counts` | 2 | CC-7001 contradicts system stock for SKU-007 |
| `shipments` | 9 | carriers SimParcel/SimFreight, with scan timestamps |
| `pickers` | 5 | P-05 unavailable all shift. Capacities 90–180 min. COLD/BULKY skills |
| `exceptions` | 7 | six distinct types (STATUS_DESYNC seeded twice: recoverable and contradictory) |
| `policies` | 11 | the shared SOP |
| `plans` / `plan_assignments` | 0 | created by the planner. Versions are kept |
| `approvals` / `escalations` | 0 | created by the resolver |
| `audit_events` / `agent_runs` / `action_log` | 1 / 0 / 0 | observability and idempotency |
| `sim_state` | 1 | `sim_now = 2026-10-01 08:00Z`, shift 08:00–16:00, fault injections |
| `scenario_results` | — | survives reset (test history) |

## Which fields support what

| Field(s) | Exception investigation | Planning |
|---|---|---|
| `orders.status`, `hold_*` | desync, hold, release | eligibility gate, BLOCKED + exception_ref |
| `orders.customer_ref`, `destination_ref`, `created_at` | duplicate criteria, destination conflict, timestamp validity | — |
| `orders.deadline`, `priority` | — | urgency bucket, priority, SLA risk |
| `order_lines.requested_qty/picked_qty` | invalid data, fully-picked check, shortfall | remaining workload, existing progress |
| `inventory.*`, `inventory_counts.*` | shortfall / mismatch (effective availability) | inventory readiness, allocation, dispatch re-check |
| `shipments.*` scans, destination, order link | desync, stale shipment, wrong link | — |
| `pickers.availability/capacity/consumed/skills/home_zone` | — | hard constraints and proximity tie-break |
| `skus.pick_minutes_per_unit`, `locations.zone` | — | workload (pick + travel) |

## Seeded planning constraints

- **Different deadlines:** 09:45 → 16:00. **Uneven capacities:** P-03 has 90 min (part-time), P-04 120, P-01/P-02 180.
- **Multi-location orders:** ORD-1001, ORD-1002, ORD-1016, ORD-1017 (zones A+B).
- **Infeasible:** ORD-1014 needs 152 min of BULKY work, and the only BULKY picker has 120 min.
- **Not ready:** ORD-1015 needs 20 × SKU-010, but only 8 exist.
- **Skill dependency:** COLD orders (ORD-1006, ORD-1018) depend on P-02.
- **Existing progress:** ORD-1005 (P-01, 16/40 picked) and ORD-1018 (P-02, 4/10 picked).

## Reset and persistence

`npm run reset`, the header button, or `POST /api/reset` drops every simulation table (except `scenario_results`) and recreates the baseline in one transaction under an advisory lock. The server auto-seeds an empty database on first boot. State lives only in PostgreSQL; neither workflow holds mutable state in memory between requests.
