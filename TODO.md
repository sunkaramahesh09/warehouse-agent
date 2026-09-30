# Work Plan — Order Exception Resolver + Shift Planner

Legend: [ ] todo · [~] in progress · [x] done (only when it exists AND was verified)

## Phase 1 — Understand & design
- [x] Read PRD fully (10 pages)
- [x] Decide stack: Fastify + React/Vite/Tailwind + PostgreSQL (pg) + Gemini (OpenAI-compatible) + deterministic fallback; Railway all-in-one deploy
- [ ] docs/PRD_ANALYSIS.md (requirements traceability table)
- [ ] docs/PHASE_0_DESIGN.md (entities, SoT, 6+ exceptions w/ boundaries, planning policy, 5+ failure modes, SOP)

## Phase 2 — Data
- [ ] Local Postgres (docker, port 5433)
- [ ] schema.sql (FKs, CHECKs, transitions), seed (20 orders / 10 SKUs / 10 shipments / 5 pickers / 7 exceptions)
- [ ] reset (CLI + API)

## Phase 3–4 — Controlled tools + shared policy
- [ ] Tool framework: zod validation → business rules → tx execution → audit → ToolResult
- [ ] Fault injection (timeout/error), idempotency keys, explicit state transitions
- [ ] SOP store (policies table, seeded from sop.json) + keyword retrieval; machine-readable params used by BOTH workflows

## Phase 5 — Exception Resolver
- [ ] Deterministic investigator (step-wise tool selection) + evidence ledger
- [ ] LLM investigator (Gemini tool calling) with step budget, 429 backoff, fallback
- [ ] Deterministic assessment + policy guard (boundary enforcement, citation validation)
- [ ] Actions: hold, forward status sync, approval request, escalation; post-timeout verification
- [ ] Approval execution (operator only), rejection, expiry; escalation resolution (reviewer)

## Phase 6–8 — Planner, replanning, cross-agent
- [ ] Pure deterministic planner (eligibility gates, priority key, capacity/skills/inventory, deadline risk, location tie-break)
- [ ] Plan versions + assignments persisted; planner failure ≠ infeasibility
- [ ] Sim clock / progress simulation, dispatch-time inventory re-check
- [ ] Incremental replan (picker unavailable, urgent order, exception hold) with change log
- [ ] Cross-agent: resolver hold → planner shows BLOCKED by EXC-xxxx

## Phase 9–10 — UI + audit
- [ ] Dashboard, Orders, Inventory, Pickers/Shipments, Exceptions (+investigation trace), Approvals/Escalations, Planner (+diff), Audit, Scenarios, Policies
- [ ] Role switch (Operator / Exception Reviewer), "SIMULATED" labeling, reset button

## Phase 11 — Verification
- [ ] Scenario runner (CLI + UI) with expected vs actual, pass/fail, results file
- [ ] Vitest: planner unit tests, resolver/safety tests, cross-agent integration test

## Phase 12 — Docs
- [ ] README, ARCHITECTURE, DATA_MODEL, POLICIES, SCENARIOS, FAILURE_MODES, DEMO_SCRIPT, REFLECTION (AI disclosure), audit log examples, test results

## Phase 13–14 — Ship
- [ ] GitHub repo push
- [ ] Railway deploy (service + Postgres), GEMINI key set, verify every workflow on the live URL
- [ ] Final acceptance checklist
