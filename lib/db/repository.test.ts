import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { DevelopmentDatabase } from "./development"
import { getRepository, getPersistenceMode, persistenceLabel } from "./index"
import type { InvestigationCase } from "@/lib/types"

let counter = 0
function makeCase(overrides: Partial<InvestigationCase> = {}): InvestigationCase {
  counter += 1
  const id = `TC-TEST-${counter}`
  const now = new Date().toISOString()
  return {
    id,
    complaintRef: `CMP/${counter}`,
    title: `Test investigation ${counter}`,
    reportedWallet: `0xreported${counter}`,
    chain: "ethereum",
    complaintText: "Victim reported a fraudulent transfer.",
    extractedWallets: [`0xreported${counter}`, `0xother${counter}`],
    typology: "INVESTMENT_FRAUD",
    riskScore: 72,
    riskBand: "HIGH",
    priorityScore: 65,
    status: "NEW",
    investigator: "Lead Investigator",
    reportedLossUsd: 100000,
    traceableUsd: 40000,
    recoveryProbability: 0.4,
    connectedVictims: 3,
    createdAt: now,
    updatedAt: now,
    notes: [],
    activity: [
      { id: "a1", actor: "Lead Investigator", action: "CASE_CREATED", detail: "Case opened.", createdAt: now },
    ],
    provenance: "DEMO_DATA",
    ...overrides,
  }
}

describe("DevelopmentDatabase", () => {
  let repo: DevelopmentDatabase

  beforeEach(() => {
    repo = new DevelopmentDatabase()
  })

  it("exposes IN_MEMORY persistence mode", () => {
    expect(repo.persistenceMode).toBe("IN_MEMORY")
  })

  it("saves and reloads an investigation", async () => {
    const c = makeCase()
    const saved = await repo.saveInvestigation({ case: c, actor: "Lead Investigator" })
    expect(saved.id).toBe(c.id)

    const reloaded = await repo.getInvestigation(c.id)
    expect(reloaded).not.toBeNull()
    expect(reloaded?.case.title).toBe(c.title)
    expect(reloaded?.case.reportedWallet).toBe(c.reportedWallet)
  })

  it("updates an existing investigation without creating duplicates", async () => {
    const c = makeCase()
    await repo.saveInvestigation({ case: c })
    await repo.saveInvestigation({ case: { ...c, status: "ANALYZING", riskScore: 88 } })

    const list = await repo.listInvestigations()
    expect(list.filter((i) => i.id === c.id)).toHaveLength(1)

    const reloaded = await repo.getInvestigation(c.id)
    expect(reloaded?.case.status).toBe("ANALYZING")
    expect(reloaded?.case.riskScore).toBe(88)
  })

  it("updateInvestigation merges a patch", async () => {
    const c = makeCase()
    await repo.saveInvestigation({ case: c })
    const updated = await repo.updateInvestigation(c.id, { case: { ...c, status: "MONITORING" } })
    expect(updated.case.status).toBe("MONITORING")
  })

  it("lists investigations most recently updated first", async () => {
    const a = makeCase()
    const b = makeCase()
    await repo.saveInvestigation({ case: a })
    await new Promise((r) => setTimeout(r, 5))
    await repo.saveInvestigation({ case: b })
    const list = await repo.listInvestigations()
    const idxA = list.findIndex((i) => i.id === a.id)
    const idxB = list.findIndex((i) => i.id === b.id)
    expect(idxB).toBeLessThan(idxA)
  })

  it("searches by id, title, wallet and status", async () => {
    const c = makeCase({ title: "Uniquely Named Case", reportedWallet: "0xdeadbeef" })
    await repo.saveInvestigation({ case: c })

    expect((await repo.searchInvestigations({ q: "Uniquely Named" })).some((i) => i.id === c.id)).toBe(true)
    expect((await repo.searchInvestigations({ q: "0xdeadbeef" })).some((i) => i.id === c.id)).toBe(true)
    expect((await repo.searchInvestigations({ q: c.id })).some((i) => i.id === c.id)).toBe(true)
    expect((await repo.searchInvestigations({ q: "no-such-term-xyz" })).some((i) => i.id === c.id)).toBe(false)
  })

  it("records and returns investigation history events", async () => {
    const c = makeCase()
    await repo.saveInvestigation({ case: c })
    await repo.appendInvestigationEvent({
      investigationId: c.id,
      actor: "Lead Investigator",
      action: "INVESTIGATION_SAVED",
      detail: "Saved.",
    })
    const history = await repo.getInvestigationHistory(c.id)
    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history.some((e) => e.action === "CASE_CREATED")).toBe(true)
    expect(history.some((e) => e.action === "INVESTIGATION_SAVED")).toBe(true)
  })

  it("preserves createdAt and advances updatedAt on save", async () => {
    const c = makeCase()
    const first = await repo.saveInvestigation({ case: c })
    await new Promise((r) => setTimeout(r, 5))
    const second = await repo.saveInvestigation({ case: c })
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt >= first.updatedAt).toBe(true)
    expect(typeof second.createdAt).toBe("string")
    expect(typeof second.updatedAt).toBe("string")
  })
})

describe("repository factory selection", () => {
  const original = process.env.DATABASE_URL

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
  })

  it("selects IN_MEMORY when DATABASE_URL is not set", () => {
    delete process.env.DATABASE_URL
    expect(getPersistenceMode()).toBe("IN_MEMORY")
    expect(getRepository().persistenceMode).toBe("IN_MEMORY")
    expect(persistenceLabel("IN_MEMORY")).toBe("In-Memory Development")
  })

  it("selects POSTGRES when DATABASE_URL is set (no connection made)", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"
    expect(getPersistenceMode()).toBe("POSTGRES")
    expect(getRepository().persistenceMode).toBe("POSTGRES")
    expect(persistenceLabel("POSTGRES")).toBe("Persistent Database")
  })
})
