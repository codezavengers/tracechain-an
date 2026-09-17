import type {
  InvestigationCase,
  Alert,
  EvidenceRecord,
  Chain,
  RiskBand,
  CaseStatus,
} from "@/lib/types"
import type { InvestigationResult } from "@/lib/engines"

// Two persistence strategies are exposed by the repository layer:
//   IN_MEMORY  - DevelopmentDatabase, backed by the singleton in-memory store.
//                Data does NOT survive a server restart.
//   POSTGRES   - ProductionDatabase, backed by PostgreSQL via DATABASE_URL.
//                Data survives refresh, navigation and server restart.
export type PersistenceMode = "IN_MEMORY" | "POSTGRES"

// The minimum event types recorded on the investigation audit/history log.
// This is an append-only audit trail, NOT event sourcing.
export const INVESTIGATION_EVENT_TYPES = [
  "CASE_CREATED",
  "INVESTIGATION_SAVED",
  "INVESTIGATION_UPDATED",
  "INVESTIGATION_RUN",
  "RISK_ASSESSMENT_GENERATED",
  "ALERT_GENERATED",
  "EVIDENCE_ADDED",
  "EVIDENCE_VERIFIED",
  "REPORT_GENERATED",
] as const

export type InvestigationEventType = (typeof INVESTIGATION_EVENT_TYPES)[number]

// A complete, persistable snapshot of an investigation and its related data.
// Complex existing objects (the full case + multi-engine result) are stored as
// JSON so persistence never requires refactoring the blockchain/engine logic.
export interface InvestigationRecord {
  id: string
  userId: string | null
  case: InvestigationCase
  investigation: InvestigationResult | null
  alerts: Alert[]
  evidence: EvidenceRecord[]
  createdAt: string
  updatedAt: string
}

// Lightweight projection used by the case list.
export interface InvestigationListItem {
  id: string
  title: string
  reportedWallet: string
  chain: Chain
  complaintRef: string
  riskScore: number
  riskBand: RiskBand
  status: CaseStatus
  investigator: string
  createdAt: string
  updatedAt: string
}

export interface InvestigationEventRecord {
  id: string
  investigationId: string
  actor: string | null
  action: string
  detail: string
  metadata?: Record<string, unknown> | null
  createdAt: string
}

export interface SaveInvestigationInput {
  case: InvestigationCase
  investigation?: InvestigationResult | null
  alerts?: Alert[]
  evidence?: EvidenceRecord[]
  userId?: string | null
  actor?: string | null
}

export interface SearchQuery {
  q?: string
  status?: string
  limit?: number
}

// A persisted investigation report. TRACECHAIN generates the full report
// payload on demand (see app/api/cases/[id]/report/route.ts); this record
// stores that payload and associates it with its investigation so it survives
// a refresh / server restart in persistent mode.
export interface ReportRecord {
  id: string
  investigationId: string
  generatedBy: string | null
  data: unknown
  createdAt: string
}

export interface SaveReportInput {
  investigationId: string
  generatedBy?: string | null
  data: unknown
  id?: string
  createdAt?: string
}

// Ownership visibility rule for "list the investigator's investigations".
//   - No viewer supplied  -> no scoping (internal callers, demo/shared model).
//   - Unowned record       -> visible to everyone (seeded demo cases have a
//                             null owner and must stay shared).
//   - Owned record         -> visible only to its owner.
// This is deliberately minimal: it is NOT a full RBAC system, it simply keeps
// one investigator from listing or opening another investigator's private,
// owned investigations while preserving the shared/demo behavior.
export function isVisibleToViewer(
  ownerId: string | null | undefined,
  viewerId?: string | null,
): boolean {
  if (!viewerId) return true
  if (ownerId == null) return true
  return ownerId === viewerId
}

// Minimum operations every persistence backend implements.
export interface DatabaseRepository {
  readonly persistenceMode: PersistenceMode
  // Idempotent. IN_MEMORY: no-op. POSTGRES: verifies connectivity and ensures
  // the schema exists. Throws on a real connection/persistence failure (never
  // silently falls back to memory).
  init(): Promise<void>
  saveInvestigation(input: SaveInvestigationInput): Promise<InvestigationRecord>
  updateInvestigation(id: string, patch: Partial<SaveInvestigationInput>): Promise<InvestigationRecord>
  // viewerId (optional) scopes ownership per isVisibleToViewer. Omitted by
  // internal callers (save/update/report) that must always see the record.
  getInvestigation(id: string, viewerId?: string | null): Promise<InvestigationRecord | null>
  listInvestigations(viewerId?: string | null): Promise<InvestigationListItem[]>
  searchInvestigations(query: SearchQuery, viewerId?: string | null): Promise<InvestigationListItem[]>
  getInvestigationHistory(id: string): Promise<InvestigationEventRecord[]>
  appendInvestigationEvent(
    event: Omit<InvestigationEventRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ): Promise<InvestigationEventRecord>
  // Persist an investigation report and associate it with its investigation.
  // Reports are generated on demand, so this is called at generation time.
  saveReport(input: SaveReportInput): Promise<ReportRecord>
  listReports(investigationId: string): Promise<ReportRecord[]>
}

// Derive the case-list projection from a full case object.
export function toListItem(c: InvestigationCase): InvestigationListItem {
  return {
    id: c.id,
    title: c.title,
    reportedWallet: c.reportedWallet,
    chain: c.chain,
    complaintRef: c.complaintRef,
    riskScore: c.riskScore,
    riskBand: c.riskBand,
    status: c.status,
    investigator: c.investigator,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

export function matchesQuery(c: InvestigationCase, q: string): boolean {
  const term = q.trim().toLowerCase()
  if (!term) return true
  return `${c.id} ${c.title} ${c.reportedWallet} ${c.complaintRef} ${c.status}`
    .toLowerCase()
    .includes(term)
}
