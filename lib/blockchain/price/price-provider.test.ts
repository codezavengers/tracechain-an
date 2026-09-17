import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  NullPriceProvider,
  CoinGeckoPriceProvider,
  isPriceEnrichmentConfigured,
  getPriceProvider,
  type PriceProvider,
} from "./price-provider"

describe("NullPriceProvider", () => {
  it("always reports price as unavailable, never throwing", async () => {
    const provider: PriceProvider = new NullPriceProvider()
    const result = await provider.getHistoricalPrice("BTC", "2024-01-01T00:00:00.000Z")
    expect(result).toEqual({ usd: null, source: "UNAVAILABLE", timestamp: null })
  })

  it("also reports the spot price as unavailable, never throwing", async () => {
    const provider: PriceProvider = new NullPriceProvider()
    const result = await provider.getSpotPrice("BTC")
    expect(result).toEqual({ usd: null, source: "UNAVAILABLE", timestamp: null })
  })
})

describe("getPriceProvider / isPriceEnrichmentConfigured", () => {
  const ORIGINAL_ENV = process.env.TRACECHAIN_PRICE_API_URL
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.TRACECHAIN_PRICE_API_URL
    else process.env.TRACECHAIN_PRICE_API_URL = ORIGINAL_ENV
  })

  it("uses the free public CoinGecko API by default when no price API URL is configured", () => {
    delete process.env.TRACECHAIN_PRICE_API_URL
    // CoinGecko's public /api/v3 endpoint is free and keyless, so price
    // enrichment is always available — NullPriceProvider is never the
    // default; it's only used as an explicit "no enrichment" fallback.
    expect(isPriceEnrichmentConfigured()).toBe(true)
    expect(getPriceProvider()).toBeInstanceOf(CoinGeckoPriceProvider)
  })

  it("uses CoinGeckoPriceProvider when a custom price API URL is configured", () => {
    process.env.TRACECHAIN_PRICE_API_URL = "https://api.coingecko.com/api/v3"
    expect(isPriceEnrichmentConfigured()).toBe(true)
    expect(getPriceProvider()).toBeInstanceOf(CoinGeckoPriceProvider)
  })
})

describe("CoinGeckoPriceProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns a HISTORICAL_PRICE result on success", async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ market_data: { current_price: { usd: 65000 } } }), { status: 200 }),
    )
    const provider = new CoinGeckoPriceProvider("https://api.coingecko.com/api/v3", "")
    const result = await provider.getHistoricalPrice("BTC", "2024-01-01T00:00:00.000Z")
    expect(result.usd).toBe(65000)
    expect(result.source).toBe("HISTORICAL_PRICE")
  })

  it("degrades to UNAVAILABLE (never throws) when the upstream call fails", async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"))
    const provider = new CoinGeckoPriceProvider("https://api.coingecko.com/api/v3", "")
    const result = await provider.getHistoricalPrice("BTC", "2024-01-01T00:00:00.000Z")
    expect(result).toEqual({ usd: null, source: "UNAVAILABLE", timestamp: null })
  })

  it("degrades to UNAVAILABLE for an unrecognized asset instead of guessing", async () => {
    const provider = new CoinGeckoPriceProvider("https://api.coingecko.com/api/v3", "")
    const result = await provider.getHistoricalPrice("SOME_UNKNOWN_TOKEN", "2024-01-01T00:00:00.000Z")
    expect(result.usd).toBeNull()
    expect(result.source).toBe("UNAVAILABLE")
  })

  it("never returns usdValue 0 as a stand-in for unknown", async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const provider = new CoinGeckoPriceProvider("https://api.coingecko.com/api/v3", "")
    const result = await provider.getHistoricalPrice("ETH", "2024-01-01T00:00:00.000Z")
    expect(result.usd).toBeNull()
    expect(result.usd).not.toBe(0)
  })

  it("getSpotPrice returns a LIVE_PRICE result on success", async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ bitcoin: { usd: 65000 } }), { status: 200 }),
    )
    const provider = new CoinGeckoPriceProvider("https://api.coingecko.com/api/v3", "")
    const result = await provider.getSpotPrice("BTC")
    expect(result.usd).toBe(65000)
    expect(result.source).toBe("LIVE_PRICE")
  })

  it("getSpotPrice degrades to UNAVAILABLE (never throws) when the upstream call fails", async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"))
    const provider = new CoinGeckoPriceProvider("https://api.coingecko.com/api/v3", "")
    const result = await provider.getSpotPrice("BTC")
    expect(result).toEqual({ usd: null, source: "UNAVAILABLE", timestamp: null })
  })

  it("getSpotPrice degrades to UNAVAILABLE for an unrecognized asset instead of guessing", async () => {
    const provider = new CoinGeckoPriceProvider("https://api.coingecko.com/api/v3", "")
    const result = await provider.getSpotPrice("SOME_UNKNOWN_TOKEN")
    expect(result.usd).toBeNull()
    expect(result.source).toBe("UNAVAILABLE")
  })
})
