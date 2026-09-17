// TRACECHAIN AI - Core domain types
// Shared across backend engines, API routes, and frontend.

export type Chain =
  | "bitcoin"
  | "ethereum"
  | "polygon"
  | "bsc"
  | "arbitrum"
  | "optimism"
  | "base"
  | "avalanche"
  | "solana"
  | "tron"

export type DataProvenance =
  | "LIVE_BLOCKCHAIN_DATA"
  | "DEMO_DATA"
  | "KNOWN_ATTRIBUTION"
  | "PROBABLE_ATTRIBUTION"
  | "HEURISTIC_ANALYSIS"
  | "ML_PREDICTION"
  | "UNKNOWN"

export type AnalysisType =
  | "rule"
  | "graph"
  | "statistical"
  | "ml"
  | "heuristic"
  | "attribution"
  | "demo"

export type Role = "ADMIN" | "INVESTIGATOR" | "ANALYST" | "VIEWER"

export type RiskBand = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

export type CaseStatus =
  | "NEW"
  | "ANALYZING"
  | "TRACING"
  | "VASP_IDENTIFIED"
  | "ACTION_REQUIRED"
  | "FREEZE_REVIEW"
  | "MONITORING"
  | "CLOSED"

export type FraudTypology =
  | "INVESTMENT_FRAUD"
  | "TASK_SCAM"
  | "RANSOMWARE"
  | "CROSS_CHAIN_LAUNDERING"
  | "ORGANIZED_FRAUD"
  | "RAPID_CASHOUT"
  | "PIG_BUTCHERING"
  | "UNKNOWN"

export type AttributionCategory = "KNOWN" | "PROBABLE" | "UNKNOWN"

export type WalletKind =
  | "VICTIM"
  | "SUSPICIOUS"
  | "BURNER"
  | "VASP"
  | "EXCHANGE"
  | "BRIDGE"
  | "MIXER"
  | "DEFI"
  | "FRAUD_CLUSTER"
  | "UNKNOWN"

export type EdgeKind =
  | "SENT_FUNDS"
  | "RECEIVED_FUNDS"
  | "BRIDGED"
  | "DEPOSITED"
  | "INTERACTED"
  | "CONNECTED_TO"

// A single AI/intelligence result envelope. Every engine returns this shape.
export interface IntelResult<T = unknown> {
  result: T
  confidence: number // 0..1
  explanation: string
  evidence: string[]
  recommendation: string
  analysisType: AnalysisType
  provenance: DataProvenance
  generatedAt: string
}

export interface AddressValidation {
  address: string
  valid: boolean
  chain: Chain | null
  candidateChains: Chain[]
  reason: string
}

// Phase 9 — every normalized movement is either a native-asset transfer or a
// token (ERC-20/BEP-20/TRC-20) transfer.
export type TransferType = "NATIVE" | "TOKEN"

// Phase 10 — honest provenance for any USD value attached to a movement.
//   LIVE_PRICE       - spot price captured at fetch time
//   HISTORICAL_PRICE - price anchored to the transaction's block timestamp
//   UNAVAILABLE      - no reliable price (usdValue MUST be null, never 0)
//   MOCK_PRICE       - deterministic demo price (demo data only)
export type PriceDataSource = "LIVE_PRICE" | "HISTORICAL_PRICE" | "UNAVAILABLE" | "MOCK_PRICE"

export interface Transaction {
  hash: string
  chain: Chain
  from: string
  to: string
  amount: number // native units for BTC/ETH etc, or token units
  asset: string
  // USD value is null when no reliable price exists. Zero is NOT used as
  // "unknown" because it would masquerade as a verified $0 movement.
  usdValue: number | null
  // Null when the historical block timestamp could not be resolved. Never
  // backfilled with "now" — an unknown time must never look like a real one.
  timestamp: string | null
  // Block height is null when the authoritative block number could not be
  // resolved (e.g. an unconfirmed Bitcoin tx, or a bounded TRC-20 lookup that
  // was skipped/failed). Zero is NEVER used as a stand-in for "unknown".
  blockHeight: number | null
  direction?: "in" | "out"
  provenance: DataProvenance
  // Phase 9 normalization fields (optional for backward compatibility with
  // demo fixtures that predate the unified layer).
  transferType?: TransferType
  tokenAddress?: string | null
  // Phase 10 value-enrichment provenance.
  priceDataSource?: PriceDataSource
  priceTimestamp?: string | null
  // Which class of live request produced this row: a direct RPC/node call
  // (RAW_RPC) or a chain's own official/native gateway (LIVE_NATIVE_API,
  // e.g. TronGrid — TRON's own full-node HTTP API, not a third-party
  // explorer). Null only for demo/mock rows.
  sourceType?: "RAW_RPC" | "LIVE_NATIVE_API" | null
}

// Phase 11 — result of resolving which chain(s) an address may belong to.
export type ChainDetectionMethod = "FORMAT" | "PROVIDER_PROBE" | "USER_SELECTED"

export interface ChainDetectionResult {
  address: string
  possibleChains: Chain[]
  detectedChain: Chain | null
  confidence: number // 0..1
  method: ChainDetectionMethod
  // True when the format is ambiguous (e.g. any EVM chain) and the operator
  // must pick the network explicitly.
  requiresUserSelection: boolean
  reason: string
}

// Live provider health snapshot for a single chain. "DEMO" is intentionally
// NOT a valid status here — this endpoint reports the real connectivity of
// the production live provider, never a demo/fallback state.
export type ProviderHealthStatus = "LIVE" | "CONFIGURATION_REQUIRED" | "RATE_LIMITED" | "TIMEOUT" | "ERROR" | "UNAVAILABLE"

export interface ProviderHealth {
  chain: Chain
  provider: string
  status: ProviderHealthStatus
  // RAW_RPC | LIVE_NATIVE_API — absent when CONFIGURATION_REQUIRED.
  sourceType: "RAW_RPC" | "LIVE_NATIVE_API" | null
  latencyMs: number | null
  lastSuccess: string | null
  // Latest block/slot/height observed by the probe, when available.
  latestBlock: number | string | null
  // Whether an env var + secret pair is currently set for this chain.
  configured: boolean
  // Whether a live adapter exists for this chain at all (true for every
  // supported chain now that Tron has one) — distinct from `configured`,
  // which reflects the current environment rather than the architecture.
  liveCapable: boolean
  // Whether historical address transaction discovery is available for this
  // chain's current provider (raw RPC alone cannot always provide this).
  historicalSearch: boolean
}

export interface WalletMetadata {
  address: string
  chain: Chain
  kind: WalletKind
  label?: string
  balance: number
  asset: string
  // Null when no reliable USD price was available for this balance. Zero is
  // reserved for an actually-zero balance — it must never mean "unknown".
  usdBalance: number | null
  // Null when no authoritative first/last activity timestamp is known. Never
  // backfilled with the current time — an unknown time must never look real.
  firstSeen: string | null
  lastSeen: string | null
  txCount: number
  provenance: DataProvenance
  attribution?: VaspAttribution | null
}

export interface VaspRecord {
  id: string
  name: string
  type: "EXCHANGE" | "BRIDGE" | "MIXER" | "DEFI" | "OTC"
  jurisdiction: string
  kycLevel: "HIGH" | "MEDIUM" | "LOW" | "NONE"
  cooperationLevel: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"
  note: string
}

export interface VaspAttribution {
  category: AttributionCategory
  vasp?: VaspRecord
  confidence: number
  reason: string
  provenance: DataProvenance
}

export interface GraphNode {
  id: string // wallet address or synthetic id
  kind: WalletKind
  chain: Chain
  label?: string
  riskScore?: number
  usdValue?: number
  depth?: number
  attribution?: AttributionCategory
  provenance: DataProvenance
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  amount: number
  asset: string
  usdValue: number
  timestamp: string
  txHash: string
}

export interface TransactionGraph {
  rootAddress: string
  chain: Chain
  depth: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  provenance: DataProvenance
}

export interface JourneyStep {
  step: number
  title: string
  address: string
  kind: WalletKind
  usdValue: number
  timestamp: string
  description: string
  attribution?: AttributionCategory
}

export interface Alert {
  id: string
  caseId?: string
  walletAddress: string
  chain: Chain
  severity: RiskBand
  type: string
  message: string
  createdAt: string
  acknowledged: boolean
}

export interface WatchedWallet {
  id: string
  address: string
  chain: Chain
  label: string
  caseId?: string
  addedAt: string
  lastActivity: string
  status: "ACTIVE" | "DORMANT" | "TRIGGERED"
  balance: number
  usdBalance: number
}

export interface EvidenceRecord {
  id: string
  caseId: string
  type: string
  title: string
  contentHash: string // sha-256
  prevHash: string // chain link
  createdAt: string
  createdBy: string
  provenance: DataProvenance
  summary: string
  // Optional originating filename when the evidence came from an uploaded /
  // named artifact. Omitted when not applicable.
  filename?: string
}

export interface CaseNote {
  id: string
  author: string
  createdAt: string
  body: string
}

export interface CaseActivity {
  id: string
  actor: string
  action: string
  detail: string
  createdAt: string
}

export interface InvestigationCase {
  id: string
  complaintRef: string
  title: string
  reportedWallet: string
  chain: Chain
  complaintText: string
  extractedWallets: string[]
  typology: FraudTypology
  riskScore: number
  riskBand: RiskBand
  priorityScore: number
  status: CaseStatus
  investigator: string
  reportedLossUsd: number
  traceableUsd: number
  recoveryProbability: number
  connectedVictims: number
  createdAt: string
  updatedAt: string
  notes: CaseNote[]
  activity: CaseActivity[]
  provenance: DataProvenance
  demoScenario?: FraudTypology
}

export interface User {
  id: string
  email: string
  name: string
  role: Role
  passwordHash: string
}

export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role
}
