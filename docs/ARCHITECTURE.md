# Architecture

```
 Browser (React + Vite + Tailwind)            CLI: npm run scenario / reset / demo:trace / test
        │  HTTP (x-role: operator | reviewer)          │
        ▼                                              ▼
 ┌───────────────────────── server (Node 22, TypeScript, Fastify) ─────────────────────────┐
 │ http/app.ts        thin transport: request validation (zod), role header → tool role,   │
 │                    serialises state-changing requests (one simulated warehouse)         │
 │                                                                                          │
 │ agents/resolver    Exception Resolver orchestrator                                       │
 │   investigators    ├─ LLM investigator (Gemini function calling)  ┐ both call ONLY the   │
 │                    └─ deterministic investigator                   ┘ read-only tools     │
 │   assessment       pure: evidence ledger → facts + policy-permitted decision             │
 │   guard            pure: proposal × assessment × SOP-APR-001 → executable decision       │
 │ planner/service    Shift Planner agent: read tools → search_policies → generate_plan     │
 │ planner/engine     pure deterministic scheduler (all arithmetic, capacity, feasibility)  │
 │ scenarios          named reproducible scenarios (shared by CLI, UI and vitest)           │
 │                                                                                          │
 │ tools/framework    executeTool(): role → zod input → fault injection → tx{ idempotency   │
 │                    key → business rules → execution } → audit event → ToolResult        │
 │ tools/*            read tools · resolver action tools · planner & simulation tools       │
 │ policy/retrieval   shared SOP store + keyword retrieval                                  │
 │ domain/rules       shared pure rules: transitions, validity, availability, workload ...  │
 │ llm/               LLMProvider interface + OpenAI-compatible provider (no vendor SDK)    │
 └──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                            ▼
                     PostgreSQL — ONE schema shared by both workflows
      orders · order_lines · inventory · inventory_counts · shipments · pickers · skus · locations
      exceptions · approvals · escalations · plans · plan_assignments · policies
      audit_events · agent_runs · action_log · sim_state · scenario_results
```

## Responsibilities

| Concern | Owner | Why |
|---|---|---|
| Choosing which evidence to gather next | LLM (Gemini) **or** deterministic investigator | The LLM is useful for flexible investigation. The deterministic path keeps tests reproducible and is the fallback when the LLM fails |
| Explaining findings / the plan in prose | LLM (optional) | Never authoritative. Its summary is labelled "agent analysis (before execution)" |
| Facts (shortfall, label age, duplicate criteria, data validity) | Deterministic tools + `domain/rules.ts` | Computed from records and returned by the tools, so the model never does arithmetic |
| Which outcome is permitted | `assessment.ts` + `guard.ts` + SOP params | Enforced in code, parameterised by the shared SOP |
| Executing a state change | Controlled action tools only | Every mutation re-checks its own business rules inside the DB transaction |
| Approving an approval-gated action | A human Operator via the UI/API | `decide_approval` accepts only `role=operator`. Agents get `FORBIDDEN` |
| Scheduling, capacity, feasibility | `planner/engine.ts` (pure) | Deterministic and unit-tested. The LLM only rewords its output |

## The controlled-tool pipeline

Every tool (read or write) goes through `executeTool()`:

1. **Role check.** Each tool declares the roles allowed to call it (`agent`, `operator`, `reviewer`, `system`).
2. **Schema validation.** A zod input schema is applied. Failures return `INVALID_INPUT` and are audited as `TOOL_REJECTED`.
3. **Fault injection.** `sim_state.faults` can make the next N calls of a tool `TIMEOUT` or `ERROR`. Nothing executes, and the error says the outcome is unknown and no success was recorded.
4. **Transaction.** `SET LOCAL statement_timeout`. For mutations, an **idempotency key** is inserted into `action_log`. If the key already exists, the prior result is returned with `duplicate: true` and no second side effect.
5. **Business rules + execution.** Examples: allowed status transitions, SOP-SOT-002 conditions re-checked inside `sync_order_status`, cited policy must exist, action type must be in SOP-APR-001's list.
6. **Audit event.** Records run_id, workflow, actor, sanitized input, result/error, policy refs, decision summary, proposed action, approval state, state changes, and outcome.
7. **Structured result.** `{ success, data | error{code,message}, duplicate?, auditSeq }`.

The LLM receives JSON-schema descriptions of the **read-only** tools plus `submit_decision`. It never gets SQL, never gets an action tool, and cannot approve.

## Exception Resolver flow

```
get_exception (orchestrator) ─ refuse if already AWAITING_APPROVAL / ESCALATED / RESOLVED / CLOSED (duplicate-run guard)
update_exception_status → INVESTIGATING
investigate:
   LLM: model picks tools turn by turn → submit_decision
        guard feedback loop (≤2 rounds): "evidence incomplete: get_inventory(SKU-007)…", "citation not retrieved: …"
        on provider error / rate limit / step budget → audited LLM_FALLBACK → deterministic continues from the same ledger
   deterministic: repeatedly ask assess() for the first missing evidence → call it
assess(ledger)  → facts, conflicts, missing facts, required policies, permitted decision
guard(proposal, assessment, SOP-APR-001)
   - rejects citations not retrieved in this run
   - discards prohibited / wrongly-autonomous actions
   - final decision = the MORE conservative of proposal and assessment
   - flags model text that claims an action was already performed
execute via tools: hold_order / sync_order_status → request_approval → create_escalation → update_exception_status
   - on tool error: re-read the order (verification) → "status unknown → verified NOT applied" → exception FAILED, no success claimed
re-read final state → report + audit
```

Outcomes: `AUTO_RESOLVED`, `HELD_AND_ESCALATED`, `ESCALATED`, `AWAITING_APPROVAL`, `NO_ACTION_NEEDED`, `FAILED`.

## Approval flow (confirmation-gated action)

1. The resolver calls `request_approval`, which stores the proposal: action, params, **effect**, reason, policy ids, and expiry (simulated time, TTL from SOP-APR-001). Nothing executes. The exception becomes `AWAITING_APPROVAL`.
2. The UI shows the "Proposed action" card. **Approve/Reject is a separate, explicit input** from a user in the Operator role (`POST /api/approvals/:id/decide`).
3. Approve → `decide_approval` (operator only) → `execute_approved_action`. The executor atomically claims `APPROVED → EXECUTING`, re-validates the transition, executes, then marks `EXECUTED` and the exception `RESOLVED`. Exactly-once is enforced by the claim plus the idempotency key.
4. Reject → nothing executes. A structured escalation is created and the hold remains.
5. Not received → when the clock passes `expires_at`, the approval becomes `EXPIRED` and the exception is escalated. A late approval is refused.
6. If execution times out, the approval stays `APPROVED`, the UI says "status unknown, no success recorded", and "Retry execution" is safe.

## Shared state and cross-agent integration

There is exactly one set of tables. The resolver writes `orders.status = ON_HOLD`, `hold_exception_id`, and `hold_reason`. The planner's snapshot reads the same rows on every run: a held order becomes `BLOCKED` with `exception_ref`, and the plan diff shows `NEWLY_BLOCKED`. Open-but-untriaged exceptions are shown as warnings on planned orders. The planner deliberately does not interpret raw exception records; triage is the resolver's job (see REFLECTION.md).

## Planner flow

`runPlanner(trigger)`: `get_picker_status`, `get_current_plan`, `search_policies('planning…')`, then `generate_plan`. Inside one transaction under `LOCK TABLE plans`, `generate_plan` takes a snapshot, runs `buildPlan()`, writes plan version N+1 (the previous one becomes `SUPERSEDED`), and saves assignments plus the change log. Optionally the LLM explains the plan from the computed JSON only.

- **Infeasible ≠ error.** Infeasible orders are part of a `COMPLETED` plan. An exception or timeout in `generate_plan` makes the run `FAILED` with `kind: SYSTEM_FAILURE`, and the active plan is unchanged.
- **Execution simulation.** `advance_clock(minutes)` lets available pickers work through their queue. It dispatches with an inventory re-check, applies progress, completes orders, decrements stock, and expires approvals.

## Event-driven automation (optional feature)

State-changing tools write a row to `domain_events` **in the same transaction** as the change (outbox). After each HTTP mutation the dispatcher drains the outbox in rounds: cycle count → deterministic detector → `EXCEPTION_DETECTED` → (optional) auto-investigation → hold events → **one** coalesced incremental replan. Any plan generation absorbs pending state-change events, so replans are never duplicated. Each event ends PROCESSED, SKIPPED or FAILED and is audited. See [OPTIONAL_FEATURES.md](OPTIONAL_FEATURES.md).

## Planner strategies

`buildPlan()` = eligibility gates → priority sort → greedy picker choice → *(optional)* local-search improvement (`optimizer.ts`) → **finalize** (sequence, timings, SLA flags, rationale from the final queues) → diff vs the previous version. The strategy defaults to SOP-PLN-002 `default_strategy` and can be overridden per run.

## Observability

- `audit_events`: sequence-ordered, every tool call and decision, with sanitized input (secret-looking keys are redacted, and payload sizes are bounded). It can be exported as JSONL (`/api/audit/export.jsonl`).
- `agent_runs`: one row per resolver or planner run, holding the full structured report (steps, evidence, citations, guard notes, actions, final state).
- `/api/metrics` computes structured metrics (unsafe-action count, escalation precision/recall, LLM agreement, plan feasibility, preservation…). `eval_results` stores repeated-run evaluations (survives reset).
- The UI shows all of the above. The Audit page filters by run id, workflow, and event type.

## Technology choices

| Choice | Reason |
|---|---|
| TypeScript end to end | One language for UI, API, and tools. The zod schemas double as LLM tool schemas |
| Fastify | Small, fast, good error hooks. It also serves the built UI, so there is one deployable |
| PostgreSQL + `pg` (raw SQL, no ORM) | Transactions, row locks (`FOR UPDATE`), generated columns, partial unique indexes (one live approval per exception, one active plan), and CHECK constraints. Raw SQL keeps the safety-critical statements visible. Drizzle/Prisma were considered but add codegen/migration tooling for little benefit at this size |
| Gemini via OpenAI-compatible API, `fetch` only | Free tier. The provider interface lets any OpenAI-compatible endpoint be swapped in by env vars |
| React + Vite + Tailwind | Fast to build a clear operational UI. Hash routing keeps a single static bundle |
| Vitest | Fast unit tests for the pure engine and guard, plus integration tests against real Postgres |

## Deliberate deviations from the suggested structure

The brief suggested `packages/{database,domain,tools,agents,planner,policy}` workspaces. I used two workspaces (`server`, `web`) with the same layering expressed as folders inside `server/src`. Separate packages would add build/linking overhead without changing any boundary: the boundary that matters (agents cannot touch the DB, and every mutation goes through `executeTool`) is enforced in code.
