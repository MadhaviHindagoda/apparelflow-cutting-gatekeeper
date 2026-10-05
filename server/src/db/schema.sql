-- ApparelFlow ERP: Cutting Gatekeeper schema (PostgreSQL)
-- Run order matters (foreign keys). Safe to re-run in dev: drops everything first.

DROP TABLE IF EXISTS verification_logs  CASCADE;
DROP TABLE IF EXISTS verification_items CASCADE;
DROP TABLE IF EXISTS cutting_orders     CASCADE;
DROP TABLE IF EXISTS recipe_components  CASCADE;
DROP TABLE IF EXISTS recipes            CASCADE;
DROP TABLE IF EXISTS users              CASCADE;
DROP SEQUENCE IF EXISTS order_no_seq;

-- 1. USERS
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL
                CHECK (role IN ('cutting_supervisor','cutting_verifier','sewing_supervisor')),
  full_name     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. RECIPES (Bill of Materials header)
CREATE TABLE recipes (
  id               SERIAL PRIMARY KEY,
  recipe_code      TEXT NOT NULL UNIQUE,            -- e.g. REC-BL01
  name             TEXT NOT NULL,
  category         TEXT NOT NULL,
  std_fabric_yards NUMERIC(8,3) NOT NULL CHECK (std_fabric_yards > 0),
  wastage_cap      NUMERIC(5,2) NOT NULL CHECK (wastage_cap >= 0)  -- percent
);

-- 3. RECIPE COMPONENTS (cut parts)
CREATE TABLE recipe_components (
  id                 SERIAL PRIMARY KEY,
  recipe_id          INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  component_name     TEXT NOT NULL,
  pieces_per_garment INTEGER NOT NULL CHECK (pieces_per_garment > 0),
  image_url          TEXT,
  UNIQUE (recipe_id, component_name)
);

-- 4. CUTTING ORDERS
CREATE SEQUENCE order_no_seq START 1001;

CREATE TABLE cutting_orders (
  id                SERIAL PRIMARY KEY,
  order_no          TEXT NOT NULL UNIQUE
                    DEFAULT ('CUT-' || nextval('order_no_seq')),
  recipe_id         INTEGER NOT NULL REFERENCES recipes(id),
  target_qty        INTEGER NOT NULL CHECK (target_qty > 0),
  fabric_roll_id    TEXT NOT NULL CHECK (length(trim(fabric_roll_id)) > 0),
  actual_fabric_yds NUMERIC(10,2) NOT NULL CHECK (actual_fabric_yds > 0),
  status            TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
                    CHECK (status IN ('IN_PROGRESS','PENDING_VERIFICATION',
                                      'REJECTED','VERIFIED','SEWING_STARTED')),
  created_by        INTEGER NOT NULL REFERENCES users(id),
  sewing_started_by INTEGER REFERENCES users(id),
  sewing_started_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_orders_status ON cutting_orders(status);

-- 5. VERIFICATION ITEMS (one row per component per order)
-- actual_qty / status stay NULL until the verifier counts => "uncounted" blocks approval.
CREATE TABLE verification_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES cutting_orders(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES recipe_components(id),
  expected_qty INTEGER NOT NULL CHECK (expected_qty > 0),
  actual_qty   INTEGER CHECK (actual_qty >= 0),
  status       TEXT CHECK (status IN ('GREEN','YELLOW','RED')),
  UNIQUE (order_id, component_id),
  -- actual_qty and status must be set together
  CHECK ((actual_qty IS NULL) = (status IS NULL))
);

-- 6. VERIFICATION LOGS (immutable audit trail)
CREATE TABLE verification_logs (
  id             SERIAL PRIMARY KEY,
  order_id       INTEGER NOT NULL REFERENCES cutting_orders(id),
  verifier_id    INTEGER NOT NULL REFERENCES users(id),
  decision       TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  rejection_note TEXT,
  wastage_pct    NUMERIC(8,2),
  variances      JSONB,                              -- snapshot: [{component, expected, actual, diff, status}]
  timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- rejection requires a real reason
  CHECK (decision <> 'REJECTED' OR length(trim(coalesce(rejection_note,''))) > 0)
);
CREATE INDEX idx_logs_order ON verification_logs(order_id);

-- IMMUTABILITY: audit rows can never be updated or deleted
CREATE OR REPLACE FUNCTION block_log_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'verification_logs is immutable (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_logs_immutable
BEFORE UPDATE OR DELETE ON verification_logs
FOR EACH ROW EXECUTE FUNCTION block_log_changes();

-- STATE MACHINE GUARD (DB-level safety net, in addition to the service layer)
-- Allowed: IN_PROGRESS -> PENDING_VERIFICATION
--          PENDING_VERIFICATION -> VERIFIED | REJECTED
--          REJECTED -> PENDING_VERIFICATION (after re-cut)
--          VERIFIED -> SEWING_STARTED
CREATE OR REPLACE FUNCTION enforce_order_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
       ('IN_PROGRESS','PENDING_VERIFICATION'),
       ('PENDING_VERIFICATION','VERIFIED'),
       ('PENDING_VERIFICATION','REJECTED'),
       ('REJECTED','PENDING_VERIFICATION'),
       ('VERIFIED','SEWING_STARTED')
     ) THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal status transition: % -> %', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_transition
BEFORE UPDATE ON cutting_orders
FOR EACH ROW EXECUTE FUNCTION enforce_order_transition();