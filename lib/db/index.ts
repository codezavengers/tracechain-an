import type { DatabaseRepository, PersistenceMode } from "./types"
import { getDevelopmentDatabase } from "./development"
import { getProductionDatabase } from "./production"

export type {
  DatabaseRepository,
  PersistenceMode,
  InvestigationRecord,
  InvestigationListItem,
  InvestigationEventRecord,
  SaveInvestigationInput,
  SearchQuery,
  ReportRecord,
  SaveReportInput,
} from "./types"
export type { ExtractedTransaction } from "./extract"
export { extractTransactions } from "./extract"
export { INVESTIGATION_EVENT_TYPES } from "./types"
export { DevelopmentDatabase } from "./development"
export { ProductionDatabase } from "./production"

// Repository provider / factory.
//
// Selection is driven solely by the presence of DATABASE_URL:
//   DATABASE_URL set   -> ProductionDatabase (PostgreSQL, persistent)
//   DATABASE_URL unset -> DevelopmentDatabase (in-memory, non-persistent)
//
// When DATABASE_URL is set but the database is unreachable, the returned
// ProductionDatabase throws a real persistence error on use — it NEVER
// silently falls back to in-memory storage.
export function getPersistenceMode(): PersistenceMode {
  return process.env.DATABASE_URL ? "POSTGRES" : "IN_MEMORY"
}

export function persistenceLabel(mode: PersistenceMode = getPersistenceMode()): string {
  return mode === "POSTGRES" ? "Persistent Database" : "In-Memory Development"
}

export function getRepository(): DatabaseRepository {
  return getPersistenceMode() === "POSTGRES" ? getProductionDatabase() : getDevelopmentDatabase()
}
