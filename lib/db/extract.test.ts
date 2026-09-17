import { describe, it, expect, beforeEach } from "vitest"
import { extractTransactions } from "./extract"
import { DevelopmentDatabase } from "./development"
import type { InvestigationResult } from "@/lib/engines"
import type { JourneyStep } from "@/lib/types"

function makeResult(journey: JourneyStep[]): InvestigationResult {
  // Only `journey` is read by extractTransactions; cast the rest as a partial
  // result so the test does not depend on unrelated engine output shapes.
  return { journey } as unknown as InvestigationResult
}

function step(overrides: Partial<JourneyStep> & { step: number; address: string }): JourneyStep {
  return {
    title: `Step ${overrides.step}`,
    kind: "SUSPICIOUS",
    usdValue: 1000,
    timestamp: "2026-08-20T10:00:00.000Z",
    description: "moved",
    ...overrides,
  }
}

describe("extractTransactions", () => {
  it("returns no rows for an empty or single-step journey (never fabricates)", () => {
    expect(extractTransactions("TC-1", makeResult([]), "ethereum", "now")).toHaveLength(0)
    expect(
      extractTransactions("TC-1", makeResult([step({ step: 1, address: "0xroot" })]), "ethereum", "now"),
    ).toHaveLength(0)
    expect(extractTransactions("TC-1", null, "ethereum", "now")).toHaveLength(0)
  })

  it("derives one transaction per hop with authoritative from/to/usd/chain", () => {
    const journey = [
      step({ step: 1, address: "0xroot", usdValue: 50000 }),
      step({ step: 2, address: "0xburner", usdValue: 40000, timestamp: "2026-08-21T00:00:00.000Z" }),
      step({ step: 3, address: "0xexchange", usdValue: 30000, timestamp: "2026-08-22T00:00:00.000Z" }),
    ]
    const rows = extractTransactions("TC-1", makeResult(journey), "ethereum", "now-fallback")
    expect(rows).toHaveLength(2)

    expect(rows[0]).toMatchObject({
      id: "TC-1:tx:0",
      investigationId: "TC-1",
      chain: "ethereum",
      fromAddress: "0xroot",
      toAddress: "0xburner",
      usdValue: 40000,
      createdAt: "2026-08-21T00:00:00.000Z",
    })
    expect(rows[1]).toMatchObject({
      fromAddress: "0xburner",
      toAddress: "0xexchange",
      usdValue: 30000,
    })
    // Fields not present in the result are null, not fabricated.
    expect(rows[0].hash).toBeNull()
    expect(rows[0].amount).toBeNull()
    expect(rows[0].asset).toBeNull()
  })

  it("uses the now fallback when a step has no authoritative timestamp", () => {
    const journey = [
      step({ step: 1, address: "0xroot" }),
      step({ step: 2, address: "0xnext", timestamp: undefined as unknown as string }),
    ]
    const rows = extractTransactions("TC-1", makeResult(journey), "bitcoin", "2026-01-01T00:00:00.000Z")
    expect(rows[0].createdAt).toBe("2026-01-01T00:00:00.000Z")
    expect(rows[0].chain).toBe("bitcoin")
  })

  it("preserves ids across re-extraction so persistence can upsert without duplicates", () => {
    const journey = [
      step({ step: 1, address: "0xroot" }),
      step({ step: 2, address: "0xnext" }),
    ]
    const a = extractTransactions("TC-1", makeResult(journey), "ethereum", "now")
    const b = extractTransactions("TC-1", makeResult(journey), "ethereum", "now")
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
  })
})

describe("DevelopmentDatabase report persistence", () => {
  let repo: DevelopmentDatabase

  beforeEach(() => {
    repo = new DevelopmentDatabase()
  })

  it("persists a report and lists it back by investigation id", async () => {
    const saved = await repo.saveReport({
      investigationId: "TC-REPORT-1",
      generatedBy: "Lead Investigator",
      data: { summary: "test report", risk: { score: 72 } },
    })
    expect(saved.investigationId).toBe("TC-REPORT-1")
    expect(saved.generatedBy).toBe("Lead Investigator")
    expect(saved.id).toBeTruthy()
    expect(saved.createdAt).toBeTruthy()

    const list = await repo.listReports("TC-REPORT-1")
    expect(list).toHaveLength(1)
    expect(list[0].data).toMatchObject({ summary: "test report" })
  })

  it("keeps multiple reports for the same investigation in chronological order", async () => {
    await repo.saveReport({ investigationId: "TC-REPORT-2", data: { n: 1 }, createdAt: "2026-01-01T00:00:00.000Z" })
    await repo.saveReport({ investigationId: "TC-REPORT-2", data: { n: 2 }, createdAt: "2026-02-01T00:00:00.000Z" })
    const list = await repo.listReports("TC-REPORT-2")
    expect(list).toHaveLength(2)
    expect((list[0].data as { n: number }).n).toBe(1)
    expect((list[1].data as { n: number }).n).toBe(2)
  })

  it("returns an empty list for an investigation with no reports", async () => {
    expect(await repo.listReports("TC-NONE")).toEqual([])
  })
})
