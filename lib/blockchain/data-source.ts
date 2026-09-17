import type { Chain, Transaction } from "@/lib/types"

// ---------------------------------------------------------------------------
// Investigation pagination limits (Phases 6 & 7).
// These bound how much history an adapter will pull so a single investigation
// can never trigger unbounded upstream requests.
// ---------------------------------------------------------------------------
export const MAX_ROWS_PER_PAGE = 100
export const DEFAULT_MAX_PAGES = 5
export const MAX_INVESTIGATION_TRANSACTIONS = 500

// Options accepted by the transaction-retrieval path. All optional; adapters
// fall back to the constants above.
export interface TxQueryOptions {
  page?: number
  offset?: number // rows per page
  maxPages?: number
  // ISO date filters applied to the transaction timestamp.
  startDate?: string
  endDate?: string
  // Hard cap on returned rows (never exceeds MAX_INVESTIGATION_TRANSACTIONS).
  maxTransactions?: number
}

// Metadata describing a paginated fetch, surfaced to the UI for honesty.
export interface TxFetchMeta {
  totalFetched: number
  pagesFetched: number
  truncated: boolean
}

export interface PagedTransactions {
  transactions: Transaction[]
  meta: TxFetchMeta
}

export interface PagedTokenTransfers {
  transfers: TokenTransfer[]
  meta: TxFetchMeta
}

// Honest provenance label attached to every value the provider layer returns.
// Deliberately NO third-party block-explorer / indexer category exists here
// (no Etherscan, Blockscout, Routescan, Blockstream, etc.) — every live value
// comes either straight off a chain node (RAW_RPC) or a chain's own official
// network gateway (LIVE_NATIVE_API, e.g. TronGrid for TRON).
//   RAW_RPC        - fetched just now via direct JSON-RPC to a chain node
//   LIVE_NATIVE_API - fetched just now via a chain's own official/native API
//   CACHED          - re-served from our short-lived in-memory cache
//   MOCK            - deterministic demo data (no live source configured)
export type DataSource = "RAW_RPC" | "LIVE_NATIVE_API" | "CACHED" | "MOCK"
export type DataMode = "LIVE" | "DEMO"

export const DATA_SOURCE_LABEL: Record<DataSource, string> = {
  RAW_RPC: "Live (raw RPC)",
  LIVE_NATIVE_API: "Live (native API)",
  CACHED: "Cached",
  MOCK: "Demo data",
}

export function isDemoSource(s: DataSource): boolean {
  return s === "MOCK"
}

// Envelope returned by the high-level blockchain service. `dataSource` is the
// single source of truth for how the payload was derived.
export interface ProviderResult<T> {
  data: T
  dataSource: DataSource
  chain: Chain
  provider: string
  fetchedAt: string
  cached: boolean
  // Present when the result is demo data or a degraded fallback, so the UI can
  // surface an unmistakable "DEMO DATA" / "using fallback" notice.
  notice?: string
  // Pagination metadata (present for transaction-list results).
  meta?: TxFetchMeta
}

export interface WalletBalance {
  address: string
  chain: Chain
  balance: number
  asset: string
  // Null when no reliable USD price was available. Zero is reserved for an
  // actually-zero balance — never used to mean "unknown valuation".
  usdBalance: number | null
}

// ERC-20 / BEP-20 style token movement, distinct from a native-asset transfer.
export interface TokenTransfer {
  hash: string
  chain: Chain
  from: string
  to: string
  tokenSymbol: string
  tokenName: string
  tokenAddress: string
  amount: number
  decimals: number
  timestamp: string | null
  // Null when the authoritative block number could not be resolved within
  // the bounded lookup budget. Never fabricated as 0.
  blockHeight: number | null
  direction?: "in" | "out"
  // Optional value enrichment (Phase 10); null when no reliable price.
  usdValue?: number | null
}

// The production provider contract every chain adapter implements.
// Chain is accepted as an optional argument for interface symmetry; each
// concrete adapter is already bound to a single chain.
export interface BlockchainProvider {
  readonly chain: Chain
  readonly name: string
  // The data source this provider yields when it succeeds (RAW_RPC or LIVE_NATIVE_API).
  readonly nativeSource: DataSource
  isConfigured(): boolean
  validateAddress(address: string, chain?: Chain): import("@/lib/types").AddressValidation
  getTransactions(address: string, chain?: Chain, options?: TxQueryOptions): Promise<Transaction[]>
  getTransaction(hash: string, chain?: Chain): Promise<Transaction | null>
  getWalletBalance(address: string, chain?: Chain): Promise<WalletBalance>
  getTokenTransfers(address: string, chain?: Chain, options?: TxQueryOptions): Promise<TokenTransfer[]>
  // Optional richer path that returns pagination metadata alongside rows.
  // Adapters that can paginate (EVM, Bitcoin, Tron) implement this; the
  // service prefers it and derives a truncation notice from the meta.
  getTransactionsPaged?(address: string, chain: Chain, options?: TxQueryOptions): Promise<PagedTransactions>
  // Same idea for token transfers (ERC-20/BEP-20/TRC-20 lists can be just as
  // large as native transaction history).
  getTokenTransfersPaged?(address: string, chain: Chain, options?: TxQueryOptions): Promise<PagedTokenTransfers>
}
