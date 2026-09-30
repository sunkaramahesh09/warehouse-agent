# UI Redesign Plan (presentation layer only)

**Scope:** a visual redesign of the existing, working web UI (`web/src`) using the references in [`docs/ui-reference/`](ui-reference/). **No** backend, API, schema, planner, resolver, policy, audit or scenario logic changes.

**Safety:** git tag `ui-redesign-start` (pushed) = last commit before any UI change. All work happens on branch `feature/ui-redesign`, with one commit per page. `main` stays on `v1.1-optional` until everything is verified. Rollback: `git checkout main`, or `git reset --hard ui-redesign-start`.

---

## 1. How the current UI works (inspected before editing)

| Concern | Current implementation | Must stay |
|---|---|---|
| Routing | Hash routes in `App.tsx`: `#/dashboard`, `#/orders`, `#/inventory`, `#/pickers`, `#/exceptions`, `#/queue`, `#/planner`, `#/events`, `#/audit`, `#/metrics`, `#/scenarios`, `#/policies` | ✅ identical route keys |
| Data fetching | `useApi(path)` (GET), refetches after **any** mutation via `notifyChanged()` | ✅ unchanged |
| Mutations | `api.post()` sends the `x-role` / `x-actor` headers. `useAction()` gives busy/error state | ✅ unchanged |
| Role separation | Header select → `setRole()` → `x-role` header. The server enforces permissions per tool | ✅ same control, restyled |
| State | No client store. Server state only (plus role in localStorage) | ✅ |
| Backend contract | 38 routes. The UI uses 17 GETs + 16 POSTs (listed in §6) | ✅ no changes |
| Tests | Server: 54 vitest + 20 scenarios. UI: headless Chromium walk-throughs of the demo flows | ✅ rerun after every page |

## 2. What the references define, and what they do not

The references define the **visual language**: light blue-grey canvas, white cards with soft shadows and rounded corners, deep-navy type, deep-teal primary actions, pastel status chips, icon tiles on KPI cards, a two-line breadcrumb + large page title, subtle warehouse illustrations, a sidebar footer card, a polished header with environment/clock/LLM/role/reset.

They are **mockups with placeholder data**. The following are *not* copied, because they would invent data or features (explicitly forbidden):

| In the reference | Why not copied | What we do instead |
|---|---|---|
| Sparkline/bar mini-charts on KPI cards | No time-series data exists; they would imply fake trends | Icon tiles only, with real values and real sub-labels |
| "↑ 2 new today", "Approved today", "Avg review time", "Events processed this session" | Not stored/computed by the backend | Counts derivable from real API data only (e.g. approvals by status) |
| Exception severity High/Medium/Low | The domain has no severity | Show the real type, status, order and detected time |
| Picker states "On break" / "Offline" | Only AVAILABLE/UNAVAILABLE exist | Real availability |
| "System status: Background jobs Running" | There are no background jobs (dispatcher runs per request) | System status built only from verifiable facts: API reachable, DB seed version, LLM configured/model, automation switches |
| Policy params in the screenshot (e.g. `"partial_shipment": false`) | Not the real SOP | Exact `params` from `/api/policies` |
| Event types `INVENTORY_UPDATED`, `ORDER_UPDATED` | Don't exist | Real `DomainEventType` names |
| "Start guided demo", "Manage pickers", audit "Last 1h/6h" time presets | No such feature/semantics | Not added (no decorative buttons) |
| Stock "Healthy/Low/Critical" with invented thresholds | Thresholds are not policy | A stock bar = `available / on_hand` (a visualisation of existing values) plus a **"short vs open demand"** flag computed from real `/api/orders` demand vs `effective_available`, labelled as such |
| Stock photos / branded imagery | Copyright + weight | Original lightweight inline-SVG warehouse illustrations (shelves, boxes, forklift), `aria-hidden`, hidden on small screens |

Client-side-only additions that just re-present data already returned (search boxes, filters, pagination, tabs, table/card toggles) are allowed: they don't change any data or behaviour.

## 3. Design system

| Token | Value |
|---|---|
| Canvas | `#F3F6FA` (very light blue-grey) · Surface `#FFFFFF` · Border `#E3E8EF` |
| Primary | teal-800 `#115E59` (actions), hover teal-900. Accent teal-600 |
| Text | navy `#0F1B35` headings, slate-600 body, slate-500 muted |
| Status | success emerald · warning amber · danger rose · info sky/blue · neutral slate. Pastel background + 1px ring + dark text (AA contrast) |
| Radius / shadow | cards `rounded-2xl` + `shadow-[0_1px_2px_rgba(16,24,40,.04),0_4px_16px_rgba(16,24,40,.04)]`; controls `rounded-lg` |
| Type | Inter (self-hosted via `@fontsource-variable/inter`, no external request). Page title 32–36/700 navy, section 15/600, table 13, labels 11 uppercase tracking |
| Spacing | 4-px scale. Page gutter 24–32, card padding 16–20, grid gap 16 |
| Icons | **lucide-react** only (tree-shaken, consistent 1.75 stroke) |
| Focus | visible `ring-2 ring-teal-600/40` on every interactive element |

**Shared components** (`web/src/components/`): `AppShell` (sidebar + header), `PageHeader` (breadcrumb, title, description, actions, illustration slot), `StatCard`, `StatusBadge` (single status→tone map), `SectionCard`, `EmptyState`, `LoadingState`/`Skeleton`, `ErrorState` (operation + what to do), `SearchInput`, `Select`, `FilterBar`, `Tabs`, `Pagination`, `Illustration`, `KeyValue`, plus the existing domain components `RunReport`, `ApprovalCard`, `EscalationCard` (restyled, logic untouched).

## 4. Page mapping: reference → existing code → changes → functionality that must stay

| # | Reference | Existing page/component | UI changes | Functionality preserved (must verify) |
|---|---|---|---|---|
| 0 | all | `App.tsx` shell, `ui.tsx`, `index.css` | New sidebar (icons, active state, badge counts, footer card), header (sim-environment banner, sim clock + shift end, LLM chip, role select, Reset). Design tokens, font, icons | Hash routing; role switch → `x-role`; Reset → `POST /api/reset` with confirm; pending badge from `/api/dashboard`; banner "SIMULATED ENVIRONMENT … all actions are simulated" always visible |
| 1 | 01-dashboard | `pages/Dashboard.tsx` | Title + hero, 8 KPI cards, order-status + picker-availability donuts (real `/api/dashboard` counts), recent activity timeline, suggested demo path, verifiable system status | Same `/api/dashboard` + `/api/meta` data; no invented metrics |
| 2 | 02-orders | `pages/Orders.tsx` | KPI strip, search + status/priority/exception filters, polished table (priority pills, deadline chips with overdue marker vs sim clock, invalid-qty highlight, exception + shipment chips, picker), expandable row details | `/api/orders` data unchanged; status filter kept; row expand kept |
| 3 | 03-inventory | `pages/Inventory.tsx` | KPIs (SKUs, shipments, SKUs where the count supersedes the system, SKUs short vs open demand), search, tabs Inventory/Shipments, location chips, skill chips, stock bar, cycle-count column, effective-available emphasis | Values exactly as returned (`on_hand`, `reserved`, `available`, `effective_available`, counts) |
| 4 | 04-pickers | `pages/Pickers.tsx` | KPIs (available, unavailable, total capacity, consumed), avatar, availability chip, skills, utilisation bar (planned/capacity), filters, skills overview, capacity summary | **Mark unavailable/available** → prompt → `POST /api/sim/picker` (operator only) |
| 5 | 05-exceptions | `pages/Exceptions.tsx`, `components/RunReport.tsx` | KPIs by status, search + status/type filters, queue as rich rows with type icons, investigation panel with a 5-stage **pipeline** (Read tools → Evidence → Policy → Guarded decision → Action/Escalation), empty state explaining the agent | **Investigate** → `POST /api/exceptions/:id/investigate {mode}`; agent-mode select (auto/deterministic/LLM); disabled states for handled exceptions; report sections incl. guard notes, fallback, verification; earlier runs |
| 6 | 06-approvals-escalations | `pages/Queue.tsx`, `ApprovalCard`, `EscalationCard` | KPIs from real statuses, two sections with empty states + "what requires approval / when escalation happens" (text from SOP-APR-001/SOP-EXC-005 semantics), tabs by status, search | **Approve & execute / Reject** (operator), **Retry execution**, **Record resolution** (+ release hold) (reviewer). Role gating unchanged |
| 7 | 07-shift-planner | `pages/Planner.tsx` | KPI strip, "deterministic arithmetic" note, grouped mid-shift controls, tabs Plan / Assignments / Unscheduled / Changes, version pills, timelines, optimizer panel, empty state "what the planner considers" | Strategy select; Generate/Refresh/Refresh-after-exception; +15/30/45/60; picker unavailable; urgent order; inventory drop; planner-failure fault; auto-replan checkbox vs server auto-replan; version history; change log; explanation |
| 8 | 08-events-automation | `pages/Events.tsx` | KPIs (events by status, switches on), switch cards with *real* trigger event names, cycle-count form card, event log with type/status/source filters + empty state | Switches → `POST /api/automation` (optimistic + revert); Record count → `POST /api/sim/cycle-count`; Process now → `POST /api/events/process` |
| 9 | 09-audit-log | `pages/Audit.tsx` | Filter card (workflow, event type, run id, include reads, search), sequence table with workflow/event/outcome chips, expandable details, client pagination, export | Same `/api/audit` query params; run-id click filter; JSONL export link |
| 10 | 10-metrics-evaluation | `pages/Metrics.tsx` | Sectioned KPI groups (Resolver / Planner / Tests & evaluation), plan history table, eval batch table + breakdown; "current environment" vs "persistent history" labels | Run evaluation → `POST /api/eval/run` (confirm); values exactly from `/api/metrics` |
| 11 | 11-scenarios-tests | `pages/Scenarios.tsx` | Test-console cards with category chip + icon, setup/trigger/expected/boundary/reset grid, verdict chip, checks table, summary bar, mode select, Run all | **Run** → `POST /api/scenarios/:id/run {mode}`; **Run all** → `POST /api/scenarios/run-all`; LLM option disabled without key |
| 12 | 12-policies | `pages/Policies.tsx` | Policy library cards (id, title, category from id prefix, applies-to, exact rule text, params block + copy), search, category filter, grid/list toggle, "View" expands full text | Same `/api/policies` data, verbatim |

## 5. Verification per page (repeat after each page)

1. `tsc --noEmit` + `vite build` (web). 2. Server `npm test` (54) when anything shared changes. 3. Headless Chromium walk of that page's real actions against a live local server (clicks → API → state change visible), no console errors, no horizontal overflow at 1440 / 1024 / 768 widths. 4. Commit.

End-to-end flows re-verified at the end (local + deployed): Investigate (evidence → policy → decision → action/escalation), Approval (propose → approve → execute), Planner (generate → change → replan), Cross-agent (hold → refresh → blocked), Events (count → detect → automation → audit), Audit (action → event), Scenario (run → checks → verdict), full DEMO_SCRIPT path.

## 6. API usage inventory (must be identical after redesign)

GET: `/api/meta`, `/api/dashboard`, `/api/orders`, `/api/inventory`, `/api/shipments`, `/api/pickers`, `/api/policies`, `/api/exceptions`, `/api/exceptions/:id`, `/api/approvals`, `/api/escalations`, `/api/plans`, `/api/plans/:version`, `/api/events`, `/api/audit?…`, `/api/metrics`, `/api/scenarios` (+ link `/api/audit/export.jsonl`).
POST: `/api/reset`, `/api/exceptions/:id/investigate`, `/api/approvals/:id/decide`, `/api/approvals/:id/execute`, `/api/escalations/:id/resolve`, `/api/planner/run`, `/api/sim/{advance,picker,urgent-order,inventory,fault,cycle-count}`, `/api/automation`, `/api/events/process`, `/api/eval/run`, `/api/scenarios/:id/run`, `/api/scenarios/run-all`.

---

## 7. Final report

*(Filled in when the redesign is complete; see below.)*
