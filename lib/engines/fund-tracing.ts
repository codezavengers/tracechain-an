import type { AttributionCategory, Chain, DataProvenance, Transaction, VaspRecord } from "@/lib/types"
import type { AnalysisContext } from "./context"
import type { ExitPoint } from "./exitpoint"
import { blockchain } from "@/lib/blockchain/service"
import { isDemoSource } from "@/lib/blockchain/data-source"

// ---------------------------------------------------------------------------
// Multi-hop fund tracing.
//
// Given a target wallet's already-fetched transactions, walks outward through
// counterparties up to a bounded number of hops, producing a directed graph of
// wallets and transfers plus a set of representative flow paths. This is
// intentionally separate from the wallet-investigation and case-investigation
// engines: it does not re-fetch or duplicate a single wallet's balance/
// metadata lookup, it only chains transaction lookups across hops.
//
// Safety is the point of this engine, not a detail: every loop below is
// bounded by an explicit limit so a single trace request can never turn into
// an unbounded number of upstream provider calls or an unbounded response
// payload.
// ---------------------------------------------------------------------------

export type TraceNodeType = "TARGET" | "COUNTERPARTY" | "INTERMEDIATE" | "VASP"

export interface TraceNode {
  id: string
  chain: Chain
  type: TraceNodeType
  hop: number
  attribution?: AttributionCategory
  vasp?: VaspRecord | null
  provenance: DataProvenance
}

export interface TraceEdge {
  id: string
  from: string
  to: string
  txHash: string
  amount: number
  asset: string
  usdValue: number | null
  timestamp: string | null
  direction: "outbound" | "inbound"
  hop: number
  provenance: DataProvenance
}

export interface TracePath {
  addresses: string[]
  edgeIds: string[]
  endType: TraceNodeType
}

export interface TraceGraph {
  targetWallet: string
  chain: Chain
  maxHops: number
  hopsReached: number
  nodes: TraceNode[]
  edges: TraceEdge[]
  paths: TracePath[]
  summary: string
  truncated: boolean
  truncationReasons: string[]
  provenance: DataProvenance
  generatedAt: string
}

export interface FundTracingSafetyLimits {
  /** Hard cap on the total number of nodes (wallets) the graph can contain. */
  maxNodes: number
  /** Per-address cap on how many of that address's transactions are processed. */
  maxTransactionsPerAddress: number
  /** Cap on the total number of transactions processed across every hop. */
  maxTotalTransactions: number
  /** Cap on how many counterparties are expanded to the next hop, per hop. */
  maxAddressesPerHop: number
  /** Wall-clock budget for the whole trace, including hop-fetch calls. */
  timeoutMs: number
}

export const DEFAULT_SAFETY_LIMITS: FundTracingSafetyLimits = {
  maxNodes: 40,
  maxTransactionsPerAddress: 50,
  maxTotalTransactions: 300,
  maxAddressesPerHop: 8,
  timeoutMs: 15000,
}

export const DEFAULT_MAX_HOPS = 2
export const ABSOLUTE_MAX_HOPS = 3
const MAX_PATHS = 25

export interface HopFetchResult {
  transactions: Transaction[]
  provenance: DataProvenance
}

/** Fetches the next hop's transactions for one counterparty address. */
export type HopFetcher = (address: string, chain: Chain) => Promise<HopFetchResult>

export type AttributionLookup = (
  address: string,
) => { vasp: VaspRecord | null; category: AttributionCategory } | null

export interface FundTracingInput {
  targetWallet: string
  chain: Chain
  /** Already-fetched transactions for the target wallet (hop 0 -> hop 1 seed). */
  transactions: Transaction[]
  /** Provenance of the seed transactions. */
  provenance: DataProvenance
  /** Requested hop depth. Clamped to [1, ABSOLUTE_MAX_HOPS]. Default 2. */
  maxHops?: number
  /** Fetches transactions for a counterparty so hop 2/3 can be walked. Omit to stop expansion after hop 1. */
  fetchNextHop?: HopFetcher
  /** Optional known-VASP / attribution lookup. Never invented — return null when unknown. */
  attributionFor?: AttributionLookup
  limits?: Partial<FundTracingSafetyLimits>
}

interface FrontierEntry {
  address: string
  transactions: Transaction[]
}

function counterpartyOf(
  tx: Transaction,
  address: string,
): { address: string; direction: "outbound" | "inbound" } | null {
  const addr = address.toLowerCase()
  const from = tx.from?.toLowerCase()
  const to = tx.to?.toLowerCase()
  if (from === addr && to && to !== addr) return { address: tx.to, direction: "outbound" }
  if (to === addr && from && from !== addr) return { address: tx.from, direction: "inbound" }
  return null
}

export class FundTracingEngine {
  private readonly limits: FundTracingSafetyLimits

  constructor(limits?: Partial<FundTracingSafetyLimits>) {
    this.limits = { ...DEFAULT_SAFETY_LIMITS, ...limits }
  }

  async trace(input: FundTracingInput): Promise<TraceGraph> {
    const startedAt = Date.now()
    const { targetWallet, chain, limits } = { ...input, limits: this.limits }
    const maxHops = Math.min(ABSOLUTE_MAX_HOPS, Math.max(1, Math.round(input.maxHops ?? DEFAULT_MAX_HOPS)))

    const nodes = new Map<string, TraceNode>()
    const edgesById = new Map<string, TraceEdge>()
    const seenTxEdgeKeys = new Set<string>() // duplicate-transaction prevention
    const visited = new Set<string>([targetWallet]) // loop prevention: never re-expand an already-walked wallet
    const truncationReasons: string[] = []
    let truncated = false
    let totalTxProcessed = 0
    let demoDataSeen = input.provenance === "DEMO_DATA"
    let hopsReached = 0

    const note = (reason: string) => {
      truncated = true
      if (!truncationReasons.includes(reason)) truncationReasons.push(reason)
    }

    const attributionOf = (address: string) => input.attributionFor?.(address) ?? null

    const targetAttribution = attributionOf(targetWallet)
    nodes.set(targetWallet, {
      id: targetWallet,
      chain,
      type: "TARGET",
      hop: 0,
      attribution: targetAttribution?.category,
      vasp: targetAttribution?.vasp ?? null,
      provenance: input.provenance,
    })

    let frontier: FrontierEntry[] = [{ address: targetWallet, transactions: input.transactions }]

    hopLoop: for (let hop = 1; hop <= maxHops; hop++) {
      if (Date.now() - startedAt > limits.timeoutMs) {
        note("Trace timed out before completing all requested hops.")
        break hopLoop
      }
      if (nodes.size >= limits.maxNodes) {
        note("Node limit reached before completing all requested hops.")
        break hopLoop
      }

      // usdSum drives which counterparties are prioritized for expansion when
      // there are more of them than maxAddressesPerHop allows.
      const candidates = new Map<string, number>()

      addressLoop: for (const { address, transactions } of frontier) {
        const capped = transactions.slice(0, limits.maxTransactionsPerAddress)
        if (transactions.length > limits.maxTransactionsPerAddress) {
          note("Per-address transaction cap reached; some transactions were not processed.")
        }

        for (const tx of capped) {
          totalTxProcessed++
          if (totalTxProcessed > limits.maxTotalTransactions) {
            note("Overall transaction cap reached; remaining transactions were not processed.")
            break addressLoop
          }

          const cp = counterpartyOf(tx, address)
          if (!cp) continue
          const edgeKey = `${tx.hash}:${tx.from}:${tx.to}`
          if (seenTxEdgeKeys.has(edgeKey)) continue // duplicate-transaction prevention
          seenTxEdgeKeys.add(edgeKey)

          const edgeProvenance: DataProvenance =
            (tx as Transaction & { provenance?: DataProvenance }).provenance ?? input.provenance
          if (edgeProvenance === "DEMO_DATA") demoDataSeen = true

          const edgeId = `e_${hop}_${edgesById.size}`
          edgesById.set(edgeId, {
            id: edgeId,
            from: tx.from,
            to: tx.to,
            txHash: tx.hash,
            amount: tx.amount,
            asset: tx.asset,
            usdValue: tx.usdValue,
            timestamp: tx.timestamp,
            direction: cp.direction,
            hop,
            provenance: edgeProvenance,
          })

          if (!nodes.has(cp.address)) {
            if (nodes.size >= limits.maxNodes) {
              note("Node limit reached; some counterparties are not shown.")
            } else {
              const attribution = attributionOf(cp.address)
              const type: TraceNodeType = attribution?.vasp
                ? "VASP"
                : hop === 1
                  ? "COUNTERPARTY"
                  : "INTERMEDIATE"
              nodes.set(cp.address, {
                id: cp.address,
                chain,
                type,
                hop,
                attribution: attribution?.category,
                vasp: attribution?.vasp ?? null,
                provenance: input.provenance,
              })
            }
          }

          candidates.set(cp.address, (candidates.get(cp.address) ?? 0) + (tx.usdValue ?? 0))
        }
      }

      hopsReached = hop
      if (hop >= maxHops) break hopLoop // don't fetch beyond the requested depth

      const ranked = Array.from(candidates.entries())
        .filter(([addr]) => !visited.has(addr)) // loop prevention
        .sort((a, b) => b[1] - a[1])

      if (ranked.length > limits.maxAddressesPerHop) {
        note(`Only the ${limits.maxAddressesPerHop} highest-value counterparties per hop are expanded further.`)
      }
      const toExpand = ranked.slice(0, limits.maxAddressesPerHop)
      toExpand.forEach(([addr]) => visited.add(addr))

      if (!input.fetchNextHop) {
        if (ranked.length > 0) note("No transaction fetcher was supplied beyond hop 1; trace stopped early.")
        break hopLoop
      }
      if (toExpand.length === 0) break hopLoop

      const nextFrontier: FrontierEntry[] = []
      for (const [address] of toExpand) {
        if (Date.now() - startedAt > limits.timeoutMs) {
          note("Trace timed out while expanding counterparties.")
          break
        }
        try {
          const res = await input.fetchNextHop(address, chain)
          if (res.provenance === "DEMO_DATA") demoDataSeen = true
          nextFrontier.push({ address, transactions: res.transactions })
        } catch {
          note("Failed to retrieve transaction history for one counterparty; that branch was not expanded.")
        }
      }
      frontier = nextFrontier
    }

    const edges = Array.from(edgesById.values())
    const nodeTypeById = new Map(Array.from(nodes.values()).map((n) => [n.id, n.type]))
    const { paths, pathsTruncated } = buildPaths(targetWallet, edges, maxHops, nodeTypeById)
    if (pathsTruncated) note("Path count exceeded the display limit; only representative paths are shown.")

    const provenance: DataProvenance = demoDataSeen ? "DEMO_DATA" : "LIVE_BLOCKCHAIN_DATA"
    const vaspCount = Array.from(nodes.values()).filter((n) => n.type === "VASP").length

    return {
      targetWallet,
      chain,
      maxHops,
      hopsReached,
      nodes: Array.from(nodes.values()),
      edges,
      paths,
      summary: buildSummary({
        nodeCount: nodes.size,
        edgeCount: edges.length,
        hopsReached,
        maxHops,
        truncated,
        demo: demoDataSeen,
        vaspCount,
      }),
      truncated,
      truncationReasons,
      provenance,
      generatedAt: new Date().toISOString(),
    }
  }
}

// Depth-first walk of outward fund movement (edge.from -> edge.to) starting
// at the target wallet. Each path is a simple path (no repeated address)
// bounded by maxDepth hops, capped at MAX_PATHS total.
function buildPaths(
  root: string,
  edges: TraceEdge[],
  maxDepth: number,
  nodeTypeById: Map<string, TraceNodeType>,
): { paths: TracePath[]; pathsTruncated: boolean } {
  const outgoing = new Map<string, TraceEdge[]>()
  for (const e of edges) {
    const list = outgoing.get(e.from) ?? []
    list.push(e)
    outgoing.set(e.from, list)
  }

  const paths: TracePath[] = []
  let pathsTruncated = false

  function dfs(address: string, addressPath: string[], edgePath: string[]) {
    if (paths.length >= MAX_PATHS) {
      pathsTruncated = true
      return
    }
    const outEdges = outgoing.get(address) ?? []
    const isLeaf = outEdges.length === 0 || addressPath.length > maxDepth
    if (isLeaf && edgePath.length > 0) {
      paths.push({
        addresses: [...addressPath],
        edgeIds: [...edgePath],
        endType: nodeTypeById.get(address) ?? "INTERMEDIATE",
      })
      return
    }
    for (const e of outEdges) {
      if (paths.length >= MAX_PATHS) {
        pathsTruncated = true
        return
      }
      if (addressPath.includes(e.to)) continue // never revisit a node within one path (cycle guard)
      dfs(e.to, [...addressPath, e.to], [...edgePath, e.id])
    }
  }

  dfs(root, [root], [])
  return { paths, pathsTruncated }
}

function buildSummary(stats: {
  nodeCount: number
  edgeCount: number
  hopsReached: number
  maxHops: number
  truncated: boolean
  demo: boolean
  vaspCount: number
}): string {
  const parts: string[] = []
  parts.push(
    `Traced ${stats.hopsReached} of ${stats.maxHops} requested hop${stats.maxHops === 1 ? "" : "s"}, surfacing ${stats.nodeCount} wallet${stats.nodeCount === 1 ? "" : "s"} and ${stats.edgeCount} transfer${stats.edgeCount === 1 ? "" : "s"}.`,
  )
  if (stats.vaspCount > 0) {
    parts.push(`${stats.vaspCount} node${stats.vaspCount === 1 ? "" : "s"} matched a known VASP.`)
  }
  if (stats.truncated) {
    parts.push("Results were truncated by safety limits — this is a partial trace, not the full fund flow.")
  }
  parts.push(stats.demo ? "Built from demo data." : "Built from live blockchain data.")
  return parts.join(" ")
}

export function traceFunds(input: FundTracingInput): Promise<TraceGraph> {
  return new FundTracingEngine(input.limits).trace(input)
}

function transactionsTouching(all: Transaction[], address: string): Transaction[] {
  const addr = address.toLowerCase()
  return all.filter((t) => t.from?.toLowerCase() === addr || t.to?.toLowerCase() === addr)
}

// ---------------------------------------------------------------------------
// Case-investigation integration.
//
// Runs the same FundTracingEngine against an already-built case
// AnalysisContext. Two next-hop strategies, chosen per case:
//
//   - DEMO scenarios: context-only lookup. A demo scenario's full multi-hop
//     graph is already baked into ctx.transactions by design, so no
//     additional fetching is possible or honest — issuing live provider
//     calls for a demo wallet would risk mixing real chain data into a
//     deterministic scenario.
//   - LIVE cases: real next-hop fetching through the SAME production
//     provider layer (`@/lib/blockchain/service`) the wallet-investigation
//     route and case-creation flow already use — never a second blockchain
//     client, and still bounded by that service's own pagination caps plus
//     FundTracingEngine's own node/address/timeout limits. If a counterparty
//     lookup fails, is unconfigured, or itself falls back to demo data, this
//     degrades to the context-only pool for that branch rather than
//     fabricating data or mislabeling it as live.
//
// Either way, when a counterparty's activity is not available, tracing
// gracefully stops on that branch — the engine's existing truncation
// reporting surfaces this honestly.
// ---------------------------------------------------------------------------
export async function traceFundsFromContext(
  ctx: AnalysisContext,
  options?: { maxHops?: number; exitPoints?: ExitPoint[] },
): Promise<TraceGraph> {
  const seed = transactionsTouching(ctx.transactions, ctx.rootAddress)
  const exitByAddress = new Map((options?.exitPoints ?? []).map((e) => [e.address.toLowerCase(), e.attribution]))
  const nodeByAddress = new Map(ctx.graph.nodes.map((n) => [n.id.toLowerCase(), n]))

  const attributionFor: AttributionLookup = (address) => {
    const exit = exitByAddress.get(address.toLowerCase())
    if (exit) return { category: exit.category, vasp: exit.vasp ?? null }
    const node = nodeByAddress.get(address.toLowerCase())
    if (node?.attribution) return { category: node.attribution, vasp: null }
    return null
  }

  const canFetchLive = ctx.provenance === "LIVE_BLOCKCHAIN_DATA"

  const fetchNextHop: HopFetcher = async (address, chain) => {
    const contextual = transactionsTouching(ctx.transactions, address)
    if (!canFetchLive) return { transactions: contextual, provenance: ctx.provenance }
    try {
      const res = await blockchain.getTransactions(address, chain)
      if (isDemoSource(res.dataSource)) {
        // The provider fell back to demo data for this specific counterparty
        // (e.g. an unconfigured chain edge case). Never relabel that as
        // live — prefer whatever this case's own real transaction pool
        // already knows about the address instead.
        return { transactions: contextual, provenance: ctx.provenance }
      }
      return { transactions: res.data, provenance: "LIVE_BLOCKCHAIN_DATA" }
    } catch {
      // Provider failure: fall back to the context-only pool for this
      // branch rather than aborting the whole trace or inventing data.
      return { transactions: contextual, provenance: ctx.provenance }
    }
  }

  const engine = new FundTracingEngine()
  return engine.trace({
    targetWallet: ctx.rootAddress,
    chain: ctx.chain,
    transactions: seed,
    provenance: ctx.provenance,
    maxHops: options?.maxHops ?? DEFAULT_MAX_HOPS,
    attributionFor,
    fetchNextHop,
  })
}
