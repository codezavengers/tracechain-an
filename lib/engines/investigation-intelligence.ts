import type { Transaction, Alert, AttributionCategory, WalletKind, IntelResult } from "@/lib/types"
import { nowIso, clamp, usd } from "./context"

// INVESTIGATION INTELLIGENCE ENGINE
// -----------------------------------------------------------------------------
// A deterministic, heuristic layer that turns the raw transaction activity of a
// single wallet into an explainable risk read: a bounded 0..100 score, a set of
// detected behavioral patterns, the specific factors that drove the score, and
// evidence-based findings + next steps. It reuses signals the platform already
// produces (existing alerts, counterparty attribution) and NEVER fabricates
// data — everything is derived from the transactions actually present.
//
// Language is deliberately careful: patterns are described as behaviors and
// "potential" indicators, never as proven crimes.

export type IntelPatternType =
  | "HIGH_TRANSACTION_VELOCITY"
  | "RAPID_FUND_MOVEMENT"
  | "FUND_CONSOLIDATION"
  | "FUND_DISPERSION"
  | "POTENTIAL_STRUCTURING"

export type IntelRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
export type IntelConfidence = "LOW" | "MEDIUM" | "HIGH"

export interface DetectedIntelPattern {
  type: IntelPatternType
  title: string
  description: string
  confidence: number // 0..1
  supportingTransactions: string[] // transaction hashes that evidence the pattern
  metrics: Record<string, string | number>
}

export interface IntelRiskFactor {
  label: string
  points: number
  explanation: string
}

export interface InvestigationIntelligenceResult {
  overallRiskScore: number // 0..100
  riskLevel: IntelRiskLevel
  confidence: IntelConfidence
  detectedPatterns: DetectedIntelPattern[]
  riskFactors: IntelRiskFactor[]
  findings: string[]
  recommendations: string[]
  summary: string
  analyzedTransactionCount: number
  generatedAt: string
}

export interface IntelligenceInput {
  targetWallet: string
  transactions: Transaction[]
  alerts?: Alert[]
  attribution?: { category?: AttributionCategory; kind?: WalletKind } | null
  reportedLossUsd?: number
}

// ---- Tunable, explicit thresholds (kept here so behavior is transparent) ----
export const INTEL_CONFIG = {
  velocityWindowMs: 60 * 60 * 1000, // 1 hour
  velocityMinTx: 5,
  rapidMovementWindowMs: 30 * 60 * 1000, // 30 minutes
  consolidationMinSources: 3,
  dispersionMinDestinations: 3,
  structuringWindowMs: 24 * 60 * 60 * 1000, // 24 hours
  structuringAmountTolerance: 0.15, // ±15%
  structuringMinTx: 3,
  patternPoints: {
    HIGH_TRANSACTION_VELOCITY: 20,
    RAPID_FUND_MOVEMENT: 20,
    FUND_CONSOLIDATION: 15,
    FUND_DISPERSION: 15,
    POTENTIAL_STRUCTURING: 12,
  } as Record<IntelPatternType, number>,
} as const

// Risk-level bands are specific to this engine (0-24 / 25-49 / 50-74 / 75-100)
// and intentionally independent of the platform-wide risk band thresholds.
export function intelligenceRiskLevel(score: number): IntelRiskLevel {
  if (score >= 75) return "CRITICAL"
  if (score >= 50) return "HIGH"
  if (score >= 25) return "MEDIUM"
  return "LOW"
}

// ---- Small local helpers (kept self-contained to avoid engine<-provider deps) ----
function sameAddr(a: string | undefined | null, b: string | undefined | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

function directionFor(tx: Transaction, target: string): "in" | "out" | undefined {
  if (sameAddr(tx.to, target)) return "in"
  if (sameAddr(tx.from, target)) return "out"
  return undefined
}

function txTimeMs(tx: Transaction): number | null {
  if (!tx.timestamp) return null
  const t = Date.parse(tx.timestamp)
  return Number.isNaN(t) ? null : t
}

function txId(tx: Transaction, index: number): string {
  return tx.hash || `tx_${index}`
}

// Transactions that actually touch the target wallet (as sender or recipient).
function walletTransactions(txs: Transaction[], target: string): Transaction[] {
  return txs.filter((t) => sameAddr(t.from, target) || sameAddr(t.to, target))
}

// ---- Pattern detectors (each pure; each returns a pattern or null) ----

// HIGH_TRANSACTION_VELOCITY: an unusually dense burst of activity within a
// bounded time window (sliding-window maximum over timestamped transactions).
export function detectHighVelocity(txs: Transaction[]): DetectedIntelPattern | null {
  const timed = txs
    .map((t, i) => ({ t, i, ms: txTimeMs(t) }))
    .filter((x): x is { t: Transaction; i: number; ms: number } => x.ms !== null)
    .sort((a, b) => a.ms - b.ms)
  if (timed.length < INTEL_CONFIG.velocityMinTx) return null

  let bestStart = 0
  let bestEnd = 0
  let bestCount = 0
  let windowStart = 0
  for (let end = 0; end < timed.length; end++) {
    while (timed[end].ms - timed[windowStart].ms > INTEL_CONFIG.velocityWindowMs) windowStart++
    const count = end - windowStart + 1
    if (count > bestCount) {
      bestCount = count
      bestStart = windowStart
      bestEnd = end
    }
  }
  if (bestCount < INTEL_CONFIG.velocityMinTx) return null

  const windowTxs = timed.slice(bestStart, bestEnd + 1)
  const spanMinutes = (windowTxs[windowTxs.length - 1].ms - windowTxs[0].ms) / 60000

  return {
    type: "HIGH_TRANSACTION_VELOCITY",
    title: "High transaction velocity",
    description: `${bestCount} transactions occurred within a ${Math.max(1, Math.round(spanMinutes))}-minute window — a burst of activity well above normal wallet cadence.`,
    confidence: clamp(0.5 + (bestCount - INTEL_CONFIG.velocityMinTx) * 0.06, 0, 0.95),
    supportingTransactions: windowTxs.map((x) => txId(x.t, x.i)),
    metrics: {
      transactionsInWindow: bestCount,
      windowMinutes: Math.max(1, Math.round(spanMinutes)),
    },
  }
}

// RAPID_FUND_MOVEMENT: funds arrive and are moved back out within a short
// window (classic pass-through behavior).
export function detectRapidMovement(txs: Transaction[], target: string): DetectedIntelPattern | null {
  const incoming = txs
    .map((t, i) => ({ t, i, ms: txTimeMs(t) }))
    .filter((x) => x.ms !== null && directionFor(x.t, target) === "in") as { t: Transaction; i: number; ms: number }[]
  const outgoing = txs
    .map((t, i) => ({ t, i, ms: txTimeMs(t) }))
    .filter((x) => x.ms !== null && directionFor(x.t, target) === "out") as { t: Transaction; i: number; ms: number }[]
  if (!incoming.length || !outgoing.length) return null

  const support = new Set<string>()
  let minGapMs = Number.POSITIVE_INFINITY
  for (const inc of incoming) {
    for (const out of outgoing) {
      const gap = out.ms - inc.ms
      if (gap >= 0 && gap <= INTEL_CONFIG.rapidMovementWindowMs) {
        support.add(txId(inc.t, inc.i))
        support.add(txId(out.t, out.i))
        if (gap < minGapMs) minGapMs = gap
      }
    }
  }
  if (support.size === 0) return null

  const minGapMinutes = Math.round(minGapMs / 60000)
  return {
    type: "RAPID_FUND_MOVEMENT",
    title: "Rapid fund movement",
    description: `Incoming funds were forwarded out again within ${minGapMinutes} minute(s) — pass-through behavior that shortens the window to intervene.`,
    confidence: clamp(0.6 + (support.size - 2) * 0.05, 0, 0.95),
    supportingTransactions: [...support],
    metrics: {
      fastestTurnaroundMinutes: minGapMinutes,
      involvedTransactions: support.size,
    },
  }
}

// FUND_CONSOLIDATION: many distinct sources funnel into the target wallet.
export function detectConsolidation(txs: Transaction[], target: string): DetectedIntelPattern | null {
  const incoming = txs.filter((t) => directionFor(t, target) === "in")
  const sources = new Set(incoming.map((t) => t.from.toLowerCase()))
  if (sources.size < INTEL_CONFIG.consolidationMinSources) return null
  return {
    type: "FUND_CONSOLIDATION",
    title: "Fund consolidation",
    description: `${sources.size} distinct wallets sent funds into this address (${incoming.length} inbound transfers) — consolidation consistent with aggregation before cash-out.`,
    confidence: clamp(0.5 + sources.size * 0.05, 0, 0.95),
    supportingTransactions: incoming.map((t, i) => txId(t, i)),
    metrics: {
      uniqueSources: sources.size,
      inboundTransfers: incoming.length,
    },
  }
}

// FUND_DISPERSION: the target wallet fans funds out to many distinct wallets.
export function detectDispersion(txs: Transaction[], target: string): DetectedIntelPattern | null {
  const outgoing = txs.filter((t) => directionFor(t, target) === "out")
  const destinations = new Set(outgoing.map((t) => t.to.toLowerCase()))
  if (destinations.size < INTEL_CONFIG.dispersionMinDestinations) return null
  return {
    type: "FUND_DISPERSION",
    title: "Fund dispersion",
    description: `Funds were split across ${destinations.size} distinct destinations (${outgoing.length} outbound transfers) — dispersion that fragments the trail.`,
    confidence: clamp(0.5 + destinations.size * 0.05, 0, 0.95),
    supportingTransactions: outgoing.map((t, i) => txId(t, i)),
    metrics: {
      uniqueDestinations: destinations.size,
      outboundTransfers: outgoing.length,
    },
  }
}

// POTENTIAL_STRUCTURING: a cluster of similarly-sized transfers within a
// bounded period. Reported as a POTENTIAL indicator only — never asserted as
// laundering or a crime.
export function detectStructuring(txs: Transaction[]): DetectedIntelPattern | null {
  const valued = txs.map((t, i) => ({ t, i, amt: t.amount })).filter((x) => x.amt > 0)
  if (valued.length < INTEL_CONFIG.structuringMinTx) return null

  let best: { anchorAmt: number; members: { t: Transaction; i: number }[] } | null = null
  for (const anchor of valued) {
    const tol = anchor.amt * INTEL_CONFIG.structuringAmountTolerance
    const anchorMs = txTimeMs(anchor.t)
    const members = valued.filter((x) => {
      if (Math.abs(x.amt - anchor.amt) > tol) return false
      const ms = txTimeMs(x.t)
      // If both timestamps exist, require them inside the structuring window.
      // If either is unknown, fall back to amount-similarity alone (honest —
      // we do not invent a time relationship that isn't in the data).
      if (anchorMs !== null && ms !== null && Math.abs(ms - anchorMs) > INTEL_CONFIG.structuringWindowMs) return false
      return true
    })
    if (members.length >= INTEL_CONFIG.structuringMinTx && (!best || members.length > best.members.length)) {
      best = { anchorAmt: anchor.amt, members }
    }
  }
  if (!best) return null

  const avg = best.members.reduce((s, m) => s + m.t.amount, 0) / best.members.length
  return {
    type: "POTENTIAL_STRUCTURING",
    title: "Potential structuring pattern",
    description: `${best.members.length} transfers of similar size (~${avg.toFixed(4)} ${best.members[0].t.asset}) cluster together — a potential structuring indicator that warrants a closer look. Not a determination of wrongdoing.`,
    confidence: clamp(0.4 + best.members.length * 0.06, 0, 0.9),
    supportingTransactions: best.members.map((m) => txId(m.t, m.i)),
    metrics: {
      similarTransfers: best.members.length,
      approxAmount: Number(avg.toFixed(6)),
      asset: best.members[0].t.asset,
    },
  }
}

// ---- Aggregation ----

function assessConfidence(walletTxCount: number, timestampedRatio: number, patternCount: number): IntelConfidence {
  if (walletTxCount < 3) return "LOW"
  if (walletTxCount >= 8 && timestampedRatio >= 0.6 && patternCount >= 2) return "HIGH"
  return "MEDIUM"
}

function buildFindings(params: {
  target: string
  incomingCount: number
  outgoingCount: number
  counterparties: number
  netUsd: number | null
  patterns: DetectedIntelPattern[]
}): string[] {
  const findings: string[] = []
  findings.push(
    `${params.incomingCount} inbound and ${params.outgoingCount} outbound transfer(s) analyzed across ${params.counterparties} distinct counterparties.`,
  )
  if (params.netUsd !== null) {
    const flow = params.netUsd >= 0 ? "net inflow" : "net outflow"
    findings.push(`Observed ${flow} of approximately ${usd(Math.abs(params.netUsd))} (from transfers with known USD value).`)
  }
  for (const p of params.patterns) {
    findings.push(`${p.title}: ${p.description}`)
  }
  if (!params.patterns.length) {
    findings.push("No high-risk transaction patterns were detected in the analyzed activity.")
  }
  return findings
}

function buildRecommendations(patterns: DetectedIntelPattern[], hasAttribution: boolean): string[] {
  const recs: string[] = []
  const has = (t: IntelPatternType) => patterns.some((p) => p.type === t)
  if (has("FUND_DISPERSION")) recs.push("Trace outgoing funds one additional hop to identify dispersion endpoints.")
  if (has("FUND_CONSOLIDATION")) recs.push("Review the wallets feeding this address for linked victims or common sources.")
  if (has("RAPID_FUND_MOVEMENT")) recs.push("Preserve the relevant transaction hashes as evidence before funds move further.")
  if (has("HIGH_TRANSACTION_VELOCITY")) recs.push("Monitor this wallet for continued high-velocity activity.")
  if (has("POTENTIAL_STRUCTURING")) recs.push("Examine the repeated similar-value transfers for potential structuring.")
  if (hasAttribution) recs.push("Verify counterparty VASP attribution before any enforcement or freeze request.")
  recs.push("Corroborate these heuristic findings with full multi-engine tracing before acting.")
  // De-duplicate while preserving order.
  return [...new Set(recs)]
}

// Main entry point: analyze a wallet's transactions into explainable intelligence.
export function runInvestigationIntelligence(input: IntelligenceInput): InvestigationIntelligenceResult {
  const target = input.targetWallet
  const walletTxs = walletTransactions(input.transactions, target)

  const patterns: DetectedIntelPattern[] = []
  const velocity = detectHighVelocity(walletTxs)
  const rapid = detectRapidMovement(walletTxs, target)
  const consolidation = detectConsolidation(input.transactions, target)
  const dispersion = detectDispersion(input.transactions, target)
  const structuring = detectStructuring(walletTxs)
  for (const p of [velocity, rapid, consolidation, dispersion, structuring]) if (p) patterns.push(p)

  // ---- Risk factors -> bounded score ----
  const riskFactors: IntelRiskFactor[] = []
  for (const p of patterns) {
    riskFactors.push({
      label: p.title,
      points: INTEL_CONFIG.patternPoints[p.type],
      explanation: p.description,
    })
  }

  // Reuse existing high-severity alerts already raised for this wallet.
  const walletAlerts = (input.alerts ?? []).filter(
    (a) => sameAddr(a.walletAddress, target) && (a.severity === "HIGH" || a.severity === "CRITICAL") && !a.acknowledged,
  )
  if (walletAlerts.length) {
    const points = Math.min(10, walletAlerts.length * 5)
    riskFactors.push({
      label: "Active high-severity alerts",
      points,
      explanation: `${walletAlerts.length} unacknowledged ${walletAlerts.length === 1 ? "alert" : "alerts"} already raised for this wallet.`,
    })
  }

  // Reuse counterparty attribution when it points at high-risk infrastructure.
  if (input.attribution?.kind === "MIXER" || input.attribution?.kind === "BURNER") {
    riskFactors.push({
      label: "High-risk counterparty attribution",
      points: 8,
      explanation: `Wallet interacts with infrastructure attributed as ${input.attribution.kind.toLowerCase()} — a known trail-obfuscation vector.`,
    })
  }

  const rawScore = riskFactors.reduce((s, f) => s + f.points, 0)
  const overallRiskScore = Math.max(0, Math.min(100, rawScore))
  const riskLevel = intelligenceRiskLevel(overallRiskScore)

  // ---- Findings / confidence / recommendations ----
  const incoming = input.transactions.filter((t) => directionFor(t, target) === "in")
  const outgoing = input.transactions.filter((t) => directionFor(t, target) === "out")
  const counterparties = new Set<string>()
  for (const t of incoming) counterparties.add(t.from.toLowerCase())
  for (const t of outgoing) counterparties.add(t.to.toLowerCase())

  const usdTxs = walletTxs.filter((t) => typeof t.usdValue === "number")
  const netUsd = usdTxs.length
    ? usdTxs.reduce((s, t) => s + (directionFor(t, target) === "in" ? (t.usdValue as number) : -(t.usdValue as number)), 0)
    : null

  const timestampedRatio = walletTxs.length ? walletTxs.filter((t) => txTimeMs(t) !== null).length / walletTxs.length : 0
  const confidence = assessConfidence(walletTxs.length, timestampedRatio, patterns.length)

  const findings = buildFindings({
    target,
    incomingCount: incoming.length,
    outgoingCount: outgoing.length,
    counterparties: counterparties.size,
    netUsd,
    patterns,
  })
  const recommendations = buildRecommendations(patterns, !!input.attribution?.kind)

  const shortTarget = `${target.slice(0, 8)}…${target.slice(-4)}`
  const summary =
    `Analyzed ${walletTxs.length} transaction(s) for ${shortTarget}. ` +
    `${patterns.length} risk pattern(s) detected. ` +
    `Overall risk ${overallRiskScore}/100 (${riskLevel}); analysis confidence ${confidence}.`

  return {
    overallRiskScore,
    riskLevel,
    confidence,
    detectedPatterns: patterns,
    riskFactors,
    findings,
    recommendations,
    summary,
    analyzedTransactionCount: walletTxs.length,
    generatedAt: nowIso(),
  }
}

// Wrap the raw result in the platform-standard IntelResult envelope so it can be
// rendered by the shared IntelResultCard like every other engine.
export function toIntelResult(r: InvestigationIntelligenceResult): IntelResult<InvestigationIntelligenceResult> {
  return {
    result: r,
    confidence: r.confidence === "HIGH" ? 0.85 : r.confidence === "MEDIUM" ? 0.6 : 0.35,
    explanation:
      "The Investigation Intelligence engine reads a wallet's transaction activity into an explainable risk score, detected behavioral patterns, and the specific factors behind the score. All signals are heuristic and derived only from observed transactions.",
    evidence: r.findings,
    recommendation: r.recommendations[0] ?? "Corroborate with full multi-engine tracing before acting.",
    analysisType: "heuristic",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: r.generatedAt,
  }
}
