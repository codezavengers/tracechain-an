import type {
  Chain,
  FraudTypology,
  GraphNode,
  GraphEdge,
  Transaction,
  WalletKind,
  WalletMetadata,
} from "@/lib/types"
import { CHAIN_ASSET } from "@/lib/blockchain/provider"

// Deterministic seeded PRNG (mulberry32) so demo graphs are stable across runs.
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const HEX = "0123456789abcdef"
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

function makeAddress(chain: Chain, rnd: () => number): string {
  if (chain === "bitcoin") {
    let s = "bc1q"
    for (let i = 0; i < 38; i++) s += "023456789acdefghjklmnpqrstuvwxyz"[Math.floor(rnd() * 32)]
    return s
  }
  if (chain === "tron") {
    let s = "T"
    for (let i = 0; i < 33; i++) s += B58[Math.floor(rnd() * B58.length)]
    return s
  }
  let s = "0x"
  for (let i = 0; i < 40; i++) s += HEX[Math.floor(rnd() * 16)]
  return s
}

function makeTxHash(chain: Chain, rnd: () => number): string {
  const len = chain === "bitcoin" ? 64 : 64
  let s = chain === "bitcoin" ? "" : "0x"
  for (let i = 0; i < len; i++) s += HEX[Math.floor(rnd() * 16)]
  return s
}

export interface DemoScenario {
  id: string
  typology: FraudTypology
  name: string
  chain: Chain
  crossChain?: Chain
  complaintRef: string
  complaintText: string
  reportedWallet: string
  reportedLossUsd: number
  connectedVictims: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  transactions: Transaction[]
  metadata: Record<string, WalletMetadata>
  narrative: string
}

const PRICE: Record<string, number> = {
  BTC: 64000,
  ETH: 3200,
  MATIC: 0.72,
  BNB: 590,
  TRX: 0.12,
  USDT: 1,
}

interface ScenarioSpec {
  id: string
  typology: FraudTypology
  name: string
  chain: Chain
  crossChain?: Chain
  complaintRef: string
  complaintText: string
  reportedLossUsd: number
  connectedVictims: number
  layers: number
  fanOut: number
  burnerRatio: number
  useMixer: boolean
  narrative: string
}

const SPECS: ScenarioSpec[] = [
  {
    id: "demo_investment",
    typology: "INVESTMENT_FRAUD",
    name: "High-Yield Investment Fraud",
    chain: "ethereum",
    complaintRef: "NCRP/2026/IN/000481",
    complaintText:
      "Victim was promised 40% monthly returns via a trading platform 'AlphaYieldFX'. Transferred funds to wallet 0x{ROOT} in three tranches over two weeks. Platform stopped responding and withdrawals were blocked.",
    reportedLossUsd: 92000,
    connectedVictims: 7,
    layers: 4,
    fanOut: 3,
    burnerRatio: 0.35,
    useMixer: false,
    narrative:
      "Classic investment-fraud aggregation: multiple victim deposits funnel into a collector wallet, then split across intermediaries before consolidating at an exchange deposit endpoint.",
  },
  {
    id: "demo_task",
    typology: "TASK_SCAM",
    name: "Online Task / Part-Time Job Scam",
    chain: "tron",
    complaintRef: "NCRP/2026/IN/000512",
    complaintText:
      "Victim recruited via Telegram for 'prepaid task' work. Asked to deposit USDT-TRC20 to T{ROOT} to 'unlock' commissions. After multiple deposits, account was frozen.",
    reportedLossUsd: 14500,
    connectedVictims: 23,
    layers: 3,
    fanOut: 4,
    burnerRatio: 0.5,
    useMixer: false,
    narrative:
      "Task-scam rings use many small victim deposits and rapid burner hops on low-fee chains (TRON/USDT) to move funds toward cash-out points.",
  },
  {
    id: "demo_ransomware",
    typology: "RANSOMWARE",
    name: "Ransomware Extortion Payment",
    chain: "bitcoin",
    complaintRef: "NCRP/2026/IN/000538",
    complaintText:
      "Organization's servers were encrypted. Attackers demanded Bitcoin to wallet bc1q{ROOT}. Payment was made to restore operations.",
    reportedLossUsd: 210000,
    connectedVictims: 3,
    layers: 5,
    fanOut: 2,
    burnerRatio: 0.4,
    useMixer: true,
    narrative:
      "Ransomware flows show peel-chain layering and a mixing hop before consolidation, a strong laundering signal that lowers recovery probability.",
  },
  {
    id: "demo_crosschain",
    typology: "CROSS_CHAIN_LAUNDERING",
    name: "Cross-Chain Laundering Operation",
    chain: "ethereum",
    crossChain: "bsc",
    complaintRef: "NCRP/2026/IN/000560",
    complaintText:
      "Funds sent to 0x{ROOT} for a fake NFT presale. Tokens were bridged to another network to obscure the trail before reaching an exchange.",
    reportedLossUsd: 158000,
    connectedVictims: 11,
    layers: 4,
    fanOut: 3,
    burnerRatio: 0.3,
    useMixer: false,
    narrative:
      "Cross-chain laundering uses a bridge endpoint to break same-chain tracing; the CrossChain Radar re-links the flow on the destination network.",
  },
  {
    id: "demo_organized",
    typology: "ORGANIZED_FRAUD",
    name: "Organized Multi-Victim Fraud Network",
    chain: "ethereum",
    complaintRef: "NCRP/2026/IN/000577",
    complaintText:
      "Multiple complainants report the same platform 'QuantumTrade'. Deposits to 0x{ROOT} and related wallets. Suspected coordinated network.",
    reportedLossUsd: 480000,
    connectedVictims: 34,
    layers: 4,
    fanOut: 5,
    burnerRatio: 0.25,
    useMixer: true,
    narrative:
      "Organized networks show dense clustering, shared intermediaries across victims, and multiple exchange endpoints — surfaced by Fraud Network Discovery.",
  },
  {
    id: "demo_rapid",
    typology: "RAPID_CASHOUT",
    name: "Rapid Cash-Out Attack",
    chain: "bsc",
    complaintRef: "NCRP/2026/IN/000599",
    complaintText:
      "Wallet drained after a phishing 'wallet verification' link. Funds moved from 0x{ROOT} to an exchange within minutes.",
    reportedLossUsd: 36000,
    connectedVictims: 1,
    layers: 2,
    fanOut: 2,
    burnerRatio: 0.2,
    useMixer: false,
    narrative:
      "Rapid cash-out leaves a short, fast trail. Speed is the key signal: little layering but a very tight time window before exchange deposit — high urgency, still recoverable if VASP acts fast.",
  },
]

function buildScenario(spec: ScenarioSpec): DemoScenario {
  const rnd = mulberry32(hashSeed(spec.id))
  const chain = spec.chain
  const asset = CHAIN_ASSET[chain]
  const stable = chain === "tron" || chain === "bsc" ? "USDT" : asset
  const price = PRICE[stable] ?? 1

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const transactions: Transaction[] = []
  const metadata: Record<string, WalletMetadata> = {}

  const baseTime = new Date("2026-08-15T09:00:00Z").getTime()
  let clock = baseTime

  const addNode = (kind: WalletKind, depth: number, nodeChain: Chain, label?: string): GraphNode => {
    const address = makeAddress(nodeChain, rnd)
    const node: GraphNode = {
      id: address,
      kind,
      chain: nodeChain,
      label,
      depth,
      provenance: "DEMO_DATA",
      attribution: kind === "EXCHANGE" || kind === "VASP" ? "PROBABLE" : "UNKNOWN",
    }
    nodes.push(node)
    return node
  }

  const totalUsd = spec.reportedLossUsd
  const rootAddress = makeAddress(chain, rnd)
  const root: GraphNode = {
    id: rootAddress,
    kind: "SUSPICIOUS",
    chain,
    label: "Reported fraud wallet",
    depth: 0,
    provenance: "DEMO_DATA",
    attribution: "UNKNOWN",
    usdValue: totalUsd,
  }
  nodes.push(root)

  // Victim deposit nodes -> root (fan-in)
  const victimCount = Math.min(spec.connectedVictims, 6) + 1
  let remaining = totalUsd
  for (let v = 0; v < victimCount; v++) {
    const victim = addNode("VICTIM", -1, chain, v === 0 ? "Primary complainant" : `Connected victim #${v}`)
    const portion = v === victimCount - 1 ? remaining : Math.round((totalUsd / victimCount) * (0.7 + rnd() * 0.6))
    remaining = Math.max(0, remaining - portion)
    clock += 1000 * 60 * (30 + Math.floor(rnd() * 240))
    const amount = +(portion / price).toFixed(6)
    const hash = makeTxHash(chain, rnd)
    const ts = new Date(clock).toISOString()
    edges.push({
      id: `e_${edges.length}`,
      source: victim.id,
      target: rootAddress,
      kind: "SENT_FUNDS",
      amount,
      asset: stable,
      usdValue: portion,
      timestamp: ts,
      txHash: hash,
    })
    transactions.push({
      hash,
      chain,
      from: victim.id,
      to: rootAddress,
      amount,
      asset: stable,
      usdValue: portion,
      timestamp: ts,
      blockHeight: 19_000_000 + Math.floor(rnd() * 500000),
      provenance: "DEMO_DATA",
    })
  }

  // Layered movement from root outward
  let frontier: GraphNode[] = [root]
  for (let layer = 1; layer <= spec.layers; layer++) {
    const nextFrontier: GraphNode[] = []
    for (const parent of frontier) {
      const parentUsd = parent.usdValue ?? totalUsd / frontier.length
      const branches = Math.max(1, Math.round(spec.fanOut * (0.6 + rnd() * 0.8)))
      const isLast = layer === spec.layers
      for (let b = 0; b < branches; b++) {
        let kind: WalletKind = "SUSPICIOUS"
        let nodeChain = chain
        let edgeKind: GraphEdge["kind"] = "SENT_FUNDS"
        let label: string | undefined

        if (rnd() < spec.burnerRatio && !isLast) {
          kind = "BURNER"
          label = "Burner wallet (single-use)"
        }
        if (spec.useMixer && layer === Math.ceil(spec.layers / 2) && b === 0) {
          kind = "MIXER"
          label = "Mixing service endpoint"
          edgeKind = "INTERACTED"
        }
        if (spec.crossChain && layer === 2 && b === 0) {
          kind = "BRIDGE"
          label = "Cross-chain bridge"
          edgeKind = "BRIDGED"
        }
        if (isLast && rnd() < 0.6) {
          kind = "EXCHANGE"
          label = "Exchange deposit endpoint"
          edgeKind = "DEPOSITED"
        }

        // Bridge child continues on the destination chain
        if (parent.kind === "BRIDGE" && spec.crossChain) {
          nodeChain = spec.crossChain
        }

        const child = addNode(kind, layer, nodeChain, label)
        const share = parentUsd / branches
        const feeLoss = 0.94 + rnd() * 0.05 // laundering fees / peel
        const childUsd = +(share * feeLoss).toFixed(2)
        child.usdValue = childUsd

        clock += 1000 * 60 * (5 + Math.floor(rnd() * 120))
        const ts = new Date(clock).toISOString()
        const eAsset = nodeChain === parent.chain ? stable : CHAIN_ASSET[nodeChain]
        const eprice = PRICE[eAsset] ?? 1
        const amount = +(childUsd / eprice).toFixed(6)
        const hash = makeTxHash(nodeChain, rnd)
        edges.push({
          id: `e_${edges.length}`,
          source: parent.id,
          target: child.id,
          kind: edgeKind,
          amount,
          asset: eAsset,
          usdValue: childUsd,
          timestamp: ts,
          txHash: hash,
        })
        transactions.push({
          hash,
          chain: nodeChain,
          from: parent.id,
          to: child.id,
          amount,
          asset: eAsset,
          usdValue: childUsd,
          timestamp: ts,
          blockHeight: 19_000_000 + Math.floor(rnd() * 500000),
          provenance: "DEMO_DATA",
        })
        if (kind !== "EXCHANGE" && kind !== "MIXER") nextFrontier.push(child)
      }
    }
    frontier = nextFrontier.length ? nextFrontier : frontier
    if (nodes.length >= 48) break
  }

  // Build metadata for each node
  for (const n of nodes) {
    const nAsset = n.chain === "tron" || n.chain === "bsc" ? "USDT" : CHAIN_ASSET[n.chain]
    const nprice = PRICE[nAsset] ?? 1
    const usd = n.usdValue ?? 0
    metadata[n.id] = {
      address: n.id,
      chain: n.chain,
      kind: n.kind,
      label: n.label,
      balance: n.kind === "EXCHANGE" || n.kind === "BURNER" ? 0 : +(usd / nprice).toFixed(6),
      asset: nAsset,
      usdBalance: n.kind === "EXCHANGE" || n.kind === "BURNER" ? 0 : usd,
      firstSeen: new Date(baseTime).toISOString(),
      lastSeen: new Date(clock).toISOString(),
      txCount: edges.filter((e) => e.source === n.id || e.target === n.id).length,
      provenance: "DEMO_DATA",
    }
  }

  return {
    id: spec.id,
    typology: spec.typology,
    name: spec.name,
    chain: spec.chain,
    crossChain: spec.crossChain,
    complaintRef: spec.complaintRef,
    complaintText: spec.complaintText.replace("{ROOT}", rootAddress.replace(/^(0x|bc1q|T)/, "")),
    reportedWallet: rootAddress,
    reportedLossUsd: spec.reportedLossUsd,
    connectedVictims: spec.connectedVictims,
    nodes,
    edges,
    transactions,
    metadata,
    narrative: spec.narrative,
  }
}

let CACHE: DemoScenario[] | null = null

export function getDemoScenarios(): DemoScenario[] {
  if (!CACHE) CACHE = SPECS.map(buildScenario)
  return CACHE
}

export function getDemoScenario(id: string): DemoScenario | undefined {
  return getDemoScenarios().find((s) => s.id === id)
}

// Global address -> scenario index so the demo provider can resolve any wallet.
export function getDemoAddressIndex(): Map<string, DemoScenario> {
  const idx = new Map<string, DemoScenario>()
  for (const s of getDemoScenarios()) {
    for (const n of s.nodes) idx.set(n.id, s)
  }
  return idx
}
