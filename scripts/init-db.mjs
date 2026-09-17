// Initializes the PostgreSQL schema for TRACECHAIN persistent storage.
//
//   pnpm db:init
//
// Requires DATABASE_URL to be set. The DDL is idempotent (CREATE TABLE IF NOT
// EXISTS), so it is safe to run repeatedly. ProductionDatabase.init() also runs
// this same DDL automatically on first use, so this script is a convenience —
// running it is optional. Keep the SQL below in sync with lib/db/ddl.ts.
import pg from "pg"

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text, name text, role text,
  created_at text NOT NULL, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS investigations (
  id text PRIMARY KEY, user_id text, title text NOT NULL, reported_wallet text NOT NULL,
  chain text NOT NULL, complaint_ref text, status text NOT NULL,
  risk_score integer NOT NULL DEFAULT 0, risk_band text NOT NULL DEFAULT 'LOW',
  priority_score integer NOT NULL DEFAULT 0, investigator text,
  case_data jsonb NOT NULL, result_data jsonb,
  created_at text NOT NULL, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS complaints (
  id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  reference text, text text, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS wallets (
  id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  address text NOT NULL, chain text NOT NULL, kind text, role text, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  hash text, chain text, from_address text, to_address text, amount double precision,
  asset text, usd_value double precision, data jsonb, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  wallet_address text, chain text, severity text, type text, message text,
  acknowledged boolean NOT NULL DEFAULT false, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  type text, title text, content_hash text, filename text, prev_hash text, summary text,
  provenance text, created_by text, created_at text NOT NULL
);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS filename text;
CREATE TABLE IF NOT EXISTS vasp_attributions (
  id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  address text, category text, vasp_name text, confidence double precision, data jsonb, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_assessments (
  id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  score integer, band text, data jsonb, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS investigation_events (
  id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  actor text, action text NOT NULL, detail text, metadata jsonb, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY, investigation_id text NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  generated_by text, data jsonb, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investigations_updated_at ON investigations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigations_user_id ON investigations(user_id);
CREATE INDEX IF NOT EXISTS idx_investigation_events_inv ON investigation_events(investigation_id);
`

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set. Set it to a PostgreSQL connection string and retry.")
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url })
try {
  await pool.query(SCHEMA_DDL)
  console.log("TRACECHAIN schema initialized successfully.")
} catch (err) {
  console.error("Failed to initialize schema:", err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await pool.end()
}
