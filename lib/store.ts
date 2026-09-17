import type {
  User,
  InvestigationCase,
  Alert,
  WatchedWallet,
  EvidenceRecord,
  CaseStatus,
  RiskBand,
} from "@/lib/types"
import { hashPassword } from "@/lib/auth"
import { getDemoScenarios, type DemoScenario } from "@/lib/data/demo-dataset"
import { buildContext } from "@/lib/engines/context"
import { runInvestigation, type InvestigationResult, riskBand } from "@/lib/engines"
import { createEvidenceRecord, GENESIS_HASH } from "@/lib/evidence/evidence"
import type { InvestigationEventRecord, ReportRecord } from "@/lib/db/types"

// Singleton in-memory store. Persists for the life of the server process.
// This is the "seeded in-memory + demo store" persistence strategy chosen for
// the offline SIH demo. Swapping to Postgres later means implementing the same
// interface against a real DB.
interface Store {
  users: User[]
  cases: InvestigationCase[]
  alerts: Alert[]
  watchlist: WatchedWallet[]
  evidence: EvidenceRecord[]
  // Original canonical content per evidence id, retained so integrity
  // verification can recompute the SHA-256 and compare it to the stored hash.
  // Lives only for the server process lifetime (IN_MEMORY mode) — when it is
  // absent for a record, verification honestly reports that it cannot be done.
  evidenceContent: Map<string, unknown>
  investigations: Map<string, InvestigationResult>
  scenarioByCase: Map<string, DemoScenario>
  // Persistent audit/history log per investigation id. Used by the
  // DevelopmentDatabase repository. Like everything else in this store, it
  // lives only for the lifetime of the server process (IN_MEMORY mode).
  investigationEvents: Map<string, InvestigationEventRecord[]>
  // Persisted investigation reports per investigation id. Used by the
  // DevelopmentDatabase repository. Lives only for the server process lifetime.
  reports: Map<string, ReportRecord[]>
  seeded: boolean
}

declare global {
  // eslint-disable-next-line no-var
  var __TRACECHAIN_STORE__: Store | undefined
}

function emptyStore(): Store {
  return {
    users: [],
    cases: [],
    alerts: [],
    watchlist: [],
    evidence: [],
    evidenceContent: new Map(),
    investigations: new Map(),
    scenarioByCase: new Map(),
    investigationEvents: new Map(),
    reports: new Map(),
    seeded: false,
  }
}

// Restore a persisted investigation back into the in-memory store. Used when a
// saved investigation is reopened (e.g. after a server restart in production,
// the persistence layer rehydrates the store on demand). Upserts by case id.
export function hydrateInvestigation(record: {
  case: InvestigationCase
  investigation: InvestigationResult | null
  alerts: Alert[]
  evidence: EvidenceRecord[]
}): void {
  const store = getStore()
  const idx = store.cases.findIndex((c) => c.id === record.case.id)
  if (idx >= 0) store.cases[idx] = record.case
  else store.cases.push(record.case)
  if (record.investigation) store.investigations.set(record.case.id, record.investigation)
  for (const a of record.alerts) if (!store.alerts.some((x) => x.id === a.id)) store.alerts.push(a)
  for (const e of record.evidence) if (!store.evidence.some((x) => x.id === e.id)) store.evidence.push(e)
}

export function getStore(): Store {
  if (!globalThis.__TRACECHAIN_STORE__) {
    globalThis.__TRACECHAIN_STORE__ = emptyStore()
  }
  return globalThis.__TRACECHAIN_STORE__
}

const SEED_USERS: Array<Omit<User, "passwordHash"> & { password: string; salt: string }> = [
  { id: "u_admin", email: "admin@tracechain.gov", name: "System Administrator", role: "ADMIN", password: "Admin@123", salt: "s_admin" },
  { id: "u_inv", email: "investigator@tracechain.gov", name: "Lead Investigator", role: "INVESTIGATOR", password: "Invest@123", salt: "s_inv" },
  { id: "u_analyst", email: "analyst@tracechain.gov", name: "Intel Analyst", role: "ANALYST", password: "Analyst@123", salt: "s_analyst" },
  { id: "u_viewer", email: "viewer@tracechain.gov", name: "Read-Only Observer", role: "VIEWER", password: "Viewer@123", salt: "s_viewer" },
]

export const DEMO_CREDENTIALS = SEED_USERS.map((u) => ({ email: u.email, password: u.password, role: u.role }))

let seedPromise: Promise<void> | null = null

export async function ensureSeeded(): Promise<void> {
  const store = getStore()
  if (store.seeded) return
  if (seedPromise) return seedPromise
  seedPromise = doSeed(store)
  await seedPromise
}

async function doSeed(store: Store): Promise<void> {
  // Users
  for (const u of SEED_USERS) {
    store.users.push({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      passwordHash: await hashPassword(u.password, u.salt),
    })
  }

  const scenarios = getDemoScenarios()
  const statuses: CaseStatus[] = ["ANALYZING", "TRACING", "VASP_IDENTIFIED", "ACTION_REQUIRED", "MONITORING", "NEW"]

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i]
    const caseId = `TC-2026-${String(1001 + i)}`
    const ctx = buildContext({
      chain: s.chain,
      rootAddress: s.reportedWallet,
      reportedLossUsd: s.reportedLossUsd,
      nodes: s.nodes,
      edges: s.edges,
      transactions: s.transactions,
      depth: 5,
      provenance: "DEMO_DATA",
      crossChain: s.crossChain,
    })
    const investigation = await runInvestigation(ctx, {
      caseId,
      complaintRef: s.complaintRef,
      complaintText: s.complaintText,
      connectedVictims: s.connectedVictims,
    })

    const risk = investigation.risk.result
    const created = new Date(Date.parse("2026-08-20T10:00:00Z") + i * 86400000).toISOString()
    const investigatorName = i % 2 === 0 ? "Lead Investigator" : "Intel Analyst"

    const c: InvestigationCase = {
      id: caseId,
      complaintRef: s.complaintRef,
      title: s.name,
      reportedWallet: s.reportedWallet,
      chain: s.chain,
      complaintText: s.complaintText,
      extractedWallets: [s.reportedWallet],
      typology: investigation.typology,
      riskScore: risk.score,
      riskBand: risk.band as RiskBand,
      priorityScore: investigation.priorityScore,
      status: statuses[i % statuses.length],
      investigator: investigatorName,
      reportedLossUsd: s.reportedLossUsd,
      traceableUsd: investigation.recover.result.traceableUsd,
      recoveryProbability: investigation.recover.result.recoveryProbability,
      connectedVictims: s.connectedVictims,
      createdAt: created,
      updatedAt: created,
      notes: [
        {
          id: "n_seed",
          author: investigatorName,
          createdAt: created,
          body: s.narrative,
        },
      ],
      activity: [
        { id: "a1", actor: investigatorName, action: "CASE_CREATED", detail: `Case opened from complaint ${s.complaintRef}.`, createdAt: created },
        { id: "a2", actor: "TRACECHAIN AI", action: "INVESTIGATION_RUN", detail: "Automated multi-engine investigation completed.", createdAt: created },
      ],
      provenance: "DEMO_DATA",
      demoScenario: s.typology,
    }
    store.cases.push(c)
    store.investigations.set(caseId, investigation)
    store.scenarioByCase.set(caseId, s)

    // Seed evidence chain for this case
    await appendEvidence({
      caseId,
      type: "CASE_SNAPSHOT",
      title: "Initial case snapshot",
      summary: `Snapshot of reported wallet ${s.reportedWallet} and ${s.nodes.length}-node trace graph.`,
      content: { rootAddress: s.reportedWallet, nodes: s.nodes.length, edges: s.edges.length },
      createdBy: investigatorName,
      provenance: "DEMO_DATA",
    })
    await appendEvidence({
      caseId,
      type: "INVESTIGATION_RESULT",
      title: "Multi-engine investigation result",
      summary: investigation.summary,
      content: { risk: risk.score, priority: investigation.priorityScore, typology: investigation.typology },
      createdBy: "TRACECHAIN AI",
      provenance: "HEURISTIC_ANALYSIS",
    })

    // Seed alerts for high-risk cases
    if (risk.score >= 61) {
      store.alerts.push({
        id: `al_${caseId}`,
        caseId,
        walletAddress: s.reportedWallet,
        chain: s.chain,
        severity: risk.band as RiskBand,
        type: "HIGH_RISK_CASE",
        message: `${risk.band} risk (${risk.score}/100) detected for case ${caseId}.`,
        createdAt: created,
        acknowledged: false,
      })
    }
    const exit = investigation.exitPoint.result.exitPoints[0]
    if (exit) {
      store.alerts.push({
        id: `al_exit_${caseId}`,
        caseId,
        walletAddress: exit.address,
        chain: s.chain,
        severity: "HIGH",
        type: "EXIT_POINT_IDENTIFIED",
        message: `Probable exit endpoint identified for ${caseId} (${exit.attribution.vasp?.name ?? "unattributed"}).`,
        createdAt: created,
        acknowledged: i % 2 === 0,
      })
    }

    // Seed watchlist from suspicious/exchange nodes
    const watchNode = s.nodes.find((n) => n.kind === "EXCHANGE") ?? s.nodes.find((n) => n.kind === "SUSPICIOUS")
    if (watchNode) {
      store.watchlist.push({
        id: `w_${caseId}`,
        address: watchNode.id,
        chain: watchNode.chain,
        label: watchNode.label ?? "Tracked wallet",
        caseId,
        addedAt: created,
        lastActivity: s.metadata[watchNode.id]?.lastSeen ?? created,
        status: i % 3 === 0 ? "TRIGGERED" : "ACTIVE",
        balance: s.metadata[watchNode.id]?.balance ?? 0,
        usdBalance: s.metadata[watchNode.id]?.usdBalance ?? 0,
      })
    }
  }

  store.seeded = true
}

// Append an evidence record to the case's tamper-evident chain. The original
// content is retained (keyed by the new record id) so integrity verification
// can later recompute the hash and compare it to the stored one.
export async function appendEvidence(params: {
  caseId: string
  type: string
  title: string
  summary: string
  content: unknown
  createdBy: string
  provenance: EvidenceRecord["provenance"]
  filename?: string
}): Promise<EvidenceRecord> {
  const store = getStore()
  const caseRecords = store.evidence
    .filter((e) => e.caseId === params.caseId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const prevHash = caseRecords.length ? caseRecords[caseRecords.length - 1].contentHash : GENESIS_HASH
  const record = await createEvidenceRecord({ ...params, prevHash })
  store.evidence.push(record)
  store.evidenceContent.set(record.id, params.content)
  return record
}

// The original content hashed into an evidence record, or undefined when it is
// not retained (e.g. after a server restart in IN_MEMORY mode).
export function getEvidenceContent(id: string): { available: boolean; content: unknown } {
  const store = getStore()
  return { available: store.evidenceContent.has(id), content: store.evidenceContent.get(id) }
}

export function getEvidenceById(id: string): EvidenceRecord | undefined {
  return getStore().evidence.find((e) => e.id === id)
}

// ---- Query helpers ----
export function findUserByEmail(email: string): User | undefined {
  return getStore().users.find((u) => u.email.toLowerCase() === email.toLowerCase())
}
export function findUserById(id: string): User | undefined {
  return getStore().users.find((u) => u.id === id)
}
export function listCases(): InvestigationCase[] {
  return [...getStore().cases].sort((a, b) => b.priorityScore - a.priorityScore)
}
export function getCase(id: string): InvestigationCase | undefined {
  return getStore().cases.find((c) => c.id === id)
}
export function getInvestigation(caseId: string): InvestigationResult | undefined {
  return getStore().investigations.get(caseId)
}
export function getScenarioForCase(caseId: string): DemoScenario | undefined {
  return getStore().scenarioByCase.get(caseId)
}
export function listAlerts(): Alert[] {
  return [...getStore().alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export function listWatchlist(): WatchedWallet[] {
  return [...getStore().watchlist]
}
export function listEvidence(caseId?: string): EvidenceRecord[] {
  const all = getStore().evidence
  return (caseId ? all.filter((e) => e.caseId === caseId) : all).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

let caseCounter = 2000
export function nextCaseId(): string {
  const store = getStore()
  caseCounter = Math.max(caseCounter, 1000 + store.cases.length) + 1
  return `TC-2026-${caseCounter}`
}

export { riskBand }
