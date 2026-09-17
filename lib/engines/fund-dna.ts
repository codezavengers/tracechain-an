import type { IntelResult } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { nowIso, clamp, usd } from "./context"

export interface FlowTrace {
  path: string[]
  kinds: string[]
  proportion: number // fraction of root funds this path represents
  usdValue: number
  endsAt: string
  endKind: string
}

export interface FundDnaResult {
  method: "PROPORTIONAL_HAircut" | "PROPORTIONAL_FLOW"
  traces: FlowTrace[]
  tracedUsd: number
  dispersedUsd: number
  note: string
}

// FUND DNA: proportional flow estimation.
// IMPORTANT: cryptocurrency is fungible. We do NOT claim to identify individual
// coins one-to-one. We estimate the PROPORTION of the reported funds that
// flowed along each path using a proportional (haircut) allocation model.
export function runFundDna(ctx: AnalysisContext): IntelResult<FundDnaResult> {
  const paths = ctx.dg.tracePaths(ctx.rootAddress, ctx.graph.depth + 3)
  const rootOut = ctx.graph.edges
    .filter((e) => e.source === ctx.rootAddress)
    .reduce((s, e) => s + e.usdValue, 0)

  const nodeMap = new Map(ctx.graph.nodes.map((n) => [n.id, n]))
  const traces: FlowTrace[] = []

  for (const path of paths) {
    if (!path.length) continue
    // Proportional allocation: at each split, funds divide by relative edge value.
    let proportion = 1
    let cursor = ctx.rootAddress
    for (const edge of path) {
      const siblings = ctx.graph.edges.filter((e) => e.source === cursor)
      const sibTotal = siblings.reduce((s, e) => s + e.usdValue, 0) || 1
      proportion *= edge.usdValue / sibTotal
      cursor = edge.target
    }
    const last = path[path.length - 1]
    const endNode = nodeMap.get(last.target)
    traces.push({
      path: [ctx.rootAddress, ...path.map((e) => e.target)],
      kinds: [nodeMap.get(ctx.rootAddress)?.kind ?? "UNKNOWN", ...path.map((e) => nodeMap.get(e.target)?.kind ?? "UNKNOWN")],
      proportion,
      usdValue: +(ctx.reportedLossUsd * proportion).toFixed(2),
      endsAt: last.target,
      endKind: endNode?.kind ?? "UNKNOWN",
    })
  }

  traces.sort((a, b) => b.usdValue - a.usdValue)
  const top = traces.slice(0, 12)
  const tracedUsd = traces
    .filter((t) => ["EXCHANGE", "VASP", "BRIDGE"].includes(t.endKind))
    .reduce((s, t) => s + t.usdValue, 0)
  const dispersedUsd = Math.max(0, ctx.reportedLossUsd - tracedUsd)

  return {
    result: {
      method: "PROPORTIONAL_FLOW",
      traces: top,
      tracedUsd: +tracedUsd.toFixed(2),
      dispersedUsd: +dispersedUsd.toFixed(2),
      note: "Fungibility caveat applied: values are proportional estimates, not coin-level identification.",
    },
    confidence: clamp(0.55 + (rootOut > 0 ? 0.1 : 0)),
    explanation:
      "Fund DNA models how the reported funds proportionally dispersed through the network using a haircut (proportional-flow) allocation. Because cryptocurrency is fungible, this does NOT identify specific coins one-to-one — it estimates what share of the victim's funds most likely traversed each path.",
    evidence: top
      .slice(0, 6)
      .map((t) => `${(t.proportion * 100).toFixed(1)}% (~${usd(t.usdValue)}) → ends at ${t.endKind} ${t.endsAt.slice(0, 10)}…`),
    recommendation:
      "Focus recovery effort on the highest-proportion paths that terminate at exchange/VASP endpoints. Document the proportional method in the case file.",
    analysisType: "heuristic",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
