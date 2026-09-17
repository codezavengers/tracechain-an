import type { PriceDataSource } from "@/lib/types"
import { fetchJson, ProviderError } from "@/lib/blockchain/net"

// Phase 10 — optional historical value enrichment.
//
// Price data must NEVER block or fail a blockchain trace. When no reliable
// price is available the provider returns { usd: null, source: "UNAVAILABLE" }
// so callers can render "value unknown" instead of a misleading $0.

export interface HistoricalPrice {
  usd: number | null
  source: PriceDataSource
  // The timestamp the price is anchored to (block time for historical).
  timestamp: string | null
}

export interface PriceProvider {
  readonly name: string
  getHistoricalPrice(asset: string, atIso: string): Promise<HistoricalPrice>
  // Current/spot valuation, used to price a live wallet balance. Distinct
  // from historical lookups so the returned provenance can honestly say
  // LIVE_PRICE (spot, captured now) rather than HISTORICAL_PRICE (anchored to
  // a past block time).
  getSpotPrice(asset: string): Promise<HistoricalPrice>
}

// Default: honestly report "no price". Used whenever enrichment is not
// configured, guaranteeing tracing never depends on a price feed.
export class NullPriceProvider implements PriceProvider {
  readonly name = "null-price"
  async getHistoricalPrice(): Promise<HistoricalPrice> {
    return { usd: null, source: "UNAVAILABLE", timestamp: null }
  }
  async getSpotPrice(): Promise<HistoricalPrice> {
    return { usd: null, source: "UNAVAILABLE", timestamp: null }
  }
}

// Map common assets to CoinGecko ids — covers the native asset of every
// TRACECHAIN-supported chain (BTC, ETH, MATIC/POL, BNB, AVAX, SOL, TRX) plus
// the most common bridged/stable tokens. Extendable via config if needed.
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  MATIC: "matic-network",
  POL: "matic-network",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
  SOL: "solana",
  TRX: "tron",
  USDT: "tether",
  USDC: "usd-coin",
}

// Optional CoinGecko-backed historical price provider. Enabled only when
// TRACECHAIN_PRICE_API_URL is set. Failures degrade to UNAVAILABLE (null),
// never throwing into the trace path.
export class CoinGeckoPriceProvider implements PriceProvider {
  readonly name = "coingecko"
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async getHistoricalPrice(asset: string, atIso: string): Promise<HistoricalPrice> {
    const id = COINGECKO_IDS[asset?.toUpperCase()]
    if (!id) return { usd: null, source: "UNAVAILABLE", timestamp: null }
    const day = new Date(atIso)
    if (Number.isNaN(day.getTime())) return { usd: null, source: "UNAVAILABLE", timestamp: null }
    // CoinGecko expects dd-mm-yyyy for the /coins/{id}/history endpoint.
    const dd = String(day.getUTCDate()).padStart(2, "0")
    const mm = String(day.getUTCMonth() + 1).padStart(2, "0")
    const yyyy = day.getUTCFullYear()
    try {
      const u = new URL(`${this.baseUrl.replace(/\/$/, "")}/coins/${id}/history`)
      u.searchParams.set("date", `${dd}-${mm}-${yyyy}`)
      u.searchParams.set("localization", "false")
      if (this.apiKey) u.searchParams.set("x_cg_demo_api_key", this.apiKey)
      const res = await fetchJson<{ market_data?: { current_price?: { usd?: number } } }>(u.toString(), {
        label: "price history",
        retries: 1,
      })
      const usd = res.market_data?.current_price?.usd
      if (typeof usd !== "number") return { usd: null, source: "UNAVAILABLE", timestamp: null }
      return { usd, source: "HISTORICAL_PRICE", timestamp: atIso }
    } catch (err) {
      // Never surface a price failure as a trace failure.
      void (err instanceof ProviderError)
      return { usd: null, source: "UNAVAILABLE", timestamp: null }
    }
  }

  async getSpotPrice(asset: string): Promise<HistoricalPrice> {
    const id = COINGECKO_IDS[asset?.toUpperCase()]
    if (!id) return { usd: null, source: "UNAVAILABLE", timestamp: null }
    try {
      const u = new URL(`${this.baseUrl.replace(/\/$/, "")}/simple/price`)
      u.searchParams.set("ids", id)
      u.searchParams.set("vs_currencies", "usd")
      if (this.apiKey) u.searchParams.set("x_cg_demo_api_key", this.apiKey)
      const now = new Date().toISOString()
      const res = await fetchJson<Record<string, { usd?: number }>>(u.toString(), {
        label: "price spot",
        retries: 1,
      })
      const usd = res[id]?.usd
      if (typeof usd !== "number") return { usd: null, source: "UNAVAILABLE", timestamp: null }
      return { usd, source: "LIVE_PRICE", timestamp: now }
    } catch (err) {
      // Never surface a price failure as a balance-lookup failure.
      void (err instanceof ProviderError)
      return { usd: null, source: "UNAVAILABLE", timestamp: null }
    }
  }
}

function env(name: string): string {
  return (process.env[name] ?? "").trim()
}

// CoinGecko's public `/api/v3` endpoint is free and keyless (rate-limited,
// but functional — verified live). It is the default price source for every
// supported chain's native asset, so USD enrichment never depends on a
// mandatory proprietary API key. TRACECHAIN_PRICE_API_URL/_KEY remain
// supported as an optional override (e.g. a CoinGecko Pro key for a higher
// rate limit, or a self-hosted/alternate CoinGecko-compatible endpoint).
const PUBLIC_COINGECKO_BASE = "https://api.coingecko.com/api/v3"

// Price enrichment is always available now (a free public source exists for
// every supported native asset) — kept as a function, rather than inlining
// `true`, so callers read intent instead of a bare boolean.
export function isPriceEnrichmentConfigured(): boolean {
  return true
}

// Resolve the active price provider from the environment. Defaults to the
// free public CoinGecko API; an explicit TRACECHAIN_PRICE_API_URL overrides
// the base URL (e.g. for a Pro-tier or self-hosted endpoint).
export function getPriceProvider(): PriceProvider {
  const url = env("TRACECHAIN_PRICE_API_URL") || PUBLIC_COINGECKO_BASE
  return new CoinGeckoPriceProvider(url, env("TRACECHAIN_PRICE_API_KEY"))
}
