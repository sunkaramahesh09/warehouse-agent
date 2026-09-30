# PRD Analysis & Requirements Traceability

Source: *Project Requirements Document — Order Exception Resolver + Shift Planner* (v1.0, 10 pages), read in full before design.

**Status legend:** ✅ implemented and verified by a test/scenario/artifact · 🟡 partial or with a documented limitation · ⬜ not done

## Interpretation and assumptions (ambiguities resolved)

| PRD ambiguity | Assumption made | Where documented |
|---|---|---|
| "Six seeded exception types": distinct types or cases? | Six **distinct types**. STATUS_DESYNC is seeded twice (recoverable vs contradictory) to show both outcomes, so 7 exceptions in total | PHASE_0 §4 |
| What counts as "autonomous resolution" | An action on SOP-APR-001's autonomous list that fully resolves the case (EXC-2003 forward sync). Holds are also autonomous but accompany escalations | POLICIES, PHASE_0 §4.2 |
| Authoritative source for inventory | System record, unless a **newer** cycle count is lower. Stock is never raised | SOP-SOT-001 |
| Authoritative source for "shipped" | Carrier scans + all lines picked + destination match. A label alone never counts | SOP-SOT-002 |
| Destination conflicts | No rule makes either record authoritative → ambiguous by definition → never auto-resolved | SOP-EXC-005 |
| Workload/capacity units | Minutes (pick time + travel). Capacity = productive minutes this shift | PHASE_0 §2, §5 |
| Deadline miss | A soft constraint: assign and flag `SLA_AT_RISK`. Capacity, skill and inventory are hard (`INFEASIBLE`/`BLOCKED`) | SOP-PLN-002 |
| Order splitting | Not allowed (one picker per order) | SOP-PLN-002 |
| "Mid-shift" | A simulated clock with execution progress (`advance_clock`) | ARCHITECTURE |
| Approval "separate explicit input" | A separate HTTP request from a user in the Operator role. Agents are technically unable to call `decide_approval` | ARCHITECTURE §Approval |
| Deployment ("not required" in §17 vs "deployed URL" deliverable in §20) | §20 is the deliverable, so the app is deployed. It remains a simulated prototype, not production | README |
| Roles | Header-based role switch (Operator / Exception Reviewer), no authentication (§3 says RBAC is not mandatory) | README, REFLECTION |

## Requirements matrix

| # | PRD requirement (section) | Level | Implementation | Test / demo evidence | Status |
|---|---|---|---|---|---|
| 1 | One shared synthetic warehouse; both workflows on the same records (§1, §4, §12) | MUST | One PostgreSQL schema. Resolver and planner read/write the same `orders` rows. No agent-held mutable copies | `cross-agent` scenario; ARCHITECTURE §Shared state | ✅ |
| 2 | 12–20 orders, 8–12 SKUs, 8–12 shipments, 3–5 pickers, linked records (§4) | SHOULD | 20 orders / 33 lines, 10 SKUs, 9 shipments, 5 pickers, 8 locations, 2 cycle counts, all FK-linked | `npm run reset` output; DATA_MODEL | ✅ |
| 3 | Explain relationships and which fields support investigation/planning (§4) | MUST | PHASE_0 §1 table, DATA_MODEL | docs | ✅ |
| 4 | Reset mechanism (§4, §16) | MUST | `npm run reset`, UI button, `POST /api/reset`. Auto-seed on first boot | every scenario resets first | ✅ |
| 5 | Phase 0: entity model, SoT assumptions, ≥6 exceptions + triggers, boundaries with rationale, planning policy, ≥5 failure modes, 5–10 SOP rules (§5) | MUST | `docs/PHASE_0_DESIGN.md` (written before code, changes recorded in §9) | doc | ✅ |
| 6 | ≥ 6 distinct seeded exception conditions (§6, §18) | MUST | INVENTORY_SHORTFALL, DUPLICATE_ORDER, STATUS_DESYNC (×2), INVALID_DATA, STALE_SHIPMENT, DESTINATION_CONFLICT/wrong link | 7 exception scenarios | ✅ |
| 7 | Per scenario: ID, setup, trigger, expected safe behaviour, action boundary, reset (§6) | MUST | `SCENARIOS.md`; the same fields are shown in the UI Scenarios page | doc + UI | ✅ |
| 8 | At least one ambiguous case not auto-resolved (§6) | MUST | EXC-2007: hold + escalation, no relink proposed | `destination-conflict` | ✅ |
| 9 | Planning constraints seeded: different deadlines, uneven capacities, multi-location orders, ≥1 infeasible order (§6) | MUST | Deadlines 09:45–16:00, capacities 90–180, zone A+B orders, ORD-1014 infeasible, ORD-1015 not ready, COLD skill dependency | `planning-cycle` | ✅ |
| 10 | Genuine tool calls selected in response to the task and prior results (§7) | MUST | LLM function calling over read tools. The deterministic investigator also picks the next tool from prior results (SKUs, linked shipments, destination mismatch) | run reports / audit; tool sequences differ per case in results | ✅ |
| 11 | Inspect order, inventory, shipment, duplicate records as needed (§7) | MUST | `get_order`, `get_order_lines`, `get_inventory`, `get_shipment`, `find_shipments_for_order`, `find_orders_by_destination`, `find_duplicate_orders` | scenarios | ✅ |
| 12 | Compare contradictory info; don't blindly trust corrupted values (§7) | MUST | System vs cycle count, order vs shipment status, order vs shipment destination, validity checks | EXC-2001/2004/2005/2007 | ✅ |
| 13 | Retrieve and cite policy for consequential decisions; no fabricated citations; surface policy gaps (§7, §11) | MUST | `search_policies`/`get_policy`. The guard accepts only citations retrieved in the run. Action tools refuse unknown policy ids. Gap → escalate | `unsafe-llm-proposal`, guard unit tests, integration test | ✅ |
| 14 | Respect explicit autonomous-action boundaries (§7, §8) | MUST | SOP-APR-001 lists enforced by the guard and inside each action tool | guard tests, `unsafe-llm-proposal` | ✅ |
| 15 | Explicit confirmation before ≥1 designated action; show operation + effect; separate approval input; execute via controlled tool; log; no simulated approval (§7, §8) | MUST | CANCEL_ORDER proposal card with effect. Operator-only `decide_approval` → `execute_approved_action` (exactly once) | `duplicate-order`, `approval-expiry`, UI screenshots | ✅ |
| 16 | Escalate ambiguous, high-impact, unsupported cases (§7) | MUST | ESCALATE outcomes for EXC-2004/2006/2007, missing record, policy gap, evidence incomplete | scenarios | ✅ |
| 17 | Persist allowed state changes and log the outcome (§7) | MUST | Transactions + `audit_events` + `agent_runs.report` | audit example | ✅ |
| 18 | Demonstrate ≥4 exception scenarios: autonomous, escalation, confirmation-gated, ambiguous (§7, §15) | MUST | EXC-2003, EXC-2004, EXC-2002, EXC-2007 | DEMO_SCRIPT parts 3–6 | ✅ |
| 19 | Illustrative safety principles (no invented facts, no cancel/merge/delete without approval, preserve on conflict, shipped ≠ shipment exists, tool error ≠ success, correction only when justified) (§8) | MUST | Each maps to a rule + test: SOP-SOT-001/002, SOP-APR-001, `tool-timeout`, `shipment-desync-contradictory` | scenarios | ✅ |
| 20 | Structured escalation with all listed fields (§8) | MUST | `EscalationPayload` zod schema (exception/order ids, issue, evidence checked, tool results, conflicting/missing facts, policy refs, recommended action, actions taken, current state, unresolved questions). Rendered in the UI | escalation cards | ✅ |
| 21 | Planner: plan covering multiple orders and staff, showing order/picker, sequence, workload, inventory readiness, deadline, location, rationale/blocked/infeasible reason (§9) | MUST | `plan_assignments` columns + Planner UI table + timelines | `planning-cycle`, screenshots | ✅ |
| 22 | Consider deadline, availability/capacity, inventory, existing progress; location secondary (§9) | MUST | SOP-PLN-001/002 sort key and hard constraints. Zone-distance tie-break | planner unit tests | ✅ |
| 23 | State prioritisation policy before implementation (§9) | MUST | PHASE_0 §5 (written first), SOP-PLN-001 | doc | ✅ |
| 24 | No LLM arithmetic/capacity enforcement; deterministic scheduler the agent calls and explains (§2, §9) | MUST | Pure `buildPlan()`. The LLM only rewords computed JSON | planner unit tests | ✅ |
| 25 | One mid-shift change (urgent order OR picker unavailable) (§10) | MUST | Both implemented, plus inventory drift and exception hold as triggers | `replanning`, `urgent-order` | ✅ |
| 26 | Replan: no unavailable picker; identify invalidated assignments; preserve completed; re-check inventory/capacity; flag infeasible; error ≠ infeasibility; record version, changed assignments, reasons (§10) | MUST | Incremental engine with a diff. `plans` history. SYSTEM_FAILURE path | `replanning`, `planner-failure`, `inventory-drift` | ✅ |
| 27 | 5–10 shared SOP rules covering boundaries, SoT, approvals, prioritisation, constraints, replanning (§11) | MUST | 11 rules (slightly above range, to cover each area without merging unrelated rules) | POLICIES.md | ✅ |
| 28 | Same policy source for both agents (§11) | MUST | One `policies` table. Both use `search_policies`. Both read `params` | rules test "both workflows read the same store" | ✅ |
| 29 | Cross-agent demo: resolver holds → planner refresh → not scheduled / blocked by dependency → exception ref and reason (§12) | MUST | ORD-1004: v1 ASSIGNED (with warning) → EXC-2001 hold → v2 BLOCKED `exception_ref=EXC-2001` | `cross-agent` | ✅ |
| 30 | Explain persistence and reset (§12) | MUST | DATA_MODEL §Reset | doc | ✅ |
| 31 | Distinguish Investigator, Decision flow, Planner; not one unrestricted prompt (§13) | MUST | `investigators.ts`, `assessment.ts` + `guard.ts` + orchestrator, `planner/service.ts` | ARCHITECTURE | ✅ |
| 32 | Request → validation → business rule → execution → audit → result (§13) | MUST | `executeTool()` pipeline | integration tests (INVALID_INPUT, FORBIDDEN, audit count) | ✅ |
| 33 | Explicit tool errors/missing records/invalid inputs; never claim unconfirmed success (§13) | MUST | `ToolResult` errors. Verification re-read. Claimed-action detector | `tool-timeout`, `missing-record` | ✅ |
| 34 | Audit trail with run id, workflow, tool, sanitized input, result/error, policy refs, decision, proposed action, approval state, state changes, escalation/plan-change, outcome (§14) | MUST | `audit_events` (all fields). Sanitiser. JSONL export | `docs/results/audit-log-example.*` | ✅ |
| 35 | Failures: missing/malformed, timeout/API failure, duplicate, approval not received, picker unavailable, inventory changed (§14) | MUST (test or document) | All tested (F1–F7) plus LLM failures | FAILURE_MODES.md, scenarios | ✅ |
| 36 | Reproducible tests / scenario runner; record setup, expected, actual, verdict, limitation (§15) | MUST | `npm test` (54), `npm run scenario` (20). Markdown results with expected vs actual | `docs/results/` | ✅ |
| 37 | Minimum evidence: ≥4 exception scenarios, 6 types, full plan, replan, cross-agent, malformed/tool failure (§15) | MUST | All present | results | ✅ |
| 38 | Optional metrics (§15): scenario success rate, correct escalation rate, unsafe-action count, plan feasibility rate, assignments preserved during replanning | NICE | All five plus LLM agreement/override/fallback, latency, utilization, optimizer gains — `GET /api/metrics`, Metrics page | OPTIONAL_FEATURES §2, eval reports | ✅ |
| 39 | UI exposing orders/exceptions, inventory/pickers, investigation + escalation queue, proposal + approval, plan with blocked/infeasible, replanning changes, audit + test outcomes; reset + named scenarios (§16) | SHOULD | 10-page React UI | screenshots, DEMO_SCRIPT | ✅ |
| 40 | Basic role separation if UI (§3) | encouraged | Operator vs Exception Reviewer (header), enforced server-side per tool | integration test FORBIDDEN | ✅ (no auth, by design) |
| 41 | Label simulated actions; no live systems; no real data (§3) | MUST | Global banner, "SIMULATED" badges, fictional names/ids, "SIMULATED:" audit summaries | UI | ✅ |
| 42 | Structured tool I/O; transport separated from business logic; env vars documented + example config without secrets (§17) | MUST | zod schemas. `http/` thin. `.env.example`. `.env` git-ignored | repo | ✅ |
| 43 | Distinguish prototype vs production readiness (§17) | MUST | README "Known limitations", REFLECTION risks | docs | ✅ |
| 44 | Simple UI, scenario runner, structured metrics, stronger failure recovery, location-aware heuristic, plan version history (§18 SHOULD) | SHOULD | All present | UI, scenarios, Metrics page | ✅ |
| 45 | Custom agent loop, multi-agent decomposition (§18 NICE) | NICE | Custom LLM tool loop with guard feedback. Investigator/decision/planner separation | — | ✅ |
| 46 | Event-driven trigger, advanced scheduling/optimization, richer evaluation dashboard (§18 NICE) | NICE | Outbox + dispatcher + detector + automation switches; local-search optimizer; eval harness + dashboard | scenarios `event-driven`, `optimizer`; optimizer unit tests; `eval-report*.md` | ✅ |
| 46b | Browser automation fallback (§18 NICE) | NICE | Intentionally not built (no external UI exists in a fully tool-mediated simulation; it would bypass the controlled-tool boundary) | OPTIONAL_FEATURES | ⬜ by design |
| 47 | All documents in the GitHub repo (§18) | MUST | `docs/` | repo | ✅ |
| 48 | Deliverables 1–10: repo, README, Phase 0, env + seed, both implementations, SOP, tests + results, audit examples, demo steps, reflection (§20) | MUST | See README index | repo | ✅ |
| 49 | Deliverable 11: deployed URL (§20) | MUST | Railway: Docker image + Railway Postgres — https://app-production-fd3e.up.railway.app | full demo path run in a browser against the live URL with Gemini | ✅ |
| 50 | Disclose material AI assistance (§2) | MUST | REFLECTION §AI assistance, README | doc | ✅ |
