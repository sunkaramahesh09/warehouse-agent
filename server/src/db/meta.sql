-- Survives environment reset: scenario/test outcome history.
CREATE TABLE IF NOT EXISTS scenario_results (
  id            BIGSERIAL PRIMARY KEY,
  scenario_id   TEXT NOT NULL,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode          TEXT NOT NULL,
  verdict       TEXT NOT NULL CHECK (verdict IN ('PASS','PARTIAL','FAIL')),
  checks        JSONB NOT NULL,
  notes         TEXT
);

-- Survives reset: repeated-run evaluation of the resolver (npm run eval).
CREATE TABLE IF NOT EXISTS eval_results (
  id              BIGSERIAL PRIMARY KEY,
  batch_id        TEXT NOT NULL,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode_requested  TEXT NOT NULL,
  mode_used       TEXT NOT NULL,
  model           TEXT,
  exception_id    TEXT NOT NULL,
  repetition      INT NOT NULL,
  expected        TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  correct         BOOLEAN NOT NULL,
  proposal        TEXT,
  final_decision  TEXT,
  agreed          BOOLEAN,
  overridden      BOOLEAN,
  tool_calls      INT NOT NULL,
  duration_ms     INT NOT NULL,
  fallback_reason TEXT,
  unsafe_actions  INT NOT NULL DEFAULT 0
);
