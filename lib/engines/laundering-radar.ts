import type { IntelResult } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { nowIso, clamp } from "./context"

export type LaunderingPattern =
  | "LAYERING"
  | "PEEL_CHAIN"
  | "FAN_OUT"
  | "FAN_IN"
  | "MIXING"
  | "SMURFING"
  | "RAPID_MOVEMENT"

export interface DetectedPattern {
  pattern: LaunderingPattern
  confidence: number
  detail: string
  addresses: string[]
}

export interface LaunderingResult {
  patterns: DetectedPattern[]
  launderingScore: number // 0..100
}

// LAUNDERING RADAR: detects structured laundering behaviors in the graph.
export function runLaunderingRadar(ctx: AnalysisContext): IntelResult<LaunderingResult> {
  const patterns: DetectedPattern[] = []
  const nodes = ctx.graph.nodes
  const edges = ctx.graph.edges

  // FAN_OUT: a node splitting to many children
  for (const n of nodes) {
    const outs = edges.filter((e) => e.source === n.id)
    if (outs.length >= 4) {
      patterns.push({
        pattern: "FAN_OUT",
        confidence: clamp(0.5 + outs.length * 0.05),
        detail: `${n.id.slice(0, 10)}… splits funds across ${outs.length} outputs (dispersion).`,
        addresses: [n.id, ...outs.map((e) => e.target)],
      })
    }
  }

  // FAN_IN: many sources consolidating into one node
  for (const n of nodes) {
    const ins = edges.filter((e) => e.target === n.id)
    if (ins.length >= 4 && n.kind !== "VICTIM") {
      patterns.push({
        pattern: "FAN_IN",
        confidence: clamp(0.5 + ins.length * 0.05),
        detail: `${n.id.slice(0, 10)}… consolidates ${ins.length} inputs (aggregation before cash-out).`,
        addresses: [n.id, ...ins.map((e) => e.source)],
      })
    }
  }

  // MIXING
  const mixers = nodes.filter((n) => n.kind === "MIXER")
  if (mixers.length) {
    patterns.push({
      pattern: "MIXING",
      confidence: 0.85,
      detail: `Interaction with ${mixers.length} mixing endpoint(s) — deliberate trail obfuscation.`,
      addresses: mixers.map((m) => m.id),
    })
  }

  // LAYERING: deep chains
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth ?? 0))
  if (maxDepth >= 3) {
    patterns.push({
      pattern: "LAYERING",
      confidence: clamp(0.4 + maxDepth * 0.1),
      detail: `${maxDepth} sequential hops indicate deliberate layering to distance funds from origin.`,
      addresses: [ctx.rootAddress],
    })
  }

  // PEEL_CHAIN: sequential single-out nodes with decreasing value
  let peelLen = 0
  let cursor = ctx.rootAddress
  const peelAddrs: string[] = [cursor]
  for (let i = 0; i < 8; i++) {
    const outs = edges.filter((e) => e.source === cursor)
    if (outs.length === 1) {
      peelLen++
      cursor = outs[0].target
      peelAddrs.push(cursor)
    } else break
  }
  if (peelLen >= 3) {
    patterns.push({
      pattern: "PEEL_CHAIN",
      confidence: clamp(0.4 + peelLen * 0.1),
      detail: `Sequential single-output chain of length ${peelLen} (peel-chain relay).`,
      addresses: peelAddrs,
    })
  }

  // SMURFING: many similar small-value transfers
  const small = edges.filter((e) => e.usdValue > 0 && e.usdValue < ctx.reportedLossUsd * 0.05)
  if (small.length >= 6) {
    patterns.push({
      pattern: "SMURFING",
      confidence: clamp(0.4 + small.length * 0.03),
      detail: `${small.length} small structured transfers below reporting-relevant thresholds.`,
      addresses: small.slice(0, 6).map((e) => e.target),
    })
  }

  // RAPID_MOVEMENT: short time window across the whole flow
  if (edges.length) {
    const times = edges.map((e) => Date.parse(e.timestamp)).sort((a, b) => a - b)
    const spanH = (times[times.length - 1] - times[0]) / 3600000
    if (spanH <= 6 && edges.length >= 3) {
      patterns.push({
        pattern: "RAPID_MOVEMENT",
        confidence: clamp(0.6 + (6 - spanH) * 0.05),
        detail: `Entire flow executed within ~${spanH.toFixed(1)}h — automated rapid movement.`,
        addresses: [ctx.rootAddress],
      })
    }
  }

  patterns.sort((a, b) => b.confidence - a.confidence)
  const launderingScore = Math.min(
    100,
    Math.round(patterns.reduce((s, p) => s + p.confidence * 18, 0)),
  )

  return {
    result: { patterns, launderingScore },
    confidence: clamp(0.55 + patterns.length * 0.05),
    explanation:
      "Laundering Radar detects structured money-laundering behaviors — layering, peel chains, fan-in/fan-out, mixing, smurfing, and rapid movement — from graph topology and transaction timing.",
    evidence: patterns.length
      ? patterns.map((p) => `${p.pattern} (${(p.confidence * 100).toFixed(0)}%): ${p.detail}`)
      : ["No structured laundering pattern detected in the current trace."],
    recommendation:
      launderingScore >= 50
        ? "High laundering activity. Prioritize speed: pursue VASP freeze requests before funds fully disperse."
        : "Moderate/low laundering signal. Continue tracing and monitor for new movement.",
    analysisType: "graph",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
