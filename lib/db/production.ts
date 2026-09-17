import { eq, or, and, isNull, ilike, desc, asc } from "drizzle-orm"
import { getDb } from "./client"
import { SCHEMA_DDL } from "./ddl"
import {
  investigations,
  complaints,
  wallets,
  transactions as transactionsTable,
  alerts as alertsTable,
  evidence as evidenceTable,
  vaspAttributions,
  riskAssessments,
  investigationEvents,
  reports as reportsTable,
  users,
} from "./schema"
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
import { extractTransactions } from "./extract"
import { isVisibleToViewer } from "./types"
import type { InvestigationCase, Alert, EvidenceRecord } from "@/lib/types"
import type { InvestigationResult } from "@/lib/engines"

// ProductionDatabase
// -------------------------------------------------------------------------
// PostgreSQL persistence via drizzle-orm + pg (DATABASE_URL). Data survives
// browser refresh, navigation and server restart.
//
// The full case object and multi-engine investigation result are stored as
// JSONB (case_data / result_data) so reload is faithful without refactoring
// the engine layer. Normalized child tables (complaints, wallets, alerts,
// evidence, risk_assessments, vasp_attributions, investigation_events) provide
// the required relationships and queryability.
//
// This class NEVER falls back to in-memory storage. If the database is
// unreachable, its methods throw a real persistence error.
export class ProductionDatabase implements DatabaseRepository {
  readonly persistenceMode = "POSTGRES" as const
  private initPromise: Promise<void> | null = null

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit().catch((err) => {
        // Reset so a later request can retry a transient outage.
        this.initPromise = null
        throw err
      })
    }
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    const { pool } = getDb()
    // A single round-trip that both verifies connectivity and ensures schema.
    await pool.query(SCHEMA_DDL)
  }

  async saveInvestigation(input: SaveInvestigationInput): Promise<InvestigationRecord> {
    await this.init()
    const { db } = getDb()
    const now = new Date().toISOString()
    const c = input.case
    const existing = await db
      .select({ createdAt: investigations.createdAt })
      .from(investigations)
      .where(eq(investigations.id, c.id))
      .limit(1)
    const createdAt = existing[0]?.createdAt ?? c.createdAt ?? now

    await db.transaction(async (tx) => {
      if (input.userId) {
        await tx
          .insert(users)
          .values({ id: input.userId, name: input.actor ?? null, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: users.id,
            set: { name: input.actor ?? null, updatedAt: now },
          })
      }

      await tx
        .insert(investigations)
        .values({
          id: c.id,
          userId: input.userId ?? null,
          title: c.title,
          reportedWallet: c.reportedWallet,
          chain: c.chain,
          complaintRef: c.complaintRef,
          status: c.status,
          riskScore: c.riskScore,
          riskBand: c.riskBand,
          priorityScore: c.priorityScore,
          investigator: c.investigator,
          caseData: c,
          resultData: input.investigation ?? null,
          createdAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: investigations.id,
          set: {
            userId: input.userId ?? null,
            title: c.title,
            reportedWallet: c.reportedWallet,
            chain: c.chain,
            complaintRef: c.complaintRef,
            status: c.status,
            riskScore: c.riskScore,
            riskBand: c.riskBand,
            priorityScore: c.priorityScore,
            investigator: c.investigator,
            caseData: c,
            resultData: input.investigation ?? null,
            updatedAt: now,
          },
        })

      // Replace derived child rows (safe: delete + reinsert within the tx).
      await tx.delete(complaints).where(eq(complaints.investigationId, c.id))
      await tx.delete(wallets).where(eq(wallets.investigationId, c.id))
      await tx.delete(transactionsTable).where(eq(transactionsTable.investigationId, c.id))
      await tx.delete(alertsTable).where(eq(alertsTable.investigationId, c.id))
      await tx.delete(evidenceTable).where(eq(evidenceTable.investigationId, c.id))
      await tx.delete(riskAssessments).where(eq(riskAssessments.investigationId, c.id))
      await tx.delete(vaspAttributions).where(eq(vaspAttributions.investigationId, c.id))

      await tx.insert(complaints).values({
        id: `${c.id}:complaint`,
        investigationId: c.id,
        reference: c.complaintRef,
        text: c.complaintText,
        createdAt: now,
      })

      const walletRows = Array.from(new Set([c.reportedWallet, ...c.extractedWallets]))
        .filter(Boolean)
        .map((address, i) => ({
          id: `${c.id}:wallet:${i}`,
          investigationId: c.id,
          address,
          chain: c.chain,
          kind: null,
          role: address === c.reportedWallet ? "REPORTED" : "EXTRACTED",
          createdAt: now,
        }))
      if (walletRows.length) await tx.insert(wallets).values(walletRows)

      // Derive practical transaction records from the investigation result's
      // traced fund path and persist them (upsert-safe: rows were deleted
      // above and are re-inserted here). Authoritative normalized fields are
      // stored as columns; chain-specific detail is kept in JSONB `data`.
      const txRows = extractTransactions(c.id, input.investigation, c.chain, now)
      if (txRows.length) {
        await tx.insert(transactionsTable).values(
          txRows.map((t) => ({
            id: t.id,
            investigationId: t.investigationId,
            hash: t.hash,
            chain: t.chain,
            fromAddress: t.fromAddress,
            toAddress: t.toAddress,
            amount: t.amount,
            asset: t.asset,
            usdValue: t.usdValue,
            data: t.data,
            createdAt: t.createdAt,
          })),
        )
      }

      const alertRows = (input.alerts ?? []).map((a) => ({
        id: a.id,
        investigationId: c.id,
        walletAddress: a.walletAddress,
        chain: a.chain,
        severity: a.severity,
        type: a.type,
        message: a.message,
        acknowledged: a.acknowledged,
        createdAt: a.createdAt,
      }))
      if (alertRows.length) await tx.insert(alertsTable).values(alertRows)

      const evidenceRows = (input.evidence ?? []).map((e) => ({
        id: e.id,
        investigationId: c.id,
        type: e.type,
        title: e.title,
        contentHash: e.contentHash,
        filename: e.filename ?? null,
        prevHash: e.prevHash,
        summary: e.summary,
        provenance: e.provenance,
        createdBy: e.createdBy,
        createdAt: e.createdAt,
      }))
      if (evidenceRows.length) await tx.insert(evidenceTable).values(evidenceRows)

      const inv = input.investigation
      if (inv) {
        await tx.insert(riskAssessments).values({
          id: `${c.id}:risk`,
          investigationId: c.id,
          score: inv.risk.result.score,
          band: inv.risk.result.band,
          data: inv.risk.result,
          createdAt: now,
        })
        const vaspRows = inv.exitPoint.result.exitPoints
          .filter((e) => e.attribution?.vasp)
          .map((e, i) => ({
            id: `${c.id}:vasp:${i}`,
            investigationId: c.id,
            address: e.address,
            category: e.attribution.category,
            vaspName: e.attribution.vasp?.name ?? null,
            confidence: e.attribution.confidence,
            data: e.attribution,
            createdAt: now,
          }))
        if (vaspRows.length) await tx.insert(vaspAttributions).values(vaspRows)
      }

      // Seed the audit log from case activity, once, without duplicating.
      const activityRows = c.activity.map((a) => ({
        id: `${c.id}:act:${a.id}`,
        investigationId: c.id,
        actor: a.actor,
        action: a.action,
        detail: a.detail,
        metadata: null,
        createdAt: a.createdAt,
      }))
      if (activityRows.length) {
        await tx.insert(investigationEvents).values(activityRows).onConflictDoNothing()
      }
    })

    const record = await this.getInvestigation(c.id)
    if (!record) throw new Error("Persistence error: investigation not found after save.")
    return record
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

  async getInvestigation(id: string, viewerId?: string | null): Promise<InvestigationRecord | null> {
    await this.init()
    const { db } = getDb()
    const rows = await db.select().from(investigations).where(eq(investigations.id, id)).limit(1)
    const row = rows[0]
    if (!row) return null
    // Ownership check: an investigator cannot open another investigator's
    // private, owned investigation. Treat a hidden record as not found so the
    // response never reveals that the id exists.
    if (!isVisibleToViewer(row.userId, viewerId)) return null

    const alertRows = await db
      .select()
      .from(alertsTable)
      .where(eq(alertsTable.investigationId, id))
    const evidenceRows = await db
      .select()
      .from(evidenceTable)
      .where(eq(evidenceTable.investigationId, id))

    return {
      id: row.id,
      userId: row.userId,
      case: row.caseData as InvestigationCase,
      investigation: (row.resultData as InvestigationResult | null) ?? null,
      alerts: alertRows.map(
        (a): Alert => ({
          id: a.id,
          caseId: id,
          walletAddress: a.walletAddress ?? "",
          chain: (a.chain ?? "ethereum") as Alert["chain"],
          severity: (a.severity ?? "LOW") as Alert["severity"],
          type: a.type ?? "",
          message: a.message ?? "",
          createdAt: a.createdAt,
          acknowledged: a.acknowledged,
        }),
      ),
      evidence: evidenceRows.map(
        (e): EvidenceRecord => ({
          id: e.id,
          caseId: id,
          type: e.type ?? "",
          title: e.title ?? "",
          contentHash: e.contentHash ?? "",
          ...(e.filename ? { filename: e.filename } : {}),
          prevHash: e.prevHash ?? "",
          createdAt: e.createdAt,
          createdBy: e.createdBy ?? "",
          provenance: (e.provenance ?? "UNKNOWN") as EvidenceRecord["provenance"],
          summary: e.summary ?? "",
        }),
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  async listInvestigations(viewerId?: string | null): Promise<InvestigationListItem[]> {
    await this.init()
    const { db } = getDb()
    // Scope to unowned (shared/seeded) + viewer-owned records when a viewer is
    // supplied; otherwise return everything.
    const ownership = viewerId
      ? or(isNull(investigations.userId), eq(investigations.userId, viewerId))
      : undefined
    const rows = await db
      .select()
      .from(investigations)
      .where(ownership)
      .orderBy(desc(investigations.updatedAt))
    return rows.map(this.toListItem)
  }

  async searchInvestigations(query: SearchQuery, viewerId?: string | null): Promise<InvestigationListItem[]> {
    await this.init()
    const { db } = getDb()
    const q = (query.q ?? "").trim()
    const ownership = viewerId
      ? or(isNull(investigations.userId), eq(investigations.userId, viewerId))
      : undefined
    const search = q
      ? or(
          ilike(investigations.id, `%${q}%`),
          ilike(investigations.title, `%${q}%`),
          ilike(investigations.reportedWallet, `%${q}%`),
          ilike(investigations.complaintRef, `%${q}%`),
          ilike(investigations.status, `%${q}%`),
        )
      : undefined
    const where =
      ownership && search ? and(ownership, search) : (ownership ?? search)
    const rows = await db
      .select()
      .from(investigations)
      .where(where)
      .orderBy(desc(investigations.updatedAt))
    const filtered = query.status ? rows.filter((r) => r.status === query.status) : rows
    return filtered.map(this.toListItem).slice(0, query.limit ?? filtered.length)
  }

  async getInvestigationHistory(id: string): Promise<InvestigationEventRecord[]> {
    await this.init()
    const { db } = getDb()
    const rows = await db
      .select()
      .from(investigationEvents)
      .where(eq(investigationEvents.investigationId, id))
      .orderBy(asc(investigationEvents.createdAt))
    return rows.map((r) => ({
      id: r.id,
      investigationId: r.investigationId,
      actor: r.actor,
      action: r.action,
      detail: r.detail ?? "",
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt,
    }))
  }

  async appendInvestigationEvent(
    event: Omit<InvestigationEventRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ): Promise<InvestigationEventRecord> {
    await this.init()
    const { db } = getDb()
    const createdAt = event.createdAt ?? new Date().toISOString()
    const id = event.id ?? `${event.investigationId}:evt:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    const record: InvestigationEventRecord = {
      id,
      investigationId: event.investigationId,
      actor: event.actor ?? null,
      action: event.action,
      detail: event.detail,
      metadata: event.metadata ?? null,
      createdAt,
    }
    await db.insert(investigationEvents).values({
      id: record.id,
      investigationId: record.investigationId,
      actor: record.actor,
      action: record.action,
      detail: record.detail,
      metadata: record.metadata,
      createdAt: record.createdAt,
    })
    return record
  }

  async saveReport(input: SaveReportInput): Promise<ReportRecord> {
    await this.init()
    const { db } = getDb()
    const createdAt = input.createdAt ?? new Date().toISOString()
    const id = input.id ?? `${input.investigationId}:report:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    const record: ReportRecord = {
      id,
      investigationId: input.investigationId,
      generatedBy: input.generatedBy ?? null,
      data: input.data,
      createdAt,
    }
    await db.insert(reportsTable).values({
      id: record.id,
      investigationId: record.investigationId,
      generatedBy: record.generatedBy,
      data: record.data,
      createdAt: record.createdAt,
    })
    return record
  }

  async listReports(investigationId: string): Promise<ReportRecord[]> {
    await this.init()
    const { db } = getDb()
    const rows = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.investigationId, investigationId))
      .orderBy(asc(reportsTable.createdAt))
    return rows.map((r) => ({
      id: r.id,
      investigationId: r.investigationId,
      generatedBy: r.generatedBy,
      data: r.data,
      createdAt: r.createdAt,
    }))
  }

  private toListItem = (row: typeof investigations.$inferSelect): InvestigationListItem => ({
    id: row.id,
    title: row.title,
    reportedWallet: row.reportedWallet,
    chain: row.chain as InvestigationListItem["chain"],
    complaintRef: row.complaintRef ?? "",
    riskScore: row.riskScore,
    riskBand: row.riskBand as InvestigationListItem["riskBand"],
    status: row.status as InvestigationListItem["status"],
    investigator: row.investigator ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

let prodInstance: ProductionDatabase | null = null
export function getProductionDatabase(): ProductionDatabase {
  if (!prodInstance) prodInstance = new ProductionDatabase()
  return prodInstance
}
