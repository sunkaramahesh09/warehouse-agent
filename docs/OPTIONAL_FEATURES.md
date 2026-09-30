# Optional Features (PRD §18 SHOULD / NICE)

Built after the core submission was complete and tagged (`v1.0-core`, see RUNBOOK §2a). The PRD states that "a well-executed enhancement to one workflow is more valuable than shallow attempts at many bonuses", so I chose **three** features that deepen the existing workflows. Each has a scenario, tests, UI, and audit coverage. I deliberately **did not** build one of the listed items (see the end).

| PRD item | Level | Status | Where |
|---|---|---|---|
| Structured metrics | SHOULD | ✅ | Metrics & Evaluation page, `GET /api/metrics`, `server/src/metrics/metrics.ts` |
| Richer evaluation dashboard | NICE | ✅ | repeated-run eval harness (`npm run eval`), persistent `eval_results`, dashboard |
| Event-driven trigger | NICE | ✅ | outbox `domain_events`, dispatcher, cycle-count detector, automation switches |
| Advanced scheduling / optimization | NICE | ✅ | opt-in local search over the greedy plan (`server/src/planner/optimizer.ts`) |
| Custom agent loop / multi-agent decomposition | NICE | ✅ (already in core) | custom LLM tool loop with guard feedback; investigator / decision / planner separation |
| Browser automation fallback | NICE | ⬜ intentionally skipped | see below |

---

## 1. Event-driven triggers

**Problem:** in the core build every workflow is started by a person. In a warehouse, state changes arrive as events (a cycle count, a picker going home) and downstream work should react.

**Design: transactional outbox + dispatcher**

```
tool transaction ──► state change + INSERT domain_events (same commit, so no lost or phantom events)
                                   │
HTTP request finishes ──► processEvents(): rounds until the outbox is empty (max 6)
   CYCLE_COUNT_RECORDED ─(auto_detect)──────► detect_inventory_shortfalls (deterministic) ─► EXCEPTION_DETECTED
   EXCEPTION_DETECTED   ─(auto_investigate)─► Exception Resolver (same guard, same tools, LLM or deterministic)
   ORDER_HELD / RELEASED / CANCELLED / CREATED,
   PICKER_AVAILABILITY_CHANGED, INVENTORY_CHANGED ─(auto_replan)─► ONE coalesced incremental replan per round
```

- **Emitted by:** `hold_order`, `sync_order_status`, `execute_approved_action` (cancel/release/relink), `resolve_escalation` (release), `set_picker_availability`, `inject_urgent_order`, `simulate_inventory_change`, `record_cycle_count`, `detect_inventory_shortfalls`.
- **Detector** (no LLM): after a count, it flags each PENDING/PICKING order whose remaining quantity of the SKU exceeds the effective available stock (SOP-SOT-001). It creates one `INVENTORY_SHORTFALL` exception per affected order that doesn't already have one. It is idempotent per count (`detect:<count_id>`).
- **Coalescing:** several holds in one round produce one replan. The trigger is chosen by precedence: PICKER_UNAVAILABLE > URGENT_ORDER > EXCEPTION_HOLD > INVENTORY_CHANGED.
- **Absorption:** any plan generation (manual or automatic) marks pending state-change events as `PROCESSED` by that plan version, because its snapshot already reflects them. So there are no duplicate replans.
- **Every event ends explicitly:** `PROCESSED`, `SKIPPED` (with a reason such as "automation disabled"), or `FAILED`. Each is audited as `EVENT_PROCESSED`, and each coalesced replan as `AUTO_REPLAN`.
- **Safety:** automation reuses the guarded resolver and the controlled tools. **It never approves anything**: approval-gated actions still wait for an Operator. The switches are Operator-only and audited (`CONFIG_CHANGE`). They default to detect **on**, investigate/replan **off**, so the manual demo stays unchanged.

**Scenario `event-driven`:** cycle count SKU-003@B-01 = 12 (effective 7). The detector flags ORD-1002 (needs 10) and ORD-1016 (needs 8) but not ORD-1009 (needs 5). Both are auto-investigated → held + escalated. One replan follows (v2, EXCEPTION_HOLD) with both BLOCKED by their new exceptions. No events are left pending, and no approval is executed. With automation off, events are SKIPPED and no plan is created.

**UI:** *Events & Automation* page with the switches, the cycle-count form, and the event log (type, source, payload, status, handler, result).

## 2. Structured metrics + evaluation dashboard

**Live metrics** (`GET /api/metrics`, *Metrics & Evaluation* page). These are computed from stored state only.

| Metric | Definition |
|---|---|
| Correct outcome rate | Resolver runs on seeded exceptions whose outcome equals the ground truth (`scenarios/expected.ts`, never shown to the agent) |
| Escalation recall / precision | should-escalate → escalated / escalated → should-escalate |
| **Unsafe action count** | resolver state changes other than `hold_order`/`sync_order_status`, plus approvals executed without a recorded human decision. **Must be 0** |
| Unauthorized attempts blocked | `TOOL_REJECTED` with `FORBIDDEN` (for example, an agent calling `decide_approval`) |
| Unsafe proposals blocked | runs whose guard discarded prohibited or wrongly-autonomous actions or fabricated citations |
| LLM agreement | the model's own proposal already equalled the final guarded decision |
| Guard override rate / LLM fallback rate | from run reports |
| Avg tool calls, avg latency | per resolver run |
| Plan feasibility | scheduled / (scheduled + infeasible), per plan version |
| Preservation on replan | kept / (kept + changed) assignments, averaged over replans |
| Utilization, SLA risk, optimizer gains | per plan version |
| Scenario success rate | latest verdict per scenario per mode, plus all-time history (survives reset) |

**Evaluation harness** (`npm run eval [-- --llm] [--runs N]`, or the "Run evaluation" button for deterministic mode). It runs every seeded exception N times, **each from a clean reset**, and stores one row per run in `eval_results` (survives reset). Aggregates: accuracy, consistency across repetitions, LLM agreement, guard overrides, fallbacks, unsafe actions, tool calls, latency. Reports: `docs/results/eval-report.md` (deterministic), `docs/results/eval-report-llm.md` (Gemini).

This separates the questions that matter for an agentic system: *is the final outcome right* (accuracy), *is it stable* (consistency), *how often does the model need correcting* (agreement/overrides), and *did anything unsafe happen* (unsafe actions).

## 3. Advanced scheduling: local search over the greedy plan

**Why:** greedy assignment in priority order is explainable but myopic. For example, putting a flexible order on the only COLD-skilled picker can make a later COLD order late.

**What:** an opt-in improvement pass (`strategy: local_search`; the SOP-PLN-002 default stays `greedy`, and the planner UI and API accept a per-run override).

- **Moves:** relocate one un-started order to another picker, or swap two. Best-improvement, deterministic tie-breaks, at most 60 iterations.
- **Hard constraints re-checked for every move:** picker AVAILABLE, has all required skills, load ≤ remaining capacity. In-progress, completed, blocked and infeasible rows never move. Queues keep priority-rank order, so SOP-PLN-001 sequencing still holds.
- **Lexicographic objective:** 1) SLA-risk orders, 2) total lateness, 3) **churn** (orders moved away from their previous-version picker; replans only), 4) makespan. Because churn ranks above makespan, a mid-shift replan only moves work to reduce SLA risk or lateness, never just to rebalance.
- **Transparency:** each moved order's rationale says "Optimizer (local search): moved P-02 → P-04 (makespan 109 → 92 min)". The plan stores `before`/`after` objectives and the move list, and the UI shows a before/after table.
- **Implementation:** the planner was refactored so picker *choice* (greedy, then optional local search) is separate from a single **finalize** pass that computes sequence, timings, SLA flags and rationale. Rationale therefore always matches the final assignment for both strategies.

**Evidence:**
- Unit test: greedy leaves a COLD order at SLA risk; local search moves the flexible order away, so SLA risk goes 1 → 0.
- Unit test: in-progress work is never moved, capacity and skills hold, the same orders are scheduled, the result is never worse and is deterministic.
- Scenario `optimizer` on the real seed: makespan **109 → 85 min** via two explained swaps, same orders scheduled, P-05 unused, deterministic.

## Not built: browser-automation fallback

The PRD lists a "browser automation fallback" as a bonus. In this prototype every system is simulated and exposed through controlled tools, so there is no external UI whose API could be missing. A browser-automation layer would be for show only, and it would bypass the controlled-tool boundary the PRD emphasises. I spent the effort on the three features above instead. (Browser automation *is* used for verification: the UI demo path is driven headlessly in Chromium against local and deployed builds.)
