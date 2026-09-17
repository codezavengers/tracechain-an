import { describe, it, expect } from "vitest"
import type { Transaction, Alert } from "@/lib/types"
import {
  runInvestigationIntelligence,
  detectHighVelocity,
  detectRapidMovement,
  detectConsolidation,
  detectDispersion,
  detectStructuring,
  intelligenceRiskLevel,
  INTEL_CONFIG,
} from "./investigation-intelligence"

const TARGET = "0xtarget0000000000000000000000000000target"

// Minimal transaction factory — only the fields the engine reads matter.
let seq = 0
function tx(partial: Partial<Transaction> & { from: string; to: string }): Transaction {
  seq += 1
  return {
    hash: partial.hash ?? `0xhash${seq}`,
    chain: "ethereum",
    amount: partial.amount ?? 1,
    asset: partial.asset ?? "ETH",
    usdValue: partial.usdValue ?? null,
    timestamp: partial.timestamp ?? null,
    blockHeight: null,
    provenance: "HEURISTIC_ANALYSIS",
    ...partial,
  }
}

const BASE = Date.parse("2026-01-01T00:00:00.000Z")
function at(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString()
}

describe("intelligenceRiskLevel", () => {
  it("maps scores to the engine's own bands", () => {
    expect(intelligenceRiskLevel(0)).toBe("LOW")
    expect(intelligenceRiskLevel(24)).toBe("LOW")
    expect(intelligenceRiskLevel(25)).toBe("MEDIUM")
    expect(intelligenceRiskLevel(49)).toBe("MEDIUM")
    expect(intelligenceRiskLevel(50)).toBe("HIGH")
    expect(intelligenceRiskLevel(74)).toBe("HIGH")
    expect(intelligenceRiskLevel(75)).toBe("CRITICAL")
    expect(intelligenceRiskLevel(100)).toBe("CRITICAL")
  })
})

describe("detectHighVelocity", () => {
  it("flags a dense burst within the velocity window", () => {
    const txs = Array.from({ length: INTEL_CONFIG.velocityMinTx }, (_, i) =>
      tx({ from: TARGET, to: `0xdest${i}`, timestamp: at(i * 60_000) }),
    )
    const p = detectHighVelocity(txs)
    expect(p).not.toBeNull()
    expect(p!.type).toBe("HIGH_TRANSACTION_VELOCITY")
    expect(p!.metrics.transactionsInWindow).toBe(INTEL_CONFIG.velocityMinTx)
    expect(p!.supportingTransactions.length).toBe(INTEL_CONFIG.velocityMinTx)
  })

  it("does not flag transactions spread far apart", () => {
    const txs = Array.from({ length: INTEL_CONFIG.velocityMinTx }, (_, i) =>
      tx({ from: TARGET, to: `0xdest${i}`, timestamp: at(i * 3 * 60 * 60_000) }),
    )
    expect(detectHighVelocity(txs)).toBeNull()
  })

  it("returns null when too few transactions are timestamped", () => {
    const txs = [tx({ from: TARGET, to: "0xa" }), tx({ from: TARGET, to: "0xb" })]
    expect(detectHighVelocity(txs)).toBeNull()
  })
})

describe("detectRapidMovement", () => {
  it("flags funds that arrive and leave within the window", () => {
    const txs = [
      tx({ from: "0xsource", to: TARGET, timestamp: at(0), amount: 5 }),
      tx({ from: TARGET, to: "0xnext", timestamp: at(5 * 60_000), amount: 5 }),
    ]
    const p = detectRapidMovement(txs, TARGET)
    expect(p).not.toBeNull()
    expect(p!.type).toBe("RAPID_FUND_MOVEMENT")
    expect(p!.metrics.fastestTurnaroundMinutes).toBe(5)
  })

  it("does not flag when outflow is long after inflow", () => {
    const txs = [
      tx({ from: "0xsource", to: TARGET, timestamp: at(0) }),
      tx({ from: TARGET, to: "0xnext", timestamp: at(5 * 60 * 60_000) }),
    ]
    expect(detectRapidMovement(txs, TARGET)).toBeNull()
  })
})

describe("detectConsolidation", () => {
  it("flags many distinct sources funneling into the target", () => {
    const txs = Array.from({ length: INTEL_CONFIG.consolidationMinSources }, (_, i) =>
      tx({ from: `0xsource${i}`, to: TARGET }),
    )
    const p = detectConsolidation(txs, TARGET)
    expect(p).not.toBeNull()
    expect(p!.metrics.uniqueSources).toBe(INTEL_CONFIG.consolidationMinSources)
  })

  it("does not flag when the same source repeats", () => {
    const txs = Array.from({ length: 5 }, () => tx({ from: "0xonesource", to: TARGET }))
    expect(detectConsolidation(txs, TARGET)).toBeNull()
  })
})

describe("detectDispersion", () => {
  it("flags funds fanned out to many destinations", () => {
    const txs = Array.from({ length: INTEL_CONFIG.dispersionMinDestinations }, (_, i) =>
      tx({ from: TARGET, to: `0xdest${i}` }),
    )
    const p = detectDispersion(txs, TARGET)
    expect(p).not.toBeNull()
    expect(p!.metrics.uniqueDestinations).toBe(INTEL_CONFIG.dispersionMinDestinations)
  })
})

describe("detectStructuring", () => {
  it("flags a cluster of similarly-sized transfers", () => {
    const txs = [
      tx({ from: TARGET, to: "0xa", amount: 100, timestamp: at(0) }),
      tx({ from: TARGET, to: "0xb", amount: 105, timestamp: at(60_000) }),
      tx({ from: TARGET, to: "0xc", amount: 98, timestamp: at(120_000) }),
    ]
    const p = detectStructuring(txs)
    expect(p).not.toBeNull()
    expect(p!.type).toBe("POTENTIAL_STRUCTURING")
    expect(Number(p!.metrics.similarTransfers)).toBeGreaterThanOrEqual(INTEL_CONFIG.structuringMinTx)
  })

  it("does not flag transfers of very different sizes", () => {
    const txs = [
      tx({ from: TARGET, to: "0xa", amount: 1 }),
      tx({ from: TARGET, to: "0xb", amount: 500 }),
      tx({ from: TARGET, to: "0xc", amount: 9000 }),
    ]
    expect(detectStructuring(txs)).toBeNull()
  })
})

describe("runInvestigationIntelligence", () => {
  it("returns a bounded score and honest empty read for no activity", () => {
    const r = runInvestigationIntelligence({ targetWallet: TARGET, transactions: [] })
    expect(r.overallRiskScore).toBe(0)
    expect(r.riskLevel).toBe("LOW")
    expect(r.confidence).toBe("LOW")
    expect(r.detectedPatterns).toHaveLength(0)
    expect(r.findings.some((f) => /No high-risk/.test(f))).toBe(true)
  })

  it("clamps the score to 100 even with many stacked signals", () => {
    const txs = [
      ...Array.from({ length: 6 }, (_, i) => tx({ from: `0xsrc${i}`, to: TARGET, timestamp: at(i * 60_000), amount: 100 })),
      ...Array.from({ length: 6 }, (_, i) => tx({ from: TARGET, to: `0xout${i}`, timestamp: at(i * 60_000 + 30_000), amount: 100 })),
    ]
    const alerts: Alert[] = [
      { id: "al1", walletAddress: TARGET, chain: "ethereum", severity: "CRITICAL", type: "X", message: "m", createdAt: at(0), acknowledged: false },
    ]
    const r = runInvestigationIntelligence({
      targetWallet: TARGET,
      transactions: txs,
      alerts,
      attribution: { kind: "MIXER" },
    })
    expect(r.overallRiskScore).toBeLessThanOrEqual(100)
    expect(r.overallRiskScore).toBeGreaterThan(0)
    expect(r.detectedPatterns.length).toBeGreaterThan(0)
    expect(r.recommendations.length).toBeGreaterThan(0)
    // Alert + mixer attribution should both surface as explicit risk factors.
    expect(r.riskFactors.some((f) => /alert/i.test(f.label))).toBe(true)
    expect(r.riskFactors.some((f) => /attribution/i.test(f.label))).toBe(true)
  })

  it("only counts alerts for the target wallet", () => {
    const txs = [tx({ from: "0xsrc", to: TARGET }), tx({ from: TARGET, to: "0xdst" })]
    const alerts: Alert[] = [
      { id: "al1", walletAddress: "0xotherwallet", chain: "ethereum", severity: "CRITICAL", type: "X", message: "m", createdAt: at(0), acknowledged: false },
    ]
    const r = runInvestigationIntelligence({ targetWallet: TARGET, transactions: txs, alerts })
    expect(r.riskFactors.some((f) => /alert/i.test(f.label))).toBe(false)
  })
})
