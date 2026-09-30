# Demo Script (8–12 minutes)

**Setup:** open the deployed URL (or `http://localhost:3001` locally). Role = **Operator / Supervisor**. Click **↺ Reset environment**. The header shows the simulated clock (08:00) and the agent mode (`LLM: gemini-3.1-flash-lite`, or deterministic if no key is set). The yellow banner states that everything is simulated.

> Tip for recording: with the free Gemini tier an investigation takes 10–40 s. If the quota is exhausted, the run shows `mode: llm->deterministic` with the reason. Point this out: it is the designed fallback, not a failure.

## Part 1 — The environment (≈1 min)
1. **Dashboard**: 20 orders, 7 open exceptions, 4/5 pickers available, no plan yet.
2. **Orders**: ORD-1004 (SKU-007 × 12), ORD-1010/ORD-1011 (identical), ORD-1009 (qty **−3**, red).
3. **Inventory & Shipments**: SKU-007 shows **effective 5** in red. The system says 14, but a newer cycle count says 5. SHP-5012 is addressed to DEST-E-340.
4. **Pickers**: uneven capacities (90–180 min), COLD/BULKY skills, P-05 unavailable.
5. **Policies (SOP)**: one store, 11 rules, shared by both workflows. Point out the machine-readable params (for example `autonomous / approval_required / prohibited`).

## Part 2 — Multi-order plan (≈1.5 min)
6. **Shift Planner → Generate plan** → v1.
   - Tool calls: `get_picker_status`, `get_current_plan`, `search_policies` (SOP-PLN-001/002/003), `generate_plan`.
   - Timelines: 4 pickers loaded; P-05 empty.
   - Assignments table: rank (deadline bucket → priority), workload (pick + travel), inventory, deadline vs estimated window, zone, rationale.
   - ORD-1005 / ORD-1018 **IN PROGRESS** (existing progress kept). ORD-1009 **BLOCKED** (invalid data), ORD-1015 **BLOCKED** (inventory), ORD-1014 **INFEASIBLE** (152 min > 120 min BULKY capacity).
   - **ORD-1004 is ASSIGNED with ⚠ "Open exception EXC-2001 not yet resolved"**. Remember this.

## Part 3 — Autonomous resolution (≈1.5 min)
7. **Exceptions → EXC-2003 → Investigate.** Walk the report top to bottom:
   - *Investigation*: the tool calls the agent selected (get_order → get_order_lines → get_shipment → search_policies…).
   - *Evidence*: pickup scan present, all lines picked, destination match.
   - *Policy used*: SOP-SOT-002 + excerpt + why it applies. SOP-APR-001 (forward sync is autonomous).
   - *Decision*: proposal matches the deterministic assessment → accepted.
   - *Actions*: ✓ `sync_order_status` confirmed by the tool. *Result*: order re-read = SHIPPED.

## Part 4 — Escalation (≈1 min)
8. **EXC-2004 → Investigate.** Order says SHIPPED, but the shipment has no scan and a line is short-picked. Conflicting facts are listed. No backward change. The structured escalation shows evidence checked, tool results, policy, recommended human action, current state, and unresolved questions.

## Part 5 — Confirmation-gated action (≈1.5 min)
9. **EXC-2002 → Investigate.** Outcome **AWAITING APPROVAL**: ORD-1011 held, and the **Proposed action** card shows Action CANCEL ORDER, Reason, Policy SOP-EXC-002/SOP-APR-001, Effect ("ORD-1011 → CANCELLED… ORD-1010 unchanged"), and expiry.
10. Switch role to **Exception Reviewer**: Approve is disabled (agents and reviewers cannot approve). Switch back to **Operator**, add a note, click **Approve & execute** → "executed ✓". Orders shows ORD-1011 CANCELLED.

## Part 6 — Ambiguous case (≈1 min)
11. **EXC-2007 → Investigate.** The shipment is addressed to another order's destination. The agent holds ORD-1012, preserves the link and both destinations, **does not propose a relink**, and escalates with unresolved questions ("Was SHP-5012 linked to the wrong order?", "Did the address change?").

## Part 7 — Exception affects the planner (cross-agent) (≈1.5 min)
12. **EXC-2001 → Investigate.** Effective stock 5 < 12 → ORD-1004 **ON_HOLD** (held by EXC-2001) + escalation.
13. **Shift Planner → Refresh after exception** → v2. The "What changed v1 → v2" table shows **ORD-1004 NEWLY BLOCKED**. The row reads **"Blocked by EXC-2001 — ON_HOLD: Inventory shortfall: SKU-007 needs 12, effective available 5"**. ORD-1011 REMOVED (cancelled). The freed capacity is reused.

## Part 8 — Replanning (≈1.5 min)
14. Click **+45 min**. The timelines show completed (green) and in-progress (blue) work; the red line is "now".
15. Select **P-02 → Picker unavailable** (auto-replan) → v3. The change table shows:
    - ORD-1002 **PROGRESS PRESERVED REASSIGNED** P-02 → another picker ("picked quantities preserved").
    - ORD-1006 **NEWLY INFEASIBLE**: no available COLD picker (P-02 and P-05 are out).
    - Completed and in-progress work kept. The summary tile shows preserved vs changed counts.
16. (Optional) **Inject planner failure** → Refresh → the run is **SYSTEM FAILURE**, not infeasibility, and v3 stays active.

## Part 9 — Audit and tests (≈1 min)
17. **Audit Log**: filter on the EXC-2001 run id. It shows RUN_STARTED → TOOL_CALLs → DECISION (policy refs) → STATE_CHANGE hold_order → ESCALATION_CREATED → RUN_COMPLETED. Expand a row for input/result/state changes. Mention **Export JSONL**.
18. **Scenarios & Tests → Run all**: 18/18 PASS, expected vs actual per check (timeout, duplicate action, approval expiry, inventory drift, unsafe LLM proposal…). Mention `npm test` (50 tests) and `npm run scenario -- all --llm`.

**Close:** "One database, two workflows, controlled tools, shared SOP, deterministic safety boundaries. The LLM investigates and explains; it never has the final say on a state change."
