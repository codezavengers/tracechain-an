import type { IntelResult } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { nowIso, clamp } from "./context"

export interface GhostWallet {
  address: string
  score: number // 0..1 likelihood of being a burner
  signals: string[]
  inUsd: number
  outUsd: number
  holdMinutes: number | null
}

export interface GhostWalletResult {
  burners: GhostWallet[]
  suspectedBurnerCount: number
}

// GHOST WALLET DETECTOR: identifies burner/pass-through wallets.
// Signals: single-in/single-out, near-100% pass-through value, very short
// hold time, no residual balance, low degree.
export function runGhostWallet(ctx: AnalysisContext): IntelResult<GhostWalletResult> {
  const burners: GhostWallet[] = []

  for (const node of ctx.graph.nodes) {
    if (node.kind === "VICTIM" || node.kind === "EXCHANGE" || node.id === ctx.rootAddress) continue
    const ins = ctx.graph.edges.filter((e) => e.target === node.id)
    const outs = ctx.graph.edges.filter((e) => e.source === node.id)
    if (ins.length === 0) continue

    const inUsd = ins.reduce((s, e) => s + e.usdValue, 0)
    const outUsd = outs.reduce((s, e) => s + e.usdValue, 0)
    const signals: string[] = []
    let score = 0

    if (ins.length <= 2 && outs.length <= 2) {
      score += 0.25
      signals.push(`Low degree (in ${ins.length}, out ${outs.length}) — consistent with pass-through.`)
    }
    const passRatio = inUsd > 0 ? outUsd / inUsd : 0
    if (passRatio >= 0.9 && outs.length > 0) {
      score += 0.35
      signals.push(`${(passRatio * 100).toFixed(0)}% of inbound value forwarded onward (near-total pass-through).`)
    }

    // Hold time between first in and first out
    let holdMinutes: number | null = null
    if (ins.length && outs.length) {
      const firstIn = Math.min(...ins.map((e) => Date.parse(e.timestamp)))
      const firstOut = Math.min(...outs.map((e) => Date.parse(e.timestamp)))
      holdMinutes = Math.round((firstOut - firstIn) / 60000)
      if (holdMinutes >= 0 && holdMinutes <= 120) {
        score += 0.25
        signals.push(`Funds held only ~${holdMinutes} min before forwarding (rapid relay).`)
      }
    }

    const meta = node.usdValue ?? 0
    if (outs.length > 0 && meta < inUsd * 0.05) {
      score += 0.15
      signals.push("No meaningful residual balance retained.")
    }
    if (node.kind === "BURNER") {
      score = Math.max(score, 0.8)
      signals.push("Structural role in flow matches single-use burner pattern.")
    }

    score = clamp(score)
    if (score >= 0.5) {
      burners.push({
        address: node.id,
        score: +score.toFixed(2),
        signals,
        inUsd: +inUsd.toFixed(2),
        outUsd: +outUsd.toFixed(2),
        holdMinutes,
      })
    }
  }

  burners.sort((a, b) => b.score - a.score)

  return {
    result: { burners, suspectedBurnerCount: burners.length },
    confidence: clamp(0.6 + (burners.length ? 0.15 : -0.1)),
    explanation:
      "The Ghost Wallet Detector flags burner / pass-through wallets using degree, pass-through ratio, hold time, and residual-balance heuristics. Burners are disposable hops used to fragment and obscure the trail.",
    evidence: burners.length
      ? burners.slice(0, 8).map((b) => `${b.address.slice(0, 10)}… burner-likelihood ${(b.score * 100).toFixed(0)}% — ${b.signals[0]}`)
      : ["No burner-pattern wallets detected in the current trace."],
    recommendation: burners.length
      ? "Treat flagged burners as relay hops, not endpoints. Continue tracing through them toward exit points."
      : "No burner remediation needed; funds may be moving through service endpoints instead.",
    analysisType: "heuristic",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
