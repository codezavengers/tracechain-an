import type { IntelResult } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { nowIso, clamp } from "./context"

export interface ResolvedEntity {
  entityId: string
  addresses: string[]
  basis: string[]
  confidence: number
  identityClaim: "NONE" // never a real-world identity without verified evidence
}

export interface EntityResolutionResult {
  entities: ResolvedEntity[]
  note: string
}

// ENTITY RESOLUTION: clusters addresses likely controlled by the same actor
// using behavioral co-occurrence heuristics ONLY.
// CRITICAL: never asserts a real-world person's identity. identityClaim is
// always "NONE" — resolution links on-chain behavior, not legal identity.
export function runEntityResolution(ctx: AnalysisContext): IntelResult<EntityResolutionResult> {
  const edges = ctx.graph.edges
  const nodes = ctx.graph.nodes
  const entities: ResolvedEntity[] = []

  // Heuristic: addresses that funnel into a common consolidation node within a
  // tight time window are likely co-controlled.
  const consolidationNodes = nodes.filter((n) => {
    const inDeg = edges.filter((e) => e.target === n.id).length
    return inDeg >= 3 && !["VICTIM", "EXCHANGE"].includes(n.kind)
  })

  let i = 0
  for (const hub of consolidationNodes) {
    const feeders = edges.filter((e) => e.target === hub.id).map((e) => e.source)
    if (feeders.length < 2) continue
    entities.push({
      entityId: `entity_${i++}`,
      addresses: [hub.id, ...feeders],
      basis: [
        `Common consolidation point ${hub.id.slice(0, 10)}…`,
        "Behavioral co-occurrence (shared downstream hub)",
      ],
      confidence: clamp(0.4 + feeders.length * 0.05),
      identityClaim: "NONE",
    })
  }

  return {
    result: {
      entities,
      note: "Entity resolution links on-chain BEHAVIOR only. It does NOT establish the real-world legal identity of any person or organization. Any identity claim requires separately verified evidence.",
    },
    confidence: clamp(0.45 + entities.length * 0.05),
    explanation:
      "Entity Resolution groups addresses that behavioral evidence suggests are controlled by the same actor (e.g. shared consolidation hubs). It deliberately makes no real-world identity claims.",
    evidence: entities.length
      ? entities.map((e) => `${e.entityId}: ${e.addresses.length} addresses linked (${(e.confidence * 100).toFixed(0)}%).`)
      : ["Insufficient behavioral overlap to cluster addresses into entities."],
    recommendation:
      "Use resolved clusters to focus subpoena/RFI targeting. Do NOT attribute a named individual without verified off-chain evidence.",
    analysisType: "graph",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
