import { getStore } from "@/lib/store"
import type {
  DatabaseRepository,
  InvestigationRecord,
  InvestigationListItem,
  InvestigationEventRecord,
  SaveInvestigationInput,
  SearchQuery,
  ReportRecord,
  SaveReportInput,
} from "./types"
import { toListItem, matchesQuery } from "./types"

// DevelopmentDatabase
// -------------------------------------------------------------------------
// Adapts the existing singleton in-memory store (lib/store.ts) as a repository
// backend. It does NOT duplicate application state — it reads and writes the
// same `getStore()` singleton every existing API route already uses.
//
// IMPORTANT: this data lives only for the lifetime of the server process. It
// does NOT survive a server restart. That is intentional for local/offline
// development and is surfaced to the UI as persistenceMode = "IN_MEMORY".
export class DevelopmentDatabase implements DatabaseRepository {
  readonly persistenceMode = "IN_MEMORY" as const

  async init(): Promise<void> {
    // No connection to establish; the in-memory store is always available.
  }

  async saveInvestigation(input: SaveInvestigationInput): Promise<InvestigationRecord> {
    const store = getStore()
    const now = new Date().toISOString()
    const incoming = input.case
    const idx = store.cases.findIndex((c) => c.id === incoming.id)
    const createdAt = idx >= 0 ? store.cases[idx].createdAt : incoming.createdAt || now
    const merged = { ...incoming, createdAt, updatedAt: now }

    // Upsert case (update in place if it already exists).
    if (idx >= 0) store.cases[idx] = merged
    else store.cases.push(merged)

    // Investigation result.
    if (input.investigation) store.investigations.set(merged.id, input.investigation)

    // Merge alerts / evidence without creating uncontrolled duplicates.
    for (const a of input.alerts ?? []) {
      const ai = store.alerts.findIndex((x) => x.id === a.id)
      if (ai >= 0) store.alerts[ai] = a
      else store.alerts.push(a)
    }
    for (const e of input.evidence ?? []) {
      if (!store.evidence.some((x) => x.id === e.id)) store.evidence.push(e)
    }

    // Seed the audit log from the case activity the first time it is saved.
    if (!store.investigationEvents.has(merged.id)) {
      const seeded: InvestigationEventRecord[] = merged.activity.map((a) => ({
        id: a.id,
        investigationId: merged.id,
        actor: a.actor,
        action: a.action,
        detail: a.detail,
        metadata: null,
        createdAt: a.createdAt,
      }))
      store.investigationEvents.set(merged.id, seeded)
    }

    return this.buildRecord(merged.id, input.userId ?? null, createdAt, now)!
  }

  async updateInvestigation(
    id: string,
    patch: Partial<SaveInvestigationInput>,
  ): Promise<InvestigationRecord> {
    const existing = await this.getInvestigation(id)
    if (!existing) throw new Error(`Investigation ${id} not found.`)
    return this.saveInvestigation({
      case: { ...existing.case, ...(patch.case ?? {}) },
      investigation: patch.investigation ?? existing.investigation,
      alerts: patch.alerts ?? existing.alerts,
      evidence: patch.evidence ?? existing.evidence,
      userId: patch.userId ?? existing.userId,
      actor: patch.actor ?? null,
    })
  }

  // viewerId is accepted for interface parity but intentionally NOT applied:
  // the in-memory store models the demo/shared-user mode and carries no
  // per-case owner, so every case is treated as unowned/shared and stays
  // visible. This preserves existing demo behavior (see isVisibleToViewer).
  async getInvestigation(id: string, _viewerId?: string | null): Promise<InvestigationRecord | null> {
    const store = getStore()
    const c = store.cases.find((x) => x.id === id)
    if (!c) return null
    return this.buildRecord(id, null, c.createdAt, c.updatedAt)
  }

  async listInvestigations(_viewerId?: string | null): Promise<InvestigationListItem[]> {
    return getStore()
      .cases.map(toListItem)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async searchInvestigations(query: SearchQuery, _viewerId?: string | null): Promise<InvestigationListItem[]> {
    const q = (query.q ?? "").trim()
    return getStore()
      .cases.filter((c) => {
        if (query.status && c.status !== query.status) return false
        return matchesQuery(c, q)
      })
      .map(toListItem)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, query.limit ?? Number.MAX_SAFE_INTEGER)
  }

  async getInvestigationHistory(id: string): Promise<InvestigationEventRecord[]> {
    const store = getStore()
    const events = store.investigationEvents.get(id)
    if (events && events.length) {
      return [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }
    // Fall back to the case activity when no explicit events were recorded.
    const c = store.cases.find((x) => x.id === id)
    if (!c) return []
    return c.activity
      .map((a) => ({
        id: a.id,
        investigationId: id,
        actor: a.actor,
        action: a.action,
        detail: a.detail,
        metadata: null,
        createdAt: a.createdAt,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async appendInvestigationEvent(
    event: Omit<InvestigationEventRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ): Promise<InvestigationEventRecord> {
    const store = getStore()
    const createdAt = event.createdAt ?? new Date().toISOString()
    const record: InvestigationEventRecord = {
      id: event.id ?? `ev_${event.investigationId}_${store.investigationEvents.get(event.investigationId)?.length ?? 0}_${Date.now()}`,
      investigationId: event.investigationId,
      actor: event.actor ?? null,
      action: event.action,
      detail: event.detail,
      metadata: event.metadata ?? null,
      createdAt,
    }
    const list = store.investigationEvents.get(event.investigationId) ?? []
    list.push(record)
    store.investigationEvents.set(event.investigationId, list)
    return record
  }

  async saveReport(input: SaveReportInput): Promise<ReportRecord> {
    const store = getStore()
    const createdAt = input.createdAt ?? new Date().toISOString()
    const list = store.reports.get(input.investigationId) ?? []
    const record: ReportRecord = {
      id: input.id ?? `${input.investigationId}:report:${list.length}:${Date.now()}`,
      investigationId: input.investigationId,
      generatedBy: input.generatedBy ?? null,
      data: input.data,
      createdAt,
    }
    list.push(record)
    store.reports.set(input.investigationId, list)
    return record
  }

  async listReports(investigationId: string): Promise<ReportRecord[]> {
    const list = getStore().reports.get(investigationId) ?? []
    return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  private buildRecord(
    id: string,
    userId: string | null,
    createdAt: string,
    updatedAt: string,
  ): InvestigationRecord | null {
    const store = getStore()
    const c = store.cases.find((x) => x.id === id)
    if (!c) return null
    return {
      id,
      userId,
      case: c,
      investigation: store.investigations.get(id) ?? null,
      alerts: store.alerts.filter((a) => a.caseId === id),
      evidence: store.evidence.filter((e) => e.caseId === id),
      createdAt,
      updatedAt,
    }
  }
}

let devInstance: DevelopmentDatabase | null = null
export function getDevelopmentDatabase(): DevelopmentDatabase {
  if (!devInstance) devInstance = new DevelopmentDatabase()
  return devInstance
}
