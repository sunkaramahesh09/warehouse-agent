# Audit log example (deterministic agent)

Produced by `npm run demo:trace`: plan v1 → EXC-2003 (autonomous) → EXC-2004 (escalation) → EXC-2002 (approval → approved) → EXC-2007 (ambiguous) → EXC-2001 (shortfall hold) → plan v2 (cross-agent) → +45 min → P-02 unavailable → plan v3.

Full trail (91 events, including 48 read-only tool calls): `audit-log-example.jsonl`. Below: the 43 non-read events.

| # | Sim | Workflow | Run | Event | Tool | Summary | Policy | Approval | Outcome |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 08:00 | SYSTEM |  | ENVIRONMENT_RESET |  | Environment reset to baseline-v1 |  |  | RESET |
| 2 | 08:00 | SHIFT_PLANNER | PLN-9F1A6EDC | RUN_STARTED |  | SHIFT_PLANNER run on shift (mode: deterministic) |  |  |  |
| 6 | 08:00 | SHIFT_PLANNER | PLN-9F1A6EDC | PLAN_CREATED | generate_plan | Plan v1 (INITIAL): 8 assigned, 2 in progress, 2 blocked, 1 infeasible, 0 SLA risk | SOP-PLN-001, SOP-PLN-002 |  | OK |
| 7 | 08:00 | SHIFT_PLANNER | PLN-9F1A6EDC | RUN_COMPLETED |  | Run COMPLETED: PLAN_V1 |  |  | PLAN_V1 |
| 9 | 08:00 | EXCEPTION_RESOLVER | RUN-9520EBAE | RUN_STARTED |  | EXCEPTION_RESOLVER run on EXC-2003 (mode: deterministic) |  |  |  |
| 10 | 08:00 | EXCEPTION_RESOLVER | RUN-9520EBAE | EXCEPTION_UPDATED | update_exception_status |  |  |  | INVESTIGATING |
| 15 | 08:00 | EXCEPTION_RESOLVER | RUN-9520EBAE | DECISION |  | ORD-1003 is PACKED but carrier evidence shows SHP-5003 picked up and IN_TRANSIT → AUTO_ACTION (AUTO_RESOLVED) | SOP-SOT-002, SOP-APR-001 |  | AUTO_RESOLVED |
| 16 | 08:00 | EXCEPTION_RESOLVER | RUN-9520EBAE | STATE_CHANGE | sync_order_status | Order ORD-1003 synced PACKED -> SHIPPED from carrier evidence on SHP-5003 | SOP-SOT-002, SOP-APR-001 |  | OK |
| 17 | 08:00 | EXCEPTION_RESOLVER | RUN-9520EBAE | EXCEPTION_UPDATED | update_exception_status |  |  |  | AUTO_RESOLVED |
| 20 | 08:00 | EXCEPTION_RESOLVER | RUN-9520EBAE | RUN_COMPLETED |  | Run COMPLETED: AUTO_RESOLVED |  |  | AUTO_RESOLVED |
| 22 | 08:00 | EXCEPTION_RESOLVER | RUN-839DC337 | RUN_STARTED |  | EXCEPTION_RESOLVER run on EXC-2004 (mode: deterministic) |  |  |  |
| 23 | 08:00 | EXCEPTION_RESOLVER | RUN-839DC337 | EXCEPTION_UPDATED | update_exception_status |  |  |  | INVESTIGATING |
| 28 | 08:00 | EXCEPTION_RESOLVER | RUN-839DC337 | DECISION |  | Contradictory status: order SHIPPED vs shipment LABEL_CREATED → ESCALATE (ESCALATED) | SOP-SOT-002 |  | ESCALATED |
| 29 | 08:00 | EXCEPTION_RESOLVER | RUN-839DC337 | ESCALATION_CREATED | create_escalation | Escalated EXC-2004: Contradictory status: order SHIPPED vs shipment LABEL_CREATED | SOP-SOT-002 |  | OK |
| 32 | 08:00 | EXCEPTION_RESOLVER | RUN-839DC337 | RUN_COMPLETED |  | Run COMPLETED: ESCALATED |  |  | ESCALATED |
| 34 | 08:00 | EXCEPTION_RESOLVER | RUN-2BC8C24F | RUN_STARTED |  | EXCEPTION_RESOLVER run on EXC-2002 (mode: deterministic) |  |  |  |
| 35 | 08:00 | EXCEPTION_RESOLVER | RUN-2BC8C24F | EXCEPTION_UPDATED | update_exception_status |  |  |  | INVESTIGATING |
| 41 | 08:00 | EXCEPTION_RESOLVER | RUN-2BC8C24F | DECISION |  | ORD-1011 is a probable duplicate of ORD-1010 (same customer_ref CUST-0042; same destination_ref DEST-S-042; identical lines (SKU-004x3/SKU-009x10); created 3 mi | SOP-EXC-002, SOP-APR-001 |  | AWAITING_APPROVAL |
| 42 | 08:00 | EXCEPTION_RESOLVER | RUN-2BC8C24F | STATE_CHANGE | hold_order | Order ORD-1011 placed ON_HOLD: Probable duplicate of ORD-1010; cancellation awaiting approval | SOP-EXC-002, SOP-APR-001 |  | OK |
| 43 | 08:00 | EXCEPTION_RESOLVER | RUN-2BC8C24F | APPROVAL_REQUESTED | request_approval | Approval requested: CANCEL_ORDER — Duplicate order confirmed by SOP-EXC-002 criteria (same customer_ref CUST-0042; same destination_ref DEST-S-042; identical li | SOP-EXC-002, SOP-APR-001 | PENDING | OK |
| 46 | 08:00 | EXCEPTION_RESOLVER | RUN-2BC8C24F | RUN_COMPLETED |  | Run COMPLETED: AWAITING_APPROVAL |  |  | AWAITING_APPROVAL |
| 47 | 08:00 | OPERATOR | OPR-47376CDF | APPROVAL_DECISION | decide_approval | operator (demo) approved CANCEL_ORDER (APR-00C03A35) | SOP-EXC-002, SOP-APR-001 | APPROVED | OK |
| 48 | 08:00 | OPERATOR | OPR-47376CDF | APPROVED_ACTION_EXECUTED | execute_approved_action | Executed approved CANCEL_ORDER (APR-00C03A35) | SOP-EXC-002, SOP-APR-001 | EXECUTED | OK |
| 50 | 08:00 | EXCEPTION_RESOLVER | RUN-E1349A39 | RUN_STARTED |  | EXCEPTION_RESOLVER run on EXC-2007 (mode: deterministic) |  |  |  |
| 51 | 08:00 | EXCEPTION_RESOLVER | RUN-E1349A39 | EXCEPTION_UPDATED | update_exception_status |  |  |  | INVESTIGATING |
| 57 | 08:00 | EXCEPTION_RESOLVER | RUN-E1349A39 | DECISION |  | Ambiguous destination/link conflict between ORD-1012 and SHP-5012 → ESCALATE (HELD_AND_ESCALATED) | SOP-EXC-005, SOP-APR-001 |  | HELD_AND_ESCALATED |
| 58 | 08:00 | EXCEPTION_RESOLVER | RUN-E1349A39 | STATE_CHANGE | hold_order | Order ORD-1012 placed ON_HOLD: Destination conflict with SHP-5012; do not ship until resolved | SOP-EXC-005, SOP-APR-001 |  | OK |
| 59 | 08:00 | EXCEPTION_RESOLVER | RUN-E1349A39 | ESCALATION_CREATED | create_escalation | Escalated EXC-2007: Ambiguous destination/link conflict between ORD-1012 and SHP-5012 | SOP-EXC-005, SOP-APR-001 |  | OK |
| 62 | 08:00 | EXCEPTION_RESOLVER | RUN-E1349A39 | RUN_COMPLETED |  | Run COMPLETED: HELD_AND_ESCALATED |  |  | HELD_AND_ESCALATED |
| 64 | 08:00 | EXCEPTION_RESOLVER | RUN-6A9F13A4 | RUN_STARTED |  | EXCEPTION_RESOLVER run on EXC-2001 (mode: deterministic) |  |  |  |
| 65 | 08:00 | EXCEPTION_RESOLVER | RUN-6A9F13A4 | EXCEPTION_UPDATED | update_exception_status |  |  |  | INVESTIGATING |
| 72 | 08:00 | EXCEPTION_RESOLVER | RUN-6A9F13A4 | DECISION |  | Inventory shortfall on ORD-1004: SKU-007: needs 12, effective available 5 (short 7) → ESCALATE (HELD_AND_ESCALATED) | SOP-EXC-001, SOP-SOT-001, SOP-APR-001 |  | HELD_AND_ESCALATED |
| 73 | 08:00 | EXCEPTION_RESOLVER | RUN-6A9F13A4 | STATE_CHANGE | hold_order | Order ORD-1004 placed ON_HOLD: Inventory shortfall: SKU-007: needs 12, effective available 5 (short 7) | SOP-EXC-001, SOP-APR-001 |  | OK |
| 74 | 08:00 | EXCEPTION_RESOLVER | RUN-6A9F13A4 | ESCALATION_CREATED | create_escalation | Escalated EXC-2001: Inventory shortfall on ORD-1004: SKU-007: needs 12, effective available 5 (short 7) | SOP-EXC-001, SOP-SOT-001, SOP-APR-001 |  | OK |
| 77 | 08:00 | EXCEPTION_RESOLVER | RUN-6A9F13A4 | RUN_COMPLETED |  | Run COMPLETED: HELD_AND_ESCALATED |  |  | HELD_AND_ESCALATED |
| 78 | 08:00 | SHIFT_PLANNER | PLN-76C75BC6 | RUN_STARTED |  | SHIFT_PLANNER run on shift (mode: deterministic) |  |  |  |
| 82 | 08:00 | SHIFT_PLANNER | PLN-76C75BC6 | PLAN_CHANGE | generate_plan | Plan v2 (EXCEPTION_HOLD, from v1): 6 assigned, 2 in progress, 4 blocked, 1 infeasible, 0 SLA risk | SOP-PLN-001, SOP-PLN-002, SOP-PLN-003 |  | OK |
| 83 | 08:00 | SHIFT_PLANNER | PLN-76C75BC6 | RUN_COMPLETED |  | Run COMPLETED: PLAN_V2 |  |  | PLAN_V2 |
| 84 | 08:45 | OPERATOR | DEMO | SIM_CHANGE | advance_clock | SIMULATED: clock 08:00 → 08:45; 12 execution event(s) |  |  | OK |
| 85 | 08:45 | OPERATOR | DEMO | SIM_CHANGE | set_picker_availability | SIMULATED: P-02 AVAILABLE → UNAVAILABLE (Went home sick at 08:45) |  |  | OK |
| 86 | 08:45 | SHIFT_PLANNER | PLN-E1B61267 | RUN_STARTED |  | SHIFT_PLANNER run on shift (mode: deterministic) |  |  |  |
| 90 | 08:45 | SHIFT_PLANNER | PLN-E1B61267 | PLAN_CHANGE | generate_plan | Plan v3 (PICKER_UNAVAILABLE, from v2): 1 assigned, 2 in progress, 4 blocked, 2 infeasible, 0 SLA risk | SOP-PLN-001, SOP-PLN-002, SOP-PLN-003 |  | OK |
| 91 | 08:45 | SHIFT_PLANNER | PLN-E1B61267 | RUN_COMPLETED |  | Run COMPLETED: PLAN_V3 |  |  | PLAN_V3 |
