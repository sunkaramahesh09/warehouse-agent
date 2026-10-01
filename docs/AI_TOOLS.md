# AI tools used to complete this project

This document lists every AI tool used, what it was used for, and how its output was checked. It expands the short disclosure in [REFLECTION.md](REFLECTION.md#ai-assistance-disclosure).

## 1. Claude Code (Anthropic) — development assistant

**What it is:** Anthropic's agentic coding assistant, running in the terminal against this repository (Claude models; Claude Opus in the later sessions).

**What it was used for**

| Area | Use |
|---|---|
| Requirements | Reading the PRD and drafting the requirement-by-requirement traceability matrix ([PRD_ANALYSIS.md](PRD_ANALYSIS.md)) and the Phase 0 design ([PHASE_0_DESIGN.md](PHASE_0_DESIGN.md)) |
| Code | Generating most of the TypeScript: database schema and seed, controlled tool framework, read/action tools, Exception Resolver (investigators, assessment, guard, orchestrator, approvals), deterministic planner and replanning, HTTP API, React UI, optional features (event outbox, metrics/evaluation, local-search optimizer) |
| Tests | Writing the unit/integration tests (54) and the 20 scenario definitions; running them and the evaluation harness |
| Debugging | Diagnosing failures from test output, audit events and run reports (e.g. the silent LLM fallback described in REFLECTION) |
| UI | The UI redesign, the original logo and the inline-SVG page artwork (hand-coded SVG, no image-generation model), the header-art tilt and the compact header; verified with screenshots in a headless Chromium browser |
| Documentation | Drafting README, architecture, data model, SOP, scenarios, failure modes, demo script, reflection and this document |
| Operations | Running the Railway deployments and live checks through the Railway CLI, and keeping a runbook of safe points |

**What stayed with me:** the interpretation of ambiguous requirements, the architecture and safety boundaries (what the LLM may and may not do), approving or rejecting proposed designs, the UI direction, and the decision to ship each change. I reviewed the results and required evidence (tests, scenario checks, audit logs, screenshots) before accepting changes.

## 2. Google Gemini — runtime LLM inside the product

**Model:** `gemini-3.1-flash-lite` (free tier), called through an OpenAI-compatible endpoint by a small provider abstraction (`server/src/llm/`), swappable by environment variables.

**Role in the product**

- **Exception Resolver:** chooses which read-only investigation tools to call, and writes the explanation and a *proposed* outcome.
- **Shift Planner:** can optionally explain a plan in plain language.

**Boundaries (enforced in code, not by the prompt):** the LLM never changes state directly. A deterministic assessment and a guard (SOP-APR-001) decide what is permitted; every state change goes through validated, audited, idempotent tools; actions that need approval wait for a human. The planner's arithmetic and constraint checks are deterministic. If the LLM is unavailable or over quota, the run falls back to the deterministic investigator and records `llm->deterministic` with the reason.

## 3. How AI output was verified

- `npm test` — 54 unit and integration tests.
- `npm run scenario -- all` — 20 scenarios whose verdicts are computed from **database state**, never from agent text; the same suite runs with Gemini (`--llm`) and reports which path (LLM or fallback) each run used.
- `npm run eval` — repeated-run evaluation of the resolver: accuracy, consistency, model agreement, guard overrides, unsafe actions.
- Audit-log examples (`docs/results/`) and a live demo path run against the deployed URL.

## 4. Not AI-generated

- No AI image generation was used. The page artwork and logo are hand-written SVG code. (Royalty-free stock photos were tried briefly during the UI work and then removed.)
- All data is fictional and simulated; no real warehouse, carrier or customer data was given to any AI tool.
