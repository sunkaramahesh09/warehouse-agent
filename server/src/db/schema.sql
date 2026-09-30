-- Warehouse simulation schema. Recreated from scratch by reset (DROP SCHEMA ... CASCADE).
-- Note: some constraints are intentionally NOT enforced at the DB level (e.g. requested_qty > 0,
-- created_at <= deadline) because the environment must be able to hold *seeded* malformed data
-- for the resolver to detect. Validity is enforced by tool-level validation and the planner gate.

CREATE TABLE sim_state (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sim_now       TIMESTAMPTZ NOT NULL,
  shift_start   TIMESTAMPTZ NOT NULL,
  shift_end     TIMESTAMPTZ NOT NULL,
  -- fault injection: { "<tool_name>": { "mode": "TIMEOUT" | "ERROR", "remaining": n } }
  faults        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- event-driven automation switches (operator-controlled)
  automation    JSONB NOT NULL DEFAULT '{"auto_detect": true, "auto_investigate": false, "auto_replan": false}'::jsonb,
  seed_version  TEXT NOT NULL
);

CREATE TABLE policies (
  policy_id     TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  rule          TEXT NOT NULL,
  applies_to    TEXT[] NOT NULL,
  keywords      TEXT[] NOT NULL,
  params        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE locations (
  location_id   TEXT PRIMARY KEY,
  zone          TEXT NOT NULL CHECK (zone IN ('A','B','C','D')),
  aisle         INT NOT NULL,
  x             INT NOT NULL
);

CREATE TABLE skus (
  sku                    TEXT PRIMARY KEY,
  description            TEXT NOT NULL,
  pick_minutes_per_unit  NUMERIC(5,2) NOT NULL CHECK (pick_minutes_per_unit > 0),
  required_skill         TEXT
);

CREATE TABLE inventory (
  sku           TEXT NOT NULL REFERENCES skus(sku),
  location_id   TEXT NOT NULL REFERENCES locations(location_id),
  on_hand       INT NOT NULL CHECK (on_hand >= 0),
  reserved      INT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  available     INT GENERATED ALWAYS AS (on_hand - reserved) STORED,
  last_updated  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (sku, location_id),
  CHECK (reserved <= on_hand)
);

CREATE TABLE inventory_counts (
  count_id      TEXT PRIMARY KEY,
  sku           TEXT NOT NULL REFERENCES skus(sku),
  location_id   TEXT NOT NULL REFERENCES locations(location_id),
  counted_qty   INT NOT NULL CHECK (counted_qty >= 0),
  counted_at    TIMESTAMPTZ NOT NULL,
  counted_by    TEXT NOT NULL
);

CREATE TABLE pickers (
  picker_id         TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  availability      TEXT NOT NULL CHECK (availability IN ('AVAILABLE','UNAVAILABLE')),
  unavailable_reason TEXT,
  capacity_minutes  INT NOT NULL CHECK (capacity_minutes >= 0),
  home_zone         TEXT NOT NULL CHECK (home_zone IN ('A','B','C','D')),
  skills            TEXT[] NOT NULL DEFAULT '{}',
  consumed_minutes  NUMERIC(7,2) NOT NULL DEFAULT 0   -- work already done this shift (simulation)
);

CREATE TABLE orders (
  order_id          TEXT PRIMARY KEY,
  status            TEXT NOT NULL CHECK (status IN ('PENDING','PICKING','PICKED','PACKED','SHIPPED','ON_HOLD','CANCELLED')),
  priority          INT NOT NULL CHECK (priority BETWEEN 1 AND 3),
  created_at        TIMESTAMPTZ NOT NULL,
  deadline          TIMESTAMPTZ NOT NULL,
  customer_ref      TEXT NOT NULL,
  destination_ref   TEXT NOT NULL,
  assigned_picker_id TEXT REFERENCES pickers(picker_id),
  hold_reason       TEXT,
  hold_exception_id TEXT,
  hold_prev_status  TEXT,
  updated_at        TIMESTAMPTZ NOT NULL,
  CHECK ((status = 'ON_HOLD') = (hold_prev_status IS NOT NULL))
);

CREATE TABLE order_lines (
  line_id        TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES orders(order_id),
  line_no        INT NOT NULL,
  sku            TEXT NOT NULL REFERENCES skus(sku),
  requested_qty  INT NOT NULL,             -- deliberately unconstrained: seeded invalid data
  picked_qty     INT NOT NULL DEFAULT 0,
  UNIQUE (order_id, line_no)
);

CREATE TABLE shipments (
  shipment_id      TEXT PRIMARY KEY,
  order_id         TEXT REFERENCES orders(order_id),
  status           TEXT NOT NULL CHECK (status IN ('LABEL_CREATED','PICKED_UP','IN_TRANSIT','DELIVERED')),
  carrier          TEXT NOT NULL,
  tracking_ref     TEXT NOT NULL,
  destination_ref  TEXT NOT NULL,
  label_created_at TIMESTAMPTZ NOT NULL,
  picked_up_at     TIMESTAMPTZ,
  last_scan_at     TIMESTAMPTZ
);

CREATE TABLE exceptions (
  exception_id   TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL,             -- no FK: an exception may reference a missing order (failure mode F1)
  type           TEXT NOT NULL CHECK (type IN ('INVENTORY_SHORTFALL','DUPLICATE_ORDER','STATUS_DESYNC','INVALID_DATA','STALE_SHIPMENT','DESTINATION_CONFLICT')),
  status         TEXT NOT NULL CHECK (status IN ('OPEN','INVESTIGATING','AWAITING_APPROVAL','RESOLVED','ESCALATED','FAILED','CLOSED')),
  summary        TEXT NOT NULL,
  evidence_refs  JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_at    TIMESTAMPTZ NOT NULL,
  last_run_id    TEXT,
  outcome        TEXT,
  resolution     JSONB
);

CREATE TABLE agent_runs (
  run_id       TEXT PRIMARY KEY,
  workflow     TEXT NOT NULL CHECK (workflow IN ('EXCEPTION_RESOLVER','SHIFT_PLANNER','OPERATOR','SCENARIO','SYSTEM')),
  subject_id   TEXT,
  mode         TEXT NOT NULL,          -- llm | deterministic | llm->deterministic (fallback) | n/a
  status       TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  report       JSONB
);

CREATE TABLE approvals (
  approval_id      TEXT PRIMARY KEY,
  exception_id     TEXT NOT NULL REFERENCES exceptions(exception_id),
  run_id           TEXT NOT NULL,
  action_type      TEXT NOT NULL,
  params           JSONB NOT NULL,
  effect           TEXT NOT NULL,
  reason           TEXT NOT NULL,
  policy_ids       TEXT[] NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','EXECUTING','EXECUTED','FAILED','EXPIRED')),
  idempotency_key  TEXT NOT NULL UNIQUE,
  requested_at     TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,   -- simulated time
  decided_by       TEXT,
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  executed_at      TIMESTAMPTZ,
  result           JSONB
);
-- at most one live proposal per exception
CREATE UNIQUE INDEX approvals_one_pending ON approvals(exception_id) WHERE status IN ('PENDING','APPROVED','EXECUTING');

CREATE TABLE escalations (
  escalation_id   TEXT PRIMARY KEY,
  exception_id    TEXT NOT NULL REFERENCES exceptions(exception_id),
  run_id          TEXT,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by     TEXT,
  resolution_note TEXT,
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE plans (
  version         INT PRIMARY KEY,
  status          TEXT NOT NULL CHECK (status IN ('ACTIVE','SUPERSEDED')),
  trigger         TEXT NOT NULL,
  trigger_detail  TEXT,
  parent_version  INT REFERENCES plans(version),
  run_id          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sim_time        TIMESTAMPTZ NOT NULL,
  summary         JSONB NOT NULL,
  change_log      JSONB NOT NULL DEFAULT '[]'::jsonb,
  explanation     TEXT
);
CREATE UNIQUE INDEX plans_one_active ON plans(status) WHERE status = 'ACTIVE';

CREATE TABLE plan_assignments (
  plan_version        INT NOT NULL REFERENCES plans(version),
  order_id            TEXT NOT NULL REFERENCES orders(order_id),
  picker_id           TEXT REFERENCES pickers(picker_id),
  sequence            INT,               -- per-picker sequence; null when not assigned
  priority_rank       INT NOT NULL,      -- global rank from the priority policy
  status              TEXT NOT NULL CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','BLOCKED','INFEASIBLE')),
  workload_minutes    NUMERIC(7,2) NOT NULL,
  est_start           TIMESTAMPTZ,
  est_finish          TIMESTAMPTZ,
  deadline            TIMESTAMPTZ NOT NULL,
  sla_at_risk         BOOLEAN NOT NULL DEFAULT false,
  inventory_readiness TEXT NOT NULL,
  primary_zone        TEXT,
  zones               TEXT[] NOT NULL DEFAULT '{}',
  rationale           TEXT NOT NULL,
  block_reason        TEXT,
  exception_ref       TEXT,
  change_type         TEXT,
  change_reason       TEXT,
  PRIMARY KEY (plan_version, order_id)
);

CREATE TABLE audit_events (
  seq              BIGSERIAL PRIMARY KEY,
  run_id           TEXT,
  ts               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  sim_time         TIMESTAMPTZ,
  workflow         TEXT NOT NULL,
  actor            TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  tool_name        TEXT,
  input            JSONB,
  result           JSONB,
  error            JSONB,
  policy_refs      TEXT[] NOT NULL DEFAULT '{}',
  decision_summary TEXT,
  proposed_action  JSONB,
  approval_state   TEXT,
  state_changes    JSONB,
  outcome          TEXT
);
CREATE INDEX audit_events_run ON audit_events(run_id);

CREATE TABLE action_log (
  idempotency_key TEXT PRIMARY KEY,
  action          TEXT NOT NULL,
  run_id          TEXT,
  result          JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox: domain events are written in the SAME transaction as the state
-- change that caused them, then dispatched to automation handlers.
CREATE TABLE domain_events (
  event_id      BIGSERIAL PRIMARY KEY,
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  source_tool   TEXT NOT NULL,
  run_id        TEXT,
  sim_time      TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSED','SKIPPED','FAILED')),
  handled_by    TEXT,
  result        JSONB,
  processed_at  TIMESTAMPTZ
);
CREATE INDEX domain_events_pending ON domain_events(event_id) WHERE status = 'PENDING';
