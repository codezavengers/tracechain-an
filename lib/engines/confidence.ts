import type { IntelResult, DataProvenance } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { nowIso, clamp } from "./context"

export interface ConfidenceResult {
  overall: number // 0..1
  dataQuality: number
  graphCompleteness: number
  attributionStrength: number
  provenanceMix: Record<DataProvenance, number>
}

// TRACE CONFIDENCE ENGINE: aggregates confidence across the investigation and
// is honest about what limits it (demo data, unattributed endpoints, depth).
export function runConfidence(
  ctx: AnalysisContext,
  signals: { attributionConfidence: number; hasExit: boolean; depthReached: number },
): IntelResult<ConfidenceResult> {
  const provenanceMix: Record<string, number> = {}
  for (const n of ctx.graph.nodes) {
    provenanceMix[n.provenance] = (provenanceMix[n.provenance] ?? 0) + 1
  }

  const dataQuality = ctx.provenance === "LIVE_BLOCKCHAIN_DATA" ? 0.85 : 0.6
  const graphCompleteness = clamp(0.4 + Math.min(0.4, signals.depthReached * 0.1) + (signals.hasExit ? 0.15 : 0))
  const attributionStrength = clamp(signals.attributionConfidence)
  const overall = clamp((dataQuality + graphCompleteness + attributionStrength) / 3)

  return {
    result: {
      overall: +overall.toFixed(2),
      dataQuality: +dataQuality.toFixed(2),
      graphCompleteness: +graphCompleteness.toFixed(2),
      attributionStrength: +attributionStrength.toFixed(2),
      provenanceMix: provenanceMix as Record<DataProvenance, number>,
    },
    confidence: overall,
    explanation:
      "The Trace Confidence Engine aggregates data quality, graph completeness, and attribution strength into an overall confidence figure, and reports the provenance mix so results are never over-trusted.",
    evidence: [
      `Data quality: ${(dataQuality * 100).toFixed(0)}% (${ctx.provenance === "LIVE_BLOCKCHAIN_DATA" ? "live feed" : "demo/simulated data"}).`,
      `Graph completeness: ${(graphCompleteness * 100).toFixed(0)}% (depth reached ${signals.depthReached}${signals.hasExit ? ", exit found" : ", no clear exit"}).`,
      `Attribution strength: ${(attributionStrength * 100).toFixed(0)}%.`,
    ],
    recommendation:
      ctx.provenance === "DEMO_DATA"
        ? "Results are derived from DEMO data and must not be treated as live intelligence."
        : "Confidence is acceptable for investigative direction; verify key attributions before enforcement.",
    analysisType: "statistical",
    provenance: ctx.provenance === "DEMO_DATA" ? "DEMO_DATA" : "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
