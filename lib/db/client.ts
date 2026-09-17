import { Pool } from "pg"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import * as schema from "./schema"

type DbBundle = { pool: Pool; db: NodePgDatabase<typeof schema> }

declare global {
  // eslint-disable-next-line no-var
  var __TRACECHAIN_PG__: DbBundle | undefined
}

// Lazily create (and reuse across HMR) a single pooled Drizzle client bound to
// DATABASE_URL. Throws if DATABASE_URL is not set — this module is only used by
// the ProductionDatabase, which is only selected when DATABASE_URL exists.
export function getDb(): DbBundle {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set.")
  if (!globalThis.__TRACECHAIN_PG__) {
    const pool = new Pool({ connectionString: url, max: 5 })
    globalThis.__TRACECHAIN_PG__ = { pool, db: drizzle(pool, { schema }) }
  }
  return globalThis.__TRACECHAIN_PG__
}
