import type { AddressValidation, Chain, Transaction, WalletKind, WalletMetadata } from "@/lib/types"
import { validateAddress } from "@/lib/blockchain/address-utils"
import { getChainConfig, NATIVE_ASSET } from "@/lib/blockchain/config"
import { providerCache, cacheKey, txOptionsKey, CACHE_TTL } from "@/lib/blockchain/cache"
import { ProviderError, classifyProviderFailure, LiveProviderError } from "@/lib/blockchain/net"
import type {
  BlockchainProvider,
  DataMode,
  DataSource,
  ProviderResult,
  TokenTransfer,
  TxFetchMeta,
  TxQueryOptions,
  WalletBalance,
} from "@/lib/blockchain/data-source"
import { isDemoSource, MAX_INVESTIGATION_TRANSACTIONS } from "@/lib/blockchain/data-source"
import {
  EthereumProvider,
  PolygonProvider,
  BSCProvider,
  ArbitrumProvider,
  OptimismProvider,
  BaseProvider,
  AvalancheProvider,
} from "@/lib/blockchain/providers/evm"
import { BitcoinProvider } from "@/lib/blockchain/providers/bitcoin"
import { TronProvider } from "@/lib/blockchain/providers/tron"
import { SolanaProvider } from "@/lib/blockchain/providers/solana"
import { MockBlockchainProvider } from "@/lib/blockchain/providers/mock"
import { recordProviderSuccess } from "@/lib/blockchain/health-state"
import { getPriceProvider, isPriceEnrichmentConfigured } from "@/lib/blockchain/price/price-provider"

const DEMO_NOTICE = "DEMO DATA — deterministic sample, not live blockchain data."
const TRUNCATION_NOTICE = "Transaction history was limited to the investigation maximum."
// Cap how many distinct (asset, day) price lookups a single investigation
// will trigger, so value enrichment can never turn into an unbounded fan-out
// of price-API calls.
const MAX_PRICE_LOOKUPS = 25

// Exported so the provider-health service can probe the exact same adapters
// the trace path uses, without duplicating this switch.
export function liveProviderFor(chain: Chain): BlockchainProvider | null {
  switch (chain) {
    case "bitcoin":
      return new BitcoinProvider()
    case "ethereum":
      return new EthereumProvider()
    case "polygon":
      return new PolygonProvider()
    case "bsc":
      return new BSCProvider()
    case "arbitrum":
      return new ArbitrumProvider()
    case "optimism":
      return new OptimismProvider()
    case "base":
      return new BaseProvider()
    case "avalanche":
      return new AvalancheProvider()
    case "solana":
      return new SolanaProvider()
    case "tron":
      return new TronProvider()
    default:
      return null
  }
}

interface RunResult<T> {
  data: T
  dataSource: DataSource
  provider: string
  notice?: string
  meta?: TxFetchMeta
}

// Core execution path for single-value reads (balance, single tx lookup):
// cache -> live/indexed provider. In LIVE mode (the default, used by every
// real investigation) a live-provider failure is NEVER papered over with
// mock data — it throws a typed LiveProviderError so the caller can report
// the actual reason. Mock data is only ever returned when the caller
// explicitly opts into DEMO mode. Only non-mock results are cached, so demo
// data is never relabelled CACHED.
async function run<T>(
  chain: Chain,
  op: string,
  ttlMs: number,
  liveFn: (p: BlockchainProvider) => Promise<T>,
  mockFn: (m: MockBlockchainProvider) => Promise<T>,
  mode: DataMode = "LIVE",
): Promise<ProviderResult<T>> {
  const key = cacheKey([chain, op])
  const cached = providerCache.get<{ data: T; dataSource: DataSource; provider: string }>(key)
  if (cached.hit && cached.value) {
    return {
      data: cached.value.data,
      dataSource: "CACHED",
      chain,
      provider: cached.value.provider,
      fetchedAt: new Date().toISOString(),
      cached: true,
    }
  }

  if (mode === "DEMO") {
    const mock = new MockBlockchainProvider(chain)
    const data = await mockFn(mock)
    return {
      data,
      dataSource: "MOCK",
      chain,
      provider: mock.name,
      fetchedAt: new Date().toISOString(),
      cached: false,
      notice: DEMO_NOTICE,
    }
  }

  const live = liveProviderFor(chain)
  const canGoLive = live?.isConfigured() ?? false
  if (!live || !canGoLive) {
    throw new LiveProviderError("PROVIDER_CONFIGURATION_REQUIRED", `Live provider not configured for ${chain}.`, chain, live?.name)
  }

  let result: RunResult<T>
  try {
    const data = await liveFn(live)
    result = { data, dataSource: live.nativeSource, provider: live.name }
    recordProviderSuccess(chain)
  } catch (err) {
    if (err instanceof LiveProviderError) throw err
    throw classifyProviderFailure(err, chain, live.name)
  }

  providerCache.set(key, { data: result.data, dataSource: result.dataSource, provider: result.provider }, ttlMs)

  return {
    data: result.data,
    dataSource: result.dataSource,
    chain,
    provider: result.provider,
    fetchedAt: new Date().toISOString(),
    cached: false,
    notice: result.notice,
  }
}

// List execution path (transactions / token transfers): same cache -> live
// -> mock flow as `run`, but prefers a provider's paginated method when
// available so callers get honest totalFetched/pagesFetched/truncated
// metadata instead of a silent 50-row clip.
async function runList<T>(
  chain: Chain,
  op: string,
  ttlMs: number,
  options: TxQueryOptions | undefined,
  pagedFn: ((p: BlockchainProvider) => Promise<{ items: T[]; meta: TxFetchMeta } | undefined>) | undefined,
  simpleFn: (p: BlockchainProvider) => Promise<T[]>,
  mockFn: (m: MockBlockchainProvider) => Promise<T[]>,
  mode: DataMode = "LIVE",
): Promise<ProviderResult<T[]>> {
  // Complete cache key: chain + operation (which already embeds the address or
  // tx hash) + EVERY result-affecting query option (page, offset, maxPages,
  // maxTransactions, startDate, endDate). This guarantees a different logical
  // request can never reuse another request's cached rows.
  const key = cacheKey([chain, op, txOptionsKey(options)])
  const cached = providerCache.get<{ data: T[]; dataSource: DataSource; provider: string; meta?: TxFetchMeta }>(key)
  if (cached.hit && cached.value) {
    return {
      data: cached.value.data,
      dataSource: "CACHED",
      chain,
      provider: cached.value.provider,
      fetchedAt: new Date().toISOString(),
      cached: true,
      meta: cached.value.meta,
    }
  }

  if (mode === "DEMO") {
    const mock = new MockBlockchainProvider(chain)
    const data = await mockFn(mock)
    return {
      data,
      dataSource: "MOCK",
      chain,
      provider: mock.name,
      fetchedAt: new Date().toISOString(),
      cached: false,
      notice: DEMO_NOTICE,
    }
  }

  const live = liveProviderFor(chain)
  const canGoLive = live?.isConfigured() ?? false
  if (!live || !canGoLive) {
    throw new LiveProviderError("PROVIDER_CONFIGURATION_REQUIRED", `Live provider not configured for ${chain}.`, chain, live?.name)
  }

  let result: RunResult<T[]>
  try {
    const paged = pagedFn ? await pagedFn(live) : undefined
    if (paged) {
      result = {
        data: paged.items,
        dataSource: live.nativeSource,
        provider: live.name,
        meta: paged.meta,
        notice: paged.meta.truncated ? TRUNCATION_NOTICE : undefined,
      }
    } else {
      const data = await simpleFn(live)
      result = { data, dataSource: live.nativeSource, provider: live.name }
    }
    recordProviderSuccess(chain)
  } catch (err) {
    if (err instanceof LiveProviderError) throw err
    throw classifyProviderFailure(err, chain, live.name)
  }

  providerCache.set(
    key,
    { data: result.data, dataSource: result.dataSource, provider: result.provider, meta: result.meta },
    ttlMs,
  )

  return {
    data: result.data,
    dataSource: result.dataSource,
    chain,
    provider: result.provider,
    fetchedAt: new Date().toISOString(),
    cached: false,
    notice: result.notice,
    meta: result.meta,
  }
}

// Best-effort historical USD enrichment for a batch of transactions. Never
// throws and never blocks tracing on a price-API failure — every lookup that
// fails or is unconfigured just leaves usdValue as null / UNAVAILABLE. Calls
// are deduped by (asset, day) and capped so one investigation can't fan out
// into an unbounded number of price requests.
async function enrichTransactionsWithPrices(txs: Transaction[]): Promise<Transaction[]> {
  if (!isPriceEnrichmentConfigured() || txs.length === 0) return txs
  const provider = getPriceProvider()
  const cache = new Map<string, { usd: number | null; source: string; timestamp: string | null }>()
  let lookups = 0

  const out: Transaction[] = []
  for (const tx of txs) {
    if ((tx.usdValue !== null && tx.usdValue !== undefined) || !tx.timestamp) {
      out.push(tx)
      continue
    }
    const day = tx.timestamp.slice(0, 10)
    const key = `${tx.asset}:${day}`
    let price = cache.get(key)
    if (!price) {
      if (lookups >= MAX_PRICE_LOOKUPS) {
        out.push(tx)
        continue
      }
      lookups++
      const historical = await provider.getHistoricalPrice(tx.asset, tx.timestamp)
      price = historical
      cache.set(key, historical)
    }
    if (price.usd === null) {
      out.push(tx)
      continue
    }
    out.push({
      ...tx,
      usdValue: Math.round(tx.amount * price.usd * 100) / 100,
      priceDataSource: price.source as Transaction["priceDataSource"],
      priceTimestamp: price.timestamp,
    })
  }
  return out
}

// Best-effort spot-price enrichment for a live wallet balance. Mirrors
// enrichTransactionsWithPrices' honesty rules: an actually-zero balance
// stays 0 (that IS the known value), an unpriced non-zero balance stays
// null, and any price-provider failure degrades to null rather than
// blocking or failing the balance lookup.
async function enrichBalanceWithPrice(balance: WalletBalance): Promise<WalletBalance> {
  if (balance.balance === 0) return { ...balance, usdBalance: 0 }
  if (!isPriceEnrichmentConfigured()) return balance
  try {
    const price = await getPriceProvider().getSpotPrice(balance.asset)
    if (price.usd === null) return balance
    return { ...balance, usdBalance: Math.round(balance.balance * price.usd * 100) / 100 }
  } catch {
    return balance
  }
}

// Public façade — the production BlockchainProvider surface used by API routes.
export const blockchain = {
  validateAddress(address: string, chain?: Chain): AddressValidation {
    return validateAddress(address, chain)
  },

  isLiveCapable(chain: Chain): boolean {
    return getChainConfig(chain).configured && liveProviderFor(chain) !== null
  },

  async getTransactions(
    address: string,
    chain: Chain,
    options?: TxQueryOptions,
    mode: DataMode = "LIVE",
  ): Promise<ProviderResult<Transaction[]>> {
    const res = await runList<Transaction>(
      chain,
      cacheKey(["txs", address]),
      CACHE_TTL.transactions,
      options,
      async (p) => {
        if (!p.getTransactionsPaged) return undefined
        const { transactions, meta } = await p.getTransactionsPaged(address, chain, options)
        return { items: transactions, meta }
      },
      (p) => p.getTransactions(address, chain, options),
      (m) => m.getTransactions(address),
      mode,
    )
    if (res.dataSource === "MOCK") return res
    return { ...res, data: await enrichTransactionsWithPrices(res.data) }
  },

  getTransaction(hash: string, chain: Chain, mode: DataMode = "LIVE"): Promise<ProviderResult<Transaction | null>> {
    return run(
      chain,
      cacheKey(["tx", hash]),
      CACHE_TTL.transaction,
      (p) => p.getTransaction(hash, chain),
      (m) => m.getTransaction(hash),
      mode,
    )
  },

  async getWalletBalance(address: string, chain: Chain, mode: DataMode = "LIVE"): Promise<ProviderResult<WalletBalance>> {
    const res = await run(
      chain,
      cacheKey(["bal", address]),
      CACHE_TTL.balance,
      (p) => p.getWalletBalance(address, chain),
      (m) => m.getWalletBalance(address),
      mode,
    )
    // Demo balances already carry a deterministic usdBalance; only live/
    // indexed/cached balances need enrichment from the price provider.
    if (res.dataSource === "MOCK") return res
    return { ...res, data: await enrichBalanceWithPrice(res.data) }
  },

  getTokenTransfers(
    address: string,
    chain: Chain,
    options?: TxQueryOptions,
    mode: DataMode = "LIVE",
  ): Promise<ProviderResult<TokenTransfer[]>> {
    return runList<TokenTransfer>(
      chain,
      cacheKey(["tok", address]),
      CACHE_TTL.tokenTransfers,
      options,
      async (p) => {
        if (!p.getTokenTransfersPaged) return undefined
        const { transfers, meta } = await p.getTokenTransfersPaged(address, chain, options)
        return { items: transfers, meta }
      },
      (p) => p.getTokenTransfers(address, chain, options),
      (m) => m.getTokenTransfers(address),
      mode,
    )
  },

  // Composite wallet lookup used by the wallet-investigation route. Returns a
  // single honest dataSource plus derived metadata. In LIVE mode (the
  // default), any live-provider failure throws a LiveProviderError instead of
  // silently degrading to mock data — the caller (API route) is responsible
  // for turning that into an honest error response.
  async inspectWallet(address: string, chain: Chain, options?: TxQueryOptions, mode: DataMode = "LIVE") {
    const [balRes, txRes, tokRes] = await Promise.all([
      this.getWalletBalance(address, chain, mode),
      this.getTransactions(address, chain, options, mode),
      this.getTokenTransfers(address, chain, options, mode),
    ])

    // Overall source reflects the transaction feed (the primary intelligence).
    const dataSource = txRes.dataSource
    const demo = isDemoSource(dataSource)

    let metadata: WalletMetadata
    if (demo) {
      const mock = new MockBlockchainProvider(chain)
      const m = await mock.getMetadata(address)
      metadata = m ?? synthMetadata(address, chain, balRes.data, txRes.data, "DEMO_DATA")
    } else {
      metadata = synthMetadata(address, chain, balRes.data, txRes.data, "LIVE_BLOCKCHAIN_DATA")
    }

    return {
      address,
      chain,
      dataSource,
      demo,
      notice: txRes.notice,
      provider: txRes.provider,
      fetchedAt: txRes.fetchedAt,
      cached: txRes.cached,
      meta: txRes.meta,
      metadata,
      balance: balRes.data,
      transactions: txRes.data,
      tokenTransfers: tokRes.data,
    }
  },
}

function synthMetadata(
  address: string,
  chain: Chain,
  balance: WalletBalance,
  txs: Transaction[],
  provenance: "DEMO_DATA" | "LIVE_BLOCKCHAIN_DATA",
): WalletMetadata {
  const times = txs.map((t) => t.timestamp).filter((t): t is string => Boolean(t)).sort()
  const kind: WalletKind = "UNKNOWN"
  // firstSeen/lastSeen are derived ONLY from authoritative transaction
  // timestamps. When none are known they stay null — never backfilled with the
  // current time, which would falsely imply an historical event happened now.
  // (fetchedAt, set by the caller, legitimately carries the retrieval time.)
  return {
    address,
    chain,
    kind,
    balance: balance.balance,
    asset: balance.asset || NATIVE_ASSET[chain],
    usdBalance: balance.usdBalance,
    firstSeen: times[0] ?? null,
    lastSeen: times[times.length - 1] ?? null,
    txCount: txs.length,
    provenance,
    attribution: null,
  }
}

export type WalletInspection = Awaited<ReturnType<typeof blockchain.inspectWallet>>
export { MAX_INVESTIGATION_TRANSACTIONS }
