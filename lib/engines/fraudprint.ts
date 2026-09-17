import type { IntelResult, FraudTypology } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { nowIso, clamp } from "./context"

export interface FraudprintResult {
  typology: FraudTypology
  scores: { typology: FraudTypology; score: number }[]
  indicators: string[]
}

// FRAUDPRINT AI: classifies fraud typology from structural + textual signals.
// Rule-weighted classifier over graph shape, timing, and complaint keywords.
export function runFraudprint(ctx: AnalysisContext, complaintText = ""): IntelResult<FraudprintResult> {
  const text = complaintText.toLowerCase()
  const nodes = ctx.graph.nodes
  const edges = ctx.graph.edges
  const victims = nodes.filter((n) => n.kind === "VICTIM").length
  const bridges = nodes.filter((n) => n.kind === "BRIDGE").length
  const mixers = nodes.filter((n) => n.kind === "MIXER").length
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth ?? 0))

  let span = 0
  if (edges.length) {
    const times = edges.map((e) => Date.parse(e.timestamp))
    span = (Math.max(...times) - Math.min(...times)) / 3600000
  }

  const scores: Record<FraudTypology, number> = {
    INVESTMENT_FRAUD: 0,
    TASK_SCAM: 0,
    RANSOMWARE: 0,
    CROSS_CHAIN_LAUNDERING: 0,
    ORGANIZED_FRAUD: 0,
    RAPID_CASHOUT: 0,
    PIG_BUTCHERING: 0,
    UNKNOWN: 0.1,
  }
  const indicators: string[] = []

  const kw = (words: string[], t: FraudTypology, w: number, label: string) => {
    if (words.some((x) => text.includes(x))) {
      scores[t] += w
      indicators.push(label)
    }
  }
  kw(["invest", "return", "yield", "trading platform", "profit"], "INVESTMENT_FRAUD", 0.4, "Investment/returns language in complaint")
  kw(["task", "part-time", "commission", "prepaid", "telegram"], "TASK_SCAM", 0.4, "Task/part-time recruitment language")
  kw(["ransom", "encrypt", "decrypt", "extort", "locked our"], "RANSOMWARE", 0.5, "Extortion/ransomware language")
  kw(["bridge", "another network", "cross chain", "nft presale"], "CROSS_CHAIN_LAUNDERING", 0.3, "Cross-chain language")
  kw(["multiple", "same platform", "coordinated", "network"], "ORGANIZED_FRAUD", 0.3, "Multi-victim/coordinated language")
  kw(["phishing", "verification link", "drained", "within minutes"], "RAPID_CASHOUT", 0.4, "Phishing/drain language")
  kw(["romance", "relationship", "long-term", "girlfriend", "boyfriend"], "PIG_BUTCHERING", 0.4, "Relationship-grooming language")

  // Structural signals
  if (victims >= 5) {
    scores.ORGANIZED_FRAUD += 0.35
    indicators.push(`${victims} connected victims (network scale)`)
  }
  if (bridges > 0) {
    scores.CROSS_CHAIN_LAUNDERING += 0.4
    indicators.push("Bridge hop present (cross-chain movement)")
  }
  if (mixers > 0) {
    scores.RANSOMWARE += 0.2
    indicators.push("Mixing interaction (common in ransomware/laundering)")
  }
  if (span > 0 && span <= 6 && maxDepth <= 3) {
    scores.RAPID_CASHOUT += 0.4
    indicators.push(`Fast execution (~${span.toFixed(1)}h, shallow depth)`)
  }
  if (victims >= 3 && span > 24) {
    scores.INVESTMENT_FRAUD += 0.2
    indicators.push("Multiple deposits over an extended window (investment cadence)")
  }

  const ranked = (Object.keys(scores) as FraudTypology[])
    .map((t) => ({ typology: t, score: +scores[t].toFixed(2) }))
    .sort((a, b) => b.score - a.score)
  const top = ranked[0]
  const typology = top.score > 0.2 ? top.typology : "UNKNOWN"
  const total = ranked.reduce((s, r) => s + r.score, 0) || 1

  return {
    result: { typology, scores: ranked.filter((r) => r.score > 0), indicators },
    confidence: clamp(top.score / total + 0.2),
    explanation:
      "Fraudprint AI classifies the fraud typology by combining complaint-text keywords with structural graph signals (victim count, bridge/mixer presence, timing, depth).",
    evidence: indicators.length ? indicators : ["Limited distinctive signals; classification is tentative."],
    recommendation: `Proceed on the working hypothesis of ${typology.replace(/_/g, " ")}. Confirm with investigator judgment before formal classification.`,
    analysisType: "rule",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
