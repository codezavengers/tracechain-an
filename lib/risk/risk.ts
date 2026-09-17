import type { RiskBand, IntelResult } from "@/lib/types"
import type { AnalysisContext } from "@/lib/engines/context"
import { nowIso } from "@/lib/engines/context"

export function riskBand(score: number): RiskBand {
  if (score <= 30) return "LOW"
  if (score <= 60) return "MEDIUM"
  if (score <= 80) return "HIGH"
  return "CRITICAL"
}

export interface RiskBreakdown {
  score: number
  band: RiskBand
  factors: { label: string; points: number; detail: string }[]
}

// Hybrid rule + graph + statistical risk model.
export function computeRisk(ctx: AnalysisContext): IntelResult<RiskBreakdown> {
  const factors: RiskBreakdown["factors"] = []
  const nodes = ctx.graph.nodes
  const edges = ctx.graph.edges

  const burners = nodes.filter((n) => n.kind === "BURNER").length
  const mixers = nodes.filter((n) => n.kind === "MIXER").length
  const bridges = nodes.filter((n) => n.kind === "BRIDGE").length
  const exchanges = nodes.filter((n) => n.kind === "EXCHANGE").length
  const depth = Math.max(0, ...nodes.map((n) => n.depth ?? 0))

  // Layering depth
  const layeringPts = Math.min(25, depth * 5)
  factors.push({
    label: "Layering depth",
    points: layeringPts,
    detail: `${depth} hops of movement observed from the reported wallet.`,
  })

  // Burner presence
  const burnerPts = Math.min(20, burners * 4)
  factors.push({
    label: "Burner wallets",
    points: burnerPts,
    detail: `${burners} suspected single-use burner wallet(s) in the flow.`,
  })

  // Mixer usage (strong signal)
  const mixerPts = mixers > 0 ? 25 : 0
  factors.push({
    label: "Mixing service interaction",
    points: mixerPts,
    detail: mixers > 0 ? `Interaction with ${mixers} mixing endpoint(s) detected.` : "No mixing interaction detected.",
  })

  // Cross-chain movement
  const bridgePts = bridges > 0 ? 15 : 0
  factors.push({
    label: "Cross-chain movement",
    points: bridgePts,
    detail: bridges > 0 ? `${bridges} bridge hop(s) obscure same-chain tracing.` : "No cross-chain bridging detected.",
  })

  // Fan-out complexity (statistical)
  const avgOut = edges.length / Math.max(1, nodes.length)
  const fanPts = Math.min(10, Math.round(avgOut * 4))
  factors.push({
    label: "Structural complexity",
    points: fanPts,
    detail: `Average out-degree ${avgOut.toFixed(2)} across ${nodes.length} nodes.`,
  })

  // Loss magnitude
  const lossPts = ctx.reportedLossUsd >= 250000 ? 10 : ctx.reportedLossUsd >= 100000 ? 7 : ctx.reportedLossUsd >= 25000 ? 4 : 2
  factors.push({
    label: "Financial impact",
    points: lossPts,
    detail: `Reported loss of approximately $${Math.round(ctx.reportedLossUsd).toLocaleString()}.`,
  })

  let score = factors.reduce((s, f) => s + f.points, 0)
  // Exchange endpoint slightly reduces risk (recoverable) but never below signal.
  if (exchanges > 0) {
    factors.push({
      label: "Identifiable exit (mitigating)",
      points: -5,
      detail: `${exchanges} exchange endpoint(s) provide a potential recovery lever.`,
    })
    score -= 5
  }
  score = Math.max(0, Math.min(100, Math.round(score)))

  const band = riskBand(score)
  return {
    result: { score, band, factors },
    confidence: ctx.provenance === "DEMO_DATA" ? 0.9 : 0.75,
    explanation:
      "Risk is a weighted composite of layering depth, burner/mixer usage, cross-chain movement, structural complexity, and financial impact.",
    evidence: factors.map((f) => `${f.label}: ${f.points >= 0 ? "+" : ""}${f.points} — ${f.detail}`),
    recommendation:
      band === "CRITICAL" || band === "HIGH"
        ? "Escalate for priority review and prepare a VASP outreach ActionPack."
        : "Continue monitoring; re-score if new movement is observed.",
    analysisType: "statistical",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
