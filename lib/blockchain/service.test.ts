import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { blockchain } from "./service"
import { providerCache } from "./cache"

// ---------------------------------------------------------------------------
// RAW-RPC-first test helpers.
//
// Every EVM chain is now LIVE by default via a free public JSON-RPC
// endpoint (see config.ts PUBLIC_RPC) — no Etherscan-style key is ever
// required. These helpers build fetch mocks that speak plain JSON-RPC
// (eth_getBalance / eth_blockNumber / eth_getBlockByNumber / eth_getLogs)
// instead of the old third-party-indexer JSON shape.
// ---------------------------------------------------------------------------

function rpcOk(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 })
}

function hexWei(wei: string) {
  return "0x" + BigInt(wei).toString(16)
}

function hexNum(n: number) {
  return "0x" + Math.trunc(n).toString(16)
}

interface EvmBlock {
  timestamp: string
  transactions: Array<{ hash: string; from: string; to: string; value: string; blockNumber: string }>
}

// Dispatches a JSON-RPC POST body to the matching raw-node handler. Any
// call whose URL looks like a price-API request (CoinGecko) is routed to
// `onPrice` instead, mirroring how the real fetch traffic is split between
// the chain's own RPC endpoint and the optional price provider.
function mockEvmRpc(
  handlers: {
    balance?: string // hex wei
    blockNumber?: number
    getBlock?: (blockNumberHex: string) => EvmBlock | null
    logs?: unknown[]
  },
  onPrice?: (url: string) => Response,
) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url)
    if (onPrice && u.includes("coingecko")) return Promise.resolve(onPrice(u))
    const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"))
    switch (body.method) {
      case "eth_getBalance":
        return Promise.resolve(rpcOk(handlers.balance ?? "0x0"))
      case "eth_blockNumber":
        return Promise.resolve(rpcOk(hexNum(handlers.blockNumber ?? 0)))
      case "eth_getBlockByNumber": {
        const [blockHex] = body.params as [string, boolean]
        const block = handlers.getBlock ? handlers.getBlock(blockHex) : null
        return Promise.resolve(rpcOk(block))
      }
      case "eth_getLogs":
        return Promise.resolve(rpcOk(handlers.logs ?? []))
      default:
        return Promise.resolve(rpcOk(null))
    }
  })
}

// A minimal happy-path chain: latest block is 1, block 1 carries a single
// transaction touching ADDRESS, block 0 is empty. Enough to exercise the
// bounded native-transfer scan without a real node.
function mockSingleTxChain(address: string, hash: string, timeStampSeconds: number, onPrice?: (url: string) => Response) {
  return mockEvmRpc(
    {
      balance: "0x0",
      blockNumber: 1,
      getBlock: (blockHex) => {
        const n = Number.parseInt(blockHex, 16)
        if (n === 1) {
          return {
            timestamp: hexNum(timeStampSeconds),
            transactions: [{ hash, from: "0xa", to: address, value: hexWei("1000000000000000000"), blockNumber: hexNum(1) }],
          }
        }
        return { timestamp: hexNum(timeStampSeconds - 1000), transactions: [] }
      },
      logs: [],
    },
    onPrice,
  )
}

describe("blockchain service — data-honesty fallback", () => {
  beforeEach(() => {
    providerCache.clear()
  })

  // Bitcoin genuinely has no free public RPC endpoint, so with no env vars
  // set it is the one chain that stays unconfigured — the honest
  // "unconfigured" case, unlike every EVM chain which is live by default.
  it("falls back to MOCK with an explicit DEMO notice when a chain has no live source configured", async () => {
    const res = await blockchain.getTransactions("1BitcoinAddress", "bitcoin", undefined, "DEMO")
    expect(res.dataSource).toBe("MOCK")
    expect(res.notice).toMatch(/DEMO DATA/)
  })

  it("never labels demo data as CACHED — only real fetches get cached", async () => {
    const first = await blockchain.getTransactions("1BitcoinAddress", "bitcoin", undefined, "DEMO")
    const second = await blockchain.getTransactions("1BitcoinAddress", "bitcoin", undefined, "DEMO")
    expect(first.dataSource).toBe("MOCK")
    expect(second.dataSource).toBe("MOCK")
    expect(second.cached).toBe(false)
  })

  it("isLiveCapable is false for bitcoin (no free public RPC) and true for chains with a free default endpoint", () => {
    expect(blockchain.isLiveCapable("bitcoin")).toBe(false)
    expect(blockchain.isLiveCapable("ethereum")).toBe(true)
    expect(blockchain.isLiveCapable("tron")).toBe(true)
  })

  describe("with a live-configured chain that errors", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("upstream down")))
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    // In LIVE mode a live-provider failure is never papered over with mock
    // data — it throws a typed LiveProviderError so the caller can report
    // the actual reason instead of silently substituting demo data.
    it("throws a LiveProviderError surfacing the live-provider failure reason (never a silent MOCK fallback)", async () => {
      await expect(blockchain.getTransactions("0xabc", "ethereum")).rejects.toMatchObject({
        name: "LiveProviderError",
        code: "LIVE_PROVIDER_UNAVAILABLE",
      })
    })
  })
})

describe("blockchain service — USD balance semantics (null vs 0)", () => {
  const ADDRESS = "0x000000000000000000000000000000000000dEaD"

  beforeEach(() => {
    providerCache.clear()
  })
  afterEach(() => {
    delete process.env.TRACECHAIN_PRICE_API_URL
    vi.unstubAllGlobals()
  })

  it("computes a real usdBalance when a live price is available", async () => {
    process.env.TRACECHAIN_PRICE_API_URL = "https://api.coingecko.com/api/v3"
    vi.stubGlobal(
      "fetch",
      mockEvmRpc({ balance: hexWei("1000000000000000000") }, (url) => {
        if (url.includes("simple/price")) return new Response(JSON.stringify({ ethereum: { usd: 2000 } }), { status: 200 })
        return rpcOk(null)
      }),
    )
    const res = await blockchain.getWalletBalance(ADDRESS, "ethereum")
    expect(res.data.balance).toBeCloseTo(1, 6)
    expect(res.data.usdBalance).toBeCloseTo(2000, 2)
  })

  it("returns usdBalance null (never 0) when no price is available from the provider", async () => {
    vi.stubGlobal("fetch", mockEvmRpc({ balance: hexWei("1000000000000000000") }, () => rpcOk(null)))
    const res = await blockchain.getWalletBalance(ADDRESS, "ethereum")
    expect(res.data.balance).toBeCloseTo(1, 6)
    expect(res.data.usdBalance).toBeNull()
  })

  it("tracing still succeeds and usdBalance stays null when the price API fails", async () => {
    process.env.TRACECHAIN_PRICE_API_URL = "https://api.coingecko.com/api/v3"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url).includes("simple/price")) return Promise.reject(new Error("price API down"))
        const body = JSON.parse(String(init?.body ?? "{}"))
        if (body.method === "eth_getBalance") return Promise.resolve(rpcOk(hexWei("1000000000000000000")))
        return Promise.resolve(rpcOk(null))
      }),
    )
    const res = await blockchain.getWalletBalance(ADDRESS, "ethereum")
    expect(res.dataSource).not.toBe("MOCK")
    expect(res.data.balance).toBeCloseTo(1, 6)
    expect(res.data.usdBalance).toBeNull()
  })

  it("allows usdBalance to be 0 when the actual wallet balance is zero", async () => {
    vi.stubGlobal("fetch", mockEvmRpc({ balance: "0x0" }))
    const res = await blockchain.getWalletBalance(ADDRESS, "ethereum")
    expect(res.data.balance).toBe(0)
    expect(res.data.usdBalance).toBe(0)
  })

  it("never represents an unavailable valuation as a fabricated 0", async () => {
    vi.stubGlobal("fetch", mockEvmRpc({ balance: hexWei("500000000000000000") }, () => rpcOk(null))) // 0.5 ETH, nonzero
    const res = await blockchain.getWalletBalance(ADDRESS, "ethereum")
    expect(res.data.usdBalance).not.toBe(0)
    expect(res.data.usdBalance).toBeNull()
  })
})

describe("blockchain service — historical price enrichment", () => {
  const ADDRESS = "0x000000000000000000000000000000000000dEaD"

  beforeEach(() => {
    providerCache.clear()
    process.env.TRACECHAIN_PRICE_API_URL = "https://api.coingecko.com/api/v3"
  })
  afterEach(() => {
    delete process.env.TRACECHAIN_PRICE_API_URL
    vi.unstubAllGlobals()
  })

  it("enriches transactions with a successful historical price", async () => {
    vi.stubGlobal(
      "fetch",
      mockSingleTxChain(ADDRESS, "0x1", 1700000000, (url) => {
        if (url.includes("coins/ethereum/history")) {
          return new Response(JSON.stringify({ market_data: { current_price: { usd: 2000 } } }), { status: 200 })
        }
        return rpcOk(null)
      }),
    )
    const res = await blockchain.getTransactions(ADDRESS, "ethereum")
    expect(res.data[0].usdValue).toBeCloseTo(2000, 2)
    expect(res.data[0].priceDataSource).toBe("HISTORICAL_PRICE")
  })

  it("dedupes repeated (asset, day) price lookups to a single upstream call", async () => {
    const priceCalls = { count: 0 }
    vi.stubGlobal(
      "fetch",
      mockEvmRpc(
        {
          balance: "0x0",
          blockNumber: 1,
          getBlock: (blockHex) => {
            const n = Number.parseInt(blockHex, 16)
            if (n === 1) {
              // Three transactions in the same block, same day.
              return {
                timestamp: hexNum(1700000000),
                transactions: [
                  { hash: "0x1", from: "0xa", to: ADDRESS, value: hexWei("1000000000000000000"), blockNumber: hexNum(1) },
                  { hash: "0x2", from: "0xa", to: ADDRESS, value: hexWei("1000000000000000000"), blockNumber: hexNum(1) },
                  { hash: "0x3", from: "0xa", to: ADDRESS, value: hexWei("1000000000000000000"), blockNumber: hexNum(1) },
                ],
              }
            }
            return { timestamp: hexNum(1699999000), transactions: [] }
          },
          logs: [],
        },
        (url) => {
          if (url.includes("coins/ethereum/history")) {
            priceCalls.count++
            return new Response(JSON.stringify({ market_data: { current_price: { usd: 2000 } } }), { status: 200 })
          }
          return rpcOk(null)
        },
      ),
    )
    const res = await blockchain.getTransactions(ADDRESS, "ethereum")
    expect(res.data.every((t) => t.usdValue === 2000)).toBe(true)
    expect(priceCalls.count).toBe(1)
  })

  it("never blocks or fails tracing when the price API fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockSingleTxChain(ADDRESS, "0x1", 1700000000, (url) => {
        if (url.includes("coins/ethereum/history")) throw new Error("price down")
        return rpcOk(null)
      }),
    )
    const res = await blockchain.getTransactions(ADDRESS, "ethereum")
    expect(res.dataSource).not.toBe("MOCK")
    expect(res.data[0].usdValue).toBeNull()
  })
})

describe("blockchain service — cache key correctness", () => {
  const ADDRESS = "0x000000000000000000000000000000000000dEaD"

  beforeEach(() => {
    providerCache.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function txChainMock() {
    return mockSingleTxChain(ADDRESS, "0x1", 1700000000)
  }

  it("repeating the same options hits the cache on the second call", async () => {
    vi.stubGlobal("fetch", txChainMock())
    const first = await blockchain.getTransactions(ADDRESS, "ethereum", { maxTransactions: 10 })
    const second = await blockchain.getTransactions(ADDRESS, "ethereum", { maxTransactions: 10 })
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
  })

  it("different maxTransactions values are cached under different keys (both fetch live)", async () => {
    const mockFetch = txChainMock()
    vi.stubGlobal("fetch", mockFetch)
    const a = await blockchain.getTransactions(ADDRESS, "ethereum", { maxTransactions: 10 })
    const callsAfterFirst = mockFetch.mock.calls.length
    const b = await blockchain.getTransactions(ADDRESS, "ethereum", { maxTransactions: 20 })
    expect(a.cached).toBe(false)
    expect(b.cached).toBe(false)
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it("different offset values are cached under different keys (both fetch live)", async () => {
    const mockFetch = txChainMock()
    vi.stubGlobal("fetch", mockFetch)
    const a = await blockchain.getTransactions(ADDRESS, "ethereum", { offset: 50 })
    const callsAfterFirst = mockFetch.mock.calls.length
    const b = await blockchain.getTransactions(ADDRESS, "ethereum", { offset: 100 })
    expect(a.cached).toBe(false)
    expect(b.cached).toBe(false)
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it("different maxPages values are cached under different keys (both fetch live)", async () => {
    const mockFetch = txChainMock()
    vi.stubGlobal("fetch", mockFetch)
    const a = await blockchain.getTransactions(ADDRESS, "ethereum", { maxPages: 1 })
    const callsAfterFirst = mockFetch.mock.calls.length
    const b = await blockchain.getTransactions(ADDRESS, "ethereum", { maxPages: 5 })
    expect(a.cached).toBe(false)
    expect(b.cached).toBe(false)
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it("different pages are cached under different keys (both fetch live)", async () => {
    const mockFetch = txChainMock()
    vi.stubGlobal("fetch", mockFetch)
    const a = await blockchain.getTransactions(ADDRESS, "ethereum", { page: 1 })
    const callsAfterFirst = mockFetch.mock.calls.length
    const b = await blockchain.getTransactions(ADDRESS, "ethereum", { page: 2 })
    expect(a.cached).toBe(false)
    expect(b.cached).toBe(false)
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it("different date ranges are cached under different keys (both fetch live)", async () => {
    const mockFetch = txChainMock()
    vi.stubGlobal("fetch", mockFetch)
    const a = await blockchain.getTransactions(ADDRESS, "ethereum", { startDate: "2024-01-01", endDate: "2024-06-30" })
    const callsAfterFirst = mockFetch.mock.calls.length
    const b = await blockchain.getTransactions(ADDRESS, "ethereum", { startDate: "2024-07-01", endDate: "2024-12-31" })
    expect(a.cached).toBe(false)
    expect(b.cached).toBe(false)
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it("different chains never share a cache entry for the same address string", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("trongrid")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      const body = JSON.parse(String(init?.body ?? "{}"))
      switch (body.method) {
        case "eth_blockNumber":
          return Promise.resolve(rpcOk(hexNum(0)))
        case "eth_getBlockByNumber":
          return Promise.resolve(rpcOk({ timestamp: hexNum(1700000000), transactions: [] }))
        case "eth_getLogs":
          return Promise.resolve(rpcOk([]))
        default:
          return Promise.resolve(rpcOk(null))
      }
    })
    vi.stubGlobal("fetch", mockFetch)
    const evm = await blockchain.getTransactions(ADDRESS, "ethereum")
    const tron = await blockchain.getTransactions(ADDRESS, "tron")
    expect(evm.cached).toBe(false)
    expect(tron.cached).toBe(false)
  })
})

describe("blockchain service — forensic metadata honesty (no synthetic 'now')", () => {
  const ADDRESS = "0x000000000000000000000000000000000000dEaD"

  beforeEach(() => {
    providerCache.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // A live wallet whose transaction carries NO authoritative timestamp
  // (block.timestamp resolves to "0x0", which classifyTimestamp still
  // treats as a real — if very old — moment; to model a genuinely unknown
  // timestamp we omit the transaction's blockNumber-derived timestamp path
  // entirely by returning a block with an empty transaction list and no
  // matching native transfer, i.e. no timestamped activity at all).
  function stubLiveWalletWithNoActivity() {
    vi.stubGlobal(
      "fetch",
      mockEvmRpc({
        balance: "0x0",
        blockNumber: 1,
        getBlock: () => ({ timestamp: hexNum(1700000000), transactions: [] }),
        logs: [],
      }),
    )
  }

  it("sets firstSeen/lastSeen to null (never the current time) when no transaction activity is known", async () => {
    stubLiveWalletWithNoActivity()
    const inspection = await blockchain.inspectWallet(ADDRESS, "ethereum")
    expect(inspection.dataSource).not.toBe("MOCK")
    expect(inspection.metadata.firstSeen).toBeNull()
    expect(inspection.metadata.lastSeen).toBeNull()
  })

  it("still reports fetchedAt as the current retrieval time (that IS legitimately now)", async () => {
    stubLiveWalletWithNoActivity()
    const before = Date.now()
    const inspection = await blockchain.inspectWallet(ADDRESS, "ethereum")
    const fetchedAtMs = Date.parse(inspection.fetchedAt)
    expect(Number.isFinite(fetchedAtMs)).toBe(true)
    // fetchedAt is a real "now" within a small window of this call.
    expect(fetchedAtMs).toBeGreaterThanOrEqual(before - 1000)
    expect(fetchedAtMs).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it("derives firstSeen/lastSeen from real timestamps when they ARE known", async () => {
    vi.stubGlobal(
      "fetch",
      mockEvmRpc({
        balance: "0x0",
        blockNumber: 2,
        getBlock: (blockHex) => {
          const n = Number.parseInt(blockHex, 16)
          if (n === 2) {
            return {
              timestamp: hexNum(1700000100),
              transactions: [{ hash: "0x2", from: "0xa", to: ADDRESS, value: hexWei("1000000000000000000"), blockNumber: hexNum(2) }],
            }
          }
          if (n === 1) {
            return {
              timestamp: hexNum(1700000000),
              transactions: [{ hash: "0x1", from: "0xa", to: ADDRESS, value: hexWei("1000000000000000000"), blockNumber: hexNum(1) }],
            }
          }
          return { timestamp: hexNum(1699999000), transactions: [] }
        },
        logs: [],
      }),
    )
    const inspection = await blockchain.inspectWallet(ADDRESS, "ethereum")
    expect(inspection.metadata.firstSeen).toBe(new Date(1700000000 * 1000).toISOString())
    expect(inspection.metadata.lastSeen).toBe(new Date(1700000100 * 1000).toISOString())
  })
})
