# Runbook — progress log, resume guide, operations

> **Purpose:** the single place to see *where the work stopped* and *how to resume* without re-reading the whole codebase. Update the **Status** and **Next steps** sections at the end of every work session.

## 1. Status snapshot (last updated: 2026-09-30, session 1 — optional features)

| Area | State | Evidence |
|---|---|---|
| PRD read + requirements matrix | ✅ done | `docs/PRD_ANALYSIS.md` |
| Phase 0 design | ✅ done (changes logged in §9) | `docs/PHASE_0_DESIGN.md` |
| DB schema + seed + reset | ✅ done | `server/src/db/*`, `npm run reset` |
| Controlled tools (framework, read, action, planner/sim) | ✅ done | `server/src/tools/*` |
| Shared SOP + retrieval | ✅ done | `server/src/policy/*`, `docs/POLICIES.md` |
| Exception Resolver (LLM + deterministic, assessment, guard, orchestrator, approvals) | ✅ done | `server/src/agents/resolver/*` |
| Planner (pure engine, versioned persistence, replanning, simulation clock) | ✅ done | `server/src/planner/*`, `server/src/tools/planner-tools.ts` |
| HTTP API + React UI (10 pages) | ✅ done, verified in headless Chromium (no console errors) | `server/src/http/app.ts`, `web/src/*` |
| Tests | ✅ 50/50 (`npm test`) | `server/test/*` |
| Scenarios | ✅ 18/18 deterministic, 18/18 Gemini (all runs LLM-driven) | `docs/results/scenario-results*.md` |
| Audit log examples | ✅ | `docs/results/audit-log-example.*` |
| Docs (README, ARCHITECTURE, DATA_MODEL, POLICIES, SCENARIOS, FAILURE_MODES, DEMO_SCRIPT, REFLECTION) | ✅ written, URL included | `docs/`, `README.md` |
| Railway deployment | ✅ live at https://app-production-fd3e.up.railway.app — full demo path verified in a browser with Gemini; environment reset to baseline afterwards | see §4 |
| GitHub repo push | ✅ public: https://github.com/sunkaramahesh09/warehouse-agent | `git push` after each change |
| Demo video | ⬜ user to record using `docs/DEMO_SCRIPT.md` | — |
| Final acceptance checklist | ✅ | §6 |
| **Optional features** (branch `feature/optional-extras`) | ✅ built: event-driven automation, metrics + eval harness, local-search optimizer, LLM pacing. 54 tests, 20/20 scenarios (det.), eval 100% (det. + Gemini). Deployed to Railway and verified live | `docs/OPTIONAL_FEATURES.md` |
| Merge optional features to `main` | ✅ merged + tagged `v1.1-optional` | §2a |
| UI redesign (reference screenshots in docs/ui-reference) | ✅ all 12 pages + shell; verified locally and live | `docs/UI_REDESIGN_PLAN.md` |
| Clean LLM run of the 2 new scenarios | ⬜ blocked by Gemini free-tier daily quota (500/day, exhausted 2026-09-30). After the reset (midnight Pacific): `DATABASE_URL=…/warehouse_llm LLM_MIN_INTERVAL_MS=4500 npm run scenario -- all --llm`, check that the Agent-runs lines show no fallback, commit | §2 |

## 2. Next steps (in order)

1. ~~Deploy + verify~~ ✅ · ~~URL in README/PRD_ANALYSIS~~ ✅ · ~~re-run tests/scenarios~~ ✅ (50/50, 18/18)
4. ~~GitHub push~~ ✅ · ~~acceptance checklist~~ ✅
5. Optional polish only (see REFLECTION next improvements). After any code change: `npm test`, `npm run scenario -- all`, `railway up --service app --detach`, reset the live env, `git push`.
6. User: record the demo (8–12 min) following `docs/DEMO_SCRIPT.md`, submit (only once!) before **Sun Oct 4 2026, 06:01 AM**.

## 2a. Rollback / safe points

| Safe point | Git | Railway deployment | What it contains |
|---|---|---|---|
| **v1.0-core** | tag `v1.0-core` (commit `0258da2`, pushed to GitHub) | `17feacdc-8788-46e4-81f2-c7980d7a1fb2` | Complete core submission: all MUST requirements, 50 tests, 18/18 scenarios, deployed and verified |
| **v1.1-optional** | tag `v1.1-optional` (merge `2155a87`) | `a575f534-6b17-4883-aa8e-c0f0c854b306` | + event-driven automation, metrics/eval, local-search optimizer, LLM pacing. 54 tests, 20/20 scenarios |
| **ui-redesign-start** | tag `ui-redesign-start` (= v1.1 + runbook) | `a575f534…` | Last state before the UI redesign |
| **v1.2-ui** | tag `v1.2-ui` | `ca2bf997-a901-4b9e-959c-6be83f46ed92` | Presentation-layer redesign (docs/UI_REDESIGN_PLAN.md) + approved `useApi` race fix; backend unchanged |
| **v1.2.1-ui** (current `main`) | tag `v1.2.1-ui` | `25506de5-8063-4764-9b46-dd69f46f5112` | Fixed sidebar: only the main panel scrolls |

Optional features were developed on `feature/optional-extras` and merged to `main` after tests + scenarios passed.

**Roll back code:** `git checkout main && git reset --hard v1.0-core && git push --force-with-lease origin main` (or just `git checkout v1.0-core` to inspect).
**Roll back the live app:** `git checkout v1.0-core && railway up --service app --detach` (redeploys that code), or in the Railway dashboard → app → Deployments → `17feacdc…` → Redeploy. The DB schema is recreated by `POST /api/reset`, so after a code rollback always reset the environment.

## 3. Local development

Prereqs: Node ≥ 22, Docker.

```bash
docker run -d --name warehouse-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=warehouse -p 5433:5432 postgres:17-alpine
docker exec warehouse-pg psql -U postgres -c 'CREATE DATABASE warehouse_test'
cp .env.example .env          # put LLM_API_KEY (Gemini) in .env — never commit it
npm install
npm run reset                 # baseline seed
npm run build && npm start    # http://localhost:3001  (API + UI)
# or dev mode: npm run dev:api  +  npm run dev:web  (http://localhost:5173)
npm test                      # 50 tests (uses warehouse_test DB)
npm run scenario -- all       # 18 scenarios, writes docs/results/scenario-results.md
npm run scenario -- all --llm # same with Gemini (slow on free tier; use a separate DB if the app is running)
npm run demo:trace            # regenerates docs/results/audit-log-example.*
```

Existing container on this machine: `warehouse-pg` (port 5433) with DBs `warehouse`, `warehouse_test`, `warehouse_llm`, `warehouse_docker`.

## 4. Deployment (Railway)

- Account: **sunkaramahesh555@gmail.com** (the other account, sunkaramahesh2005@, hit the free-plan project limit).
- Project: `warehouse-agent` (id `f71b5822-6630-4cba-a9f5-47004c36ba3e`), linked in this directory (`railway status`).
- Services: `app` (built from `Dockerfile`), `Postgres` (Railway template).
- `app` variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `LLM_API_KEY` (secret), `LLM_MODEL=gemini-3.1-flash-lite`, `AGENT_MODE=auto`, `PORT=3001`.
- Deploy: `railway up --service app --detach` · logs: `railway logs --service app` · URL: `railway domain --service app`.
- First boot auto-seeds an empty DB. Reset from UI or `curl -X POST <url>/api/reset -H 'x-role: operator'`.

## 5. Gotchas learned (save time next session)

- `gemini-2.5-flash` → 404 for new keys; `gemini-3.5-flash` free tier = 20 requests. Use **`gemini-3.1-flash-lite`**.
- Gemini 3 returns `extra_content` (thought signatures) on tool calls; the provider echoes it back.
- **Gemini free tier = 500 requests/day** for gemini-3.1-flash-lite (a full LLM suite ≈ 150–200 requests, an eval ×2 ≈ 120). Budget it: leave quota for recording the demo on the live URL.
- Don't run LLM eval/suite/live demo concurrently on the free key (per-minute quota → fallbacks). Use `LLM_MIN_INTERVAL_MS=4000+`.
- A green LLM scenario run can hide fallbacks — check the "Agent runs" line in `scenario-results-llm.md` (must say `:llm`, not `llm->deterministic`).
- Tailwind v4: custom classes used in `@apply` must be declared with `@utility`.
- Scenario runs **reset** the database they run against — don't run them against the DB you are demoing from.
- npm 11 warns about blocked install scripts (esbuild); harmless locally, Docker uses Node 22/npm 10.

## 6. Acceptance checklist (tick when verified)

- [x] PRD read, requirements mapped · [x] shared environment · [x] 20 orders / 10 SKUs / 9 shipments / 5 pickers
- [x] six exception types + ambiguous case · [x] reproducible scenarios + reset · [x] shared SOP + retrieval + citations
- [x] investigator/decision/planner separation · [x] controlled tools · [x] autonomous · [x] escalation (structured)
- [x] confirmation-gated with real approval · [x] deterministic planner (inventory, capacity, deadline, progress, location)
- [x] infeasibility vs error · [x] replanning (picker unavailable + urgent order) · [x] plan versions · [x] cross-agent
- [x] audit trail + examples · [x] failure handling (F1–F13) · [x] scenario runner · [x] 50 automated tests
- [x] UI · [x] README · [x] Phase 0 · [x] architecture/policy/scenario docs · [x] reflection + AI disclosure · [x] demo script
- [x] deployed URL verified · [x] GitHub repo pushed · [x] no secrets committed (`.env` ignored) · [x] simulated labelling
