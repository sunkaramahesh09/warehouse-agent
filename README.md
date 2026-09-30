# Warehouse Ops — Order Exception Resolver + Shift Planner

A small, controlled, observable warehouse-operations prototype. Two cooperating AI-enabled workflows run on **one simulated WMS/OMS database**:

1. **Order Exception Resolver**: investigates an exception with real tool calls, gathers evidence, retrieves the shared SOP, and then either performs a permitted simulated action, asks a human for explicit approval, or produces a structured escalation.
2. **Shift Task Planner**: a deterministic scheduler that assigns eligible orders to pickers under inventory, capacity, skill, deadline and existing-progress constraints, then replans incrementally when conditions change.

> ⚠️ **Simulated prototype.** All data is fictional; nothing connects to a real warehouse, carrier, or customer system. Every action is simulated and labelled as such.

**Deployed URL:** https://app-production-fd3e.up.railway.app (Railway: Docker service + PostgreSQL; the Gemini-driven agent is enabled)

| Document | What's in it |
|---|---|
| [docs/PRD_ANALYSIS.md](docs/PRD_ANALYSIS.md) | Requirement-by-requirement traceability + assumptions |
| [docs/PHASE_0_DESIGN.md](docs/PHASE_0_DESIGN.md) | Entities, source of truth, exception catalogue + boundaries, planning policy, failure modes, SOP (written before code) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, tool pipeline, resolver/approval/planner flows, LLM vs deterministic responsibilities |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Schema, constraints, seed, reset/persistence |
| [docs/POLICIES.md](docs/POLICIES.md) | The 11 shared SOP rules and where each is enforced |
| [docs/SCENARIOS.md](docs/SCENARIOS.md) | 18 reproducible scenarios (setup, trigger, expected, boundary, reset) |
| [docs/FAILURE_MODES.md](docs/FAILURE_MODES.md) | 13 failure modes, explicit states, recovery, evidence |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | 8–12 minute live demo steps |
| [docs/REFLECTION.md](docs/REFLECTION.md) | Design decisions, **AI assistance disclosure**, changes from Phase 0, debugging lesson, risks, next steps |
| [docs/OPTIONAL_FEATURES.md](docs/OPTIONAL_FEATURES.md) | Event-driven automation, metrics + evaluation harness, local-search optimizer |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operations + progress log / resume guide |
| [docs/results/](docs/results/) | Scenario results (deterministic and Gemini) and audit-log examples (JSONL + table) |

## Architecture in one picture

```
React UI ──HTTP──► Fastify API ──► Resolver orchestrator ─┬─ LLM investigator (Gemini tool calling)  ┐ read-only
                                  │                        └─ deterministic investigator             ┘ tools only
                                  │                        assessment (pure) → guard (pure, SOP-APR-001) → action tools
                                  ├─► Planner agent → generate_plan → pure deterministic engine
                                  └─► executeTool(): role → zod → fault check → tx{idempotency → business rules} → audit
                                                                   ▼
                                    PostgreSQL (one shared schema: orders, inventory, shipments, pickers,
                                    exceptions, approvals, escalations, plans, policies, audit_events …)
```

The LLM chooses which evidence to gather and explains; **deterministic code decides what is permitted, does all arithmetic, and executes every state change through validated, audited, idempotent tools**. Details are in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech stack

TypeScript everywhere · Node 22 · Fastify 5 · PostgreSQL 17 (`pg`, raw SQL) · zod 4 · React 19 + Vite + Tailwind 4 · Vitest · Google Gemini (`gemini-3.1-flash-lite`) through an OpenAI-compatible provider abstraction (plain `fetch`, swappable by env vars) · Docker · Railway.

## Requirements

- Node.js ≥ 22 and npm
- PostgreSQL (Docker is easiest)
- Optional: a free Gemini API key (https://aistudio.google.com/apikey). Without it the agent runs in deterministic mode, and everything else works the same.

## Installation & setup

```bash
git clone https://github.com/sunkaramahesh09/warehouse-agent.git && cd warehouse-agent
npm install

# PostgreSQL on port 5433 (+ a separate DB for tests)
docker run -d --name warehouse-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=warehouse -p 5433:5432 postgres:17-alpine
docker exec warehouse-pg psql -U postgres -c 'CREATE DATABASE warehouse_test'

cp .env.example .env      # then set LLM_API_KEY (optional). Never commit .env.
```

### Environment variables (`.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5433/warehouse` | App database |
| `TEST_DATABASE_URL` | `…/warehouse_test` | Used by `npm test` (it resets this DB) |
| `PORT` | `3001` | HTTP port (API + UI) |
| `AGENT_MODE` | `auto` | `auto` = LLM if a key is set, else deterministic · `llm` · `deterministic` |
| `LLM_API_KEY` | — | Secret. Gemini key (or any OpenAI-compatible provider key) |
| `LLM_MODEL` | `gemini-3.1-flash-lite` | Model id |
| `LLM_BASE_URL` | Gemini OpenAI-compatible endpoint | Change to use OpenAI/Groq/etc. |
| `LLM_TIMEOUT_MS` | `30000` | Per-request timeout |
| `LLM_MIN_INTERVAL_MS` | `0` (4000 on Railway) | Client-side spacing between LLM requests to stay under free-tier RPM limits |

## Database setup, seed and reset

```bash
npm run reset        # drop + recreate schema, load the baseline seed (also: npm run seed)
```

The server also auto-seeds an empty database on first start. In the UI, use **↺ Reset environment** (Operator role); via the API, `POST /api/reset` with header `x-role: operator`. Every scenario resets before it runs.

## Run

```bash
npm run build && npm start      # production-style: http://localhost:3001 serves API + UI
# development (hot reload):
npm run dev:api                 # http://localhost:3001
npm run dev:web                 # http://localhost:5173 (proxies /api)
```

## Tests and scenario runner

```bash
npm test                              # 54 tests: planner/rules/guard unit tests + all scenarios against Postgres
npm run scenario -- all               # 20 named scenarios, expected vs actual → docs/results/scenario-results.md
npm run scenario -- cross-agent       # one scenario (ids: see docs/SCENARIOS.md)
npm run scenario -- all --llm         # drive the resolver with Gemini → docs/results/scenario-results-llm.md
npm run eval                          # repeated-run resolver evaluation → docs/results/eval-report.md (add -- --llm for Gemini)
npm run demo:trace                    # demo storyline → docs/results/audit-log-example.{jsonl,md}
npm run typecheck
```

Current results: **20/20 scenarios** (deterministic) · **18/18 core scenarios with Gemini, all LLM-driven** · **54/54 tests** · evaluation 100% accuracy, 0 unsafe actions in both modes (see `docs/results/`). The free Gemini tier allows 500 requests/day; when that is used up the agent visibly falls back to deterministic mode.

Scenario ids: `inventory-shortfall`, `duplicate-order`, `shipment-desync`, `shipment-desync-contradictory`, `invalid-data`, `stale-shipment`, `destination-conflict`, `planning-cycle`, `replanning`, `urgent-order`, `cross-agent`, `tool-timeout`, `missing-record`, `duplicate-action`, `approval-expiry`, `inventory-drift`, `planner-failure`, `unsafe-llm-proposal`, `event-driven`, `optimizer`.

## Optional features (beyond MUST)

- **Event-driven automation:** a transactional outbox of domain events. Cycle-count ingestion → deterministic shortfall detector → optional auto-investigation → one coalesced auto-replan. Operator switches are on the *Events & Automation* page. Automation never approves anything.
- **Metrics & evaluation:** a live dashboard (correct-outcome rate, escalation recall/precision, **unsafe-action count**, LLM agreement/override/fallback, plan feasibility, preservation on replan, optimizer gains) plus a repeated-run evaluation harness with persistent history.
- **Advanced scheduling:** an opt-in local search (relocate/swap) over the greedy plan with a lexicographic objective (SLA risk → lateness → churn → makespan). It is constraint-safe and deterministic, and every move is explained (baseline makespan 109 → 85 min).

Details and design rationale: [docs/OPTIONAL_FEATURES.md](docs/OPTIONAL_FEATURES.md).

## Deployment (Railway)

One Docker service built from `Dockerfile` (Fastify serves the built UI) plus a Railway PostgreSQL service:

```bash
railway init --name warehouse-agent
railway add --database postgres
railway add --service app --variables 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --variables LLM_API_KEY=… --variables LLM_MODEL=gemini-3.1-flash-lite
railway up --service app --detach
railway domain --service app
```

## Demo walkthrough (short version; full script in docs/DEMO_SCRIPT.md)

1. **Shift Planner → Generate plan** (v1): ORD-1004 is assigned, with a warning about open EXC-2001.
2. **Exceptions → EXC-2003** → autonomous forward status sync (tool calls → evidence → SOP-SOT-002 → ✓ action → re-read state).
3. **EXC-2004** → contradictory records → structured escalation, state preserved.
4. **EXC-2002** → duplicate → hold + **Proposed action** card → **Approve & execute** (Operator only) → ORD-1011 cancelled exactly once.
5. **EXC-2007** → ambiguous → hold + escalation with unresolved questions, no relink.
6. **EXC-2001** → shortfall → ORD-1004 held → Planner **Refresh after exception** → ORD-1004 **BLOCKED by EXC-2001**.
7. **+45 min** → **P-02 unavailable** → v3 with a per-order change log (progress preserved, COLD order infeasible).
8. **Audit Log** (filter by run id, export JSONL) and **Scenarios & Tests → Run all**.

Roles: use the header switch. **Operator / Supervisor** runs workflows, injects changes, approves or rejects. **Exception Reviewer** resolves escalations. This is basic separation for the prototype, not authentication.

## Known limitations (prototype vs production)

- No authentication; roles are selected in the UI. A single shared demo database means reviewers share state and a reset affects everyone. Mutations are serialised in-process (single instance).
- The free Gemini tier is rate-limited, and an investigation takes about 10–40 s. On quota exhaustion the run transparently falls back to the deterministic investigator (shown as `llm->deterministic` with the reason).
- LLM tool sequences vary between runs; outcomes are bounded by the deterministic guard.
- The planner is greedy (not globally optimal), never splits orders, and uses a simple zone-distance travel model. Picking execution is simulated linearly by the simulated clock.
- The mapping from exception type to its governing policy is in code; policy text and parameters are shared data.

More detail is in [REFLECTION.md](docs/REFLECTION.md#remaining-risks-and-limitations).

## AI assistance disclosure

Built with substantial help from **Claude Code (Anthropic)** for requirements analysis, code generation, tests, documentation, and debugging. At runtime the resolver uses **Google Gemini** for tool selection and explanations. The candidate is responsible for the requirements interpretation, architecture, safety boundaries, validation and final decisions. See [REFLECTION.md](docs/REFLECTION.md#ai-assistance-disclosure).
