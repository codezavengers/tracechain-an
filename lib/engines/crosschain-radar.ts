import type { IntelResult, Chain } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { nowIso, clamp, usd } from "./context"

export interface BridgeHop {
  bridgeAddress: string
  fromChain: Chain
  toChain: Chain
  usdValue: number
  destinationAddress: string
  timestamp: string
}

export interface CrossChainResult {
  bridged: boolean
  hops: BridgeHop[]
  chainsInvolved: Chain[]
  relinkedValue: number
}

// CROSSCHAIN RADAR: detects bridge hops and re-links the flow on the
// destination chain so tracing continues across networks.
export function runCrossChainRadar(ctx: AnalysisContext): IntelResult<CrossChainResult> {
  const nodes = ctx.graph.nodes
  const edges = ctx.graph.edges
  const bridgeNodes = nodes.filter((n) => n.kind === "BRIDGE")
  const hops: BridgeHop[] = []
  const chainsInvolved = new Set<Chain>([ctx.chain])

  for (const bridge of bridgeNodes) {
    const inbound = edges.filter((e) => e.target === bridge.id)
    const outbound = edges.filter((e) => e.source === bridge.id)
    for (const out of outbound) {
      const dest = nodes.find((n) => n.id === out.target)
      const fromChain = inbound[0]
        ? (nodes.find((n) => n.id === inbound[0].source)?.chain ?? ctx.chain)
        : ctx.chain
      const toChain = dest?.chain ?? ctx.crossChain ?? ctx.chain
      chainsInvolved.add(fromChain)
      chainsInvolved.add(toChain)
      hops.push({
        bridgeAddress: bridge.id,
        fromChain,
        toChain,
        usdValue: out.usdValue,
        destinationAddress: out.target,
        timestamp: out.timestamp,
      })
    }
  }

  const relinkedValue = hops.reduce((s, h) => s + h.usdValue, 0)

  return {
    result: {
      bridged: hops.length > 0,
      hops,
      chainsInvolved: Array.from(chainsInvolved),
      relinkedValue: +relinkedValue.toFixed(2),
    },
    confidence: clamp(hops.length ? 0.7 : 0.6),
    explanation:
      "CrossChain Radar identifies bridge endpoints that move value between networks and re-links the trail on the destination chain, so cross-chain hops do not break the investigation.",
    evidence: hops.length
      ? hops.map((h) => `${h.fromChain} → ${h.toChain}: ${usd(h.usdValue)} via bridge ${h.bridgeAddress.slice(0, 10)}… → ${h.destinationAddress.slice(0, 10)}…`)
      : ["No cross-chain bridge activity detected in this trace."],
    recommendation: hops.length
      ? "Continue tracing on the destination chain(s). Note that bridges typically lack KYC — pursue the post-bridge endpoints."
      : "No cross-chain action required.",
    analysisType: "graph",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
