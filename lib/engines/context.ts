import type { Chain, GraphNode, GraphEdge, Transaction, TransactionGraph, DataProvenance } from "@/lib/types"
import { DirectedGraph, buildGraph } from "@/lib/graph/graph"

// Everything the engines need to reason about a case, computed once.
export interface AnalysisContext {
  chain: Chain
  rootAddress: string
  reportedLossUsd: number
  graph: TransactionGraph
  dg: DirectedGraph
  transactions: Transaction[]
  provenance: DataProvenance
  crossChain?: Chain
}

export function buildContext(input: {
  chain: Chain
  rootAddress: string
  reportedLossUsd: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  transactions: Transaction[]
  depth: number
  provenance: DataProvenance
  crossChain?: Chain
}): AnalysisContext {
  const graph: TransactionGraph = {
    rootAddress: input.rootAddress,
    chain: input.chain,
    depth: input.depth,
    nodes: input.nodes,
    edges: input.edges,
    provenance: input.provenance,
  }
  return {
    chain: input.chain,
    rootAddress: input.rootAddress,
    reportedLossUsd: input.reportedLossUsd,
    graph,
    dg: buildGraph(input.nodes, input.edges),
    transactions: input.transactions,
    provenance: input.provenance,
    crossChain: input.crossChain,
  }
}

export function nowIso() {
  return new Date().toISOString()
}

export function clamp(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n))
}

export function usd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}
