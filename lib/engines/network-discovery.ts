import type { IntelResult } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { nowIso, clamp } from "./context"

export interface FraudCluster {
  id: string
  size: number
  members: string[]
  sharedIntermediaries: string[]
  cohesion: number
}

export interface NetworkDiscoveryResult {
  clusters: FraudCluster[]
  connectedVictims: number
  sharedInfrastructure: string[]
}

// FRAUD NETWORK DISCOVERY: finds clusters and shared infrastructure that
// indicate a coordinated network rather than an isolated incident.
export function runNetworkDiscovery(ctx: AnalysisContext): IntelResult<NetworkDiscoveryResult> {
  const edges = ctx.graph.edges
  const nodes = ctx.graph.nodes

  // Shared intermediaries: non-victim, non-exchange nodes with high in-degree.
  const sharedInfrastructure = nodes
    .filter((n) => {
      const inDeg = edges.filter((e) => e.target === n.id).length
      return inDeg >= 3 && !["VICTIM", "EXCHANGE"].includes(n.kind)
    })
    .map((n) => n.id)

  const victims = nodes.filter((n) => n.kind === "VICTIM")
  const connectedVictims = victims.length

  // Build a single cluster around the reported wallet + its shared infra.
  const members = new Set<string>([ctx.rootAddress, ...sharedInfrastructure])
  for (const v of victims) members.add(v.id)

  const cohesion = clamp(
    (sharedInfrastructure.length * 0.15 + connectedVictims * 0.06),
    0,
    1,
  )

  const clusters: FraudCluster[] = [
    {
      id: `cluster_${ctx.rootAddress.slice(2, 8)}`,
      size: members.size,
      members: Array.from(members),
      sharedIntermediaries: sharedInfrastructure,
      cohesion: +cohesion.toFixed(2),
    },
  ]

  return {
    result: { clusters, connectedVictims, sharedInfrastructure },
    confidence: clamp(0.5 + sharedInfrastructure.length * 0.08),
    explanation:
      "Fraud Network Discovery groups wallets into clusters and surfaces shared intermediary infrastructure used across multiple victims — evidence of an organized operation rather than a one-off scam.",
    evidence: [
      `${connectedVictims} connected victim wallet(s) feed the same network.`,
      sharedInfrastructure.length
        ? `${sharedInfrastructure.length} shared intermediary hub(s) reused across flows.`
        : "No strongly shared intermediary infrastructure detected.",
      `Cluster cohesion ${(cohesion * 100).toFixed(0)}%.`,
    ],
    recommendation:
      cohesion >= 0.4
        ? "Treat as an organized network. Link related complaints and consider a consolidated case."
        : "Likely a single operation; keep monitoring for links to other complaints.",
    analysisType: "graph",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
