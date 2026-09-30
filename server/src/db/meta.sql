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
