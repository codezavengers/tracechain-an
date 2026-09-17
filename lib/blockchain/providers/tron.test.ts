import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { TronProvider } from "./tron"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

const ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
const OWNER_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c" // -> TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t

describe("TronProvider", () => {
  beforeEach(() => {
    process.env.TRACECHAIN_TRON_API_KEY = "test-key"
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    delete process.env.TRACECHAIN_TRON_API_KEY
    delete process.env.TRACECHAIN_TRON_API_URL
    vi.unstubAllGlobals()
  })

  it("isConfigured stays true with or without an API key (free TronGrid fallback)", () => {
    const provider = new TronProvider()
    expect(provider.isConfigured()).toBe(true)
    delete process.env.TRACECHAIN_TRON_API_KEY
    // TronGrid's public REST API is free and keyless — a key only raises the
    // rate limit, it is never required to go live.
    expect(provider.isConfigured()).toBe(true)
  })

  it("sends the API key as a header, never as a URL query parameter", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ balance: 1_000_000 }] }))
    const provider = new TronProvider()
    await provider.getWalletBalance(ADDRESS)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(String(url)).not.toContain("test-key")
    expect((opts as RequestInit).headers).toMatchObject({ "TRON-PRO-API-KEY": "test-key" })
  })

  it("converts sun to TRX for wallet balance", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ balance: 2_500_000 }] }))
    const provider = new TronProvider()
    const balance = await provider.getWalletBalance(ADDRESS)
    expect(balance.balance).toBeCloseTo(2.5, 6)
    expect(balance.asset).toBe("TRX")
  })

  it("decodes hex owner/to addresses to base58 for native TRX transfers", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            txID: "abc",
            block_timestamp: 1700000000000,
            blockNumber: 500,
            ret: [{ contractRet: "SUCCESS" }],
            raw_data: {
              contract: [
                {
                  type: "TransferContract",
                  parameter: { value: { amount: 1_000_000, owner_address: OWNER_HEX, to_address: OWNER_HEX } },
                },
              ],
            },
          },
        ],
        meta: {},
      }),
    )
    const provider = new TronProvider()
    const { transactions } = await provider.getTransactionsPaged(ADDRESS)
    expect(transactions).toHaveLength(1)
    expect(transactions[0].from).toBe(ADDRESS)
    expect(transactions[0].to).toBe(ADDRESS)
    expect(transactions[0].timestamp).toBe(new Date(1700000000000).toISOString())
  })

  it("paginates using the fingerprint cursor and stops when it disappears", async () => {
    const row = {
      txID: "abc",
      block_timestamp: 1700000000000,
      blockNumber: 500,
      ret: [{ contractRet: "SUCCESS" }],
      raw_data: {
        contract: [
          { type: "TransferContract", parameter: { value: { amount: 1, owner_address: OWNER_HEX, to_address: OWNER_HEX } } },
        ],
      },
    }
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [row], meta: { fingerprint: "next-page" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: {} }))
    const provider = new TronProvider()
    const { meta } = await provider.getTransactionsPaged(ADDRESS)
    expect(meta.pagesFetched).toBe(2)
    const secondCallUrl = String(mockFetch.mock.calls[1][0])
    expect(secondCallUrl).toContain("fingerprint=next-page")
  })

  it("normalizes TRC-20 token transfers with symbol/decimals and never reports usdValue 0", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              transaction_id: "trc1",
              from: "TFrom111111111111111111111111111",
              to: ADDRESS,
              value: "5000000",
              block_timestamp: 1700000000000,
              token_info: { symbol: "USDT", name: "Tether USD", decimals: 6, address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
            },
          ],
          meta: {},
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ blockNumber: 12_345 }))
    const provider = new TronProvider()
    const transfers = await provider.getTokenTransfers(ADDRESS)
    expect(transfers).toHaveLength(1)
    expect(transfers[0].tokenSymbol).toBe("USDT")
    expect(transfers[0].amount).toBeCloseTo(5, 6)
    expect(transfers[0].usdValue).toBeNull()
  })

  it("resolves the authoritative TRC-20 block height via a bounded/cached info lookup", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              transaction_id: "trc-height-1",
              from: "TFrom111111111111111111111111111",
              to: ADDRESS,
              value: "1000000",
              block_timestamp: 1700000000000,
              token_info: { symbol: "USDT", name: "Tether USD", decimals: 6, address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
            },
          ],
          meta: {},
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ blockNumber: 99_999 }))
    const provider = new TronProvider()
    const { transfers } = await provider.getTokenTransfersPaged(ADDRESS)
    expect(transfers[0].blockHeight).toBe(99_999)
  })

  it("never fabricates blockHeight 0 for a TRC-20 transfer when the info lookup fails", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              transaction_id: "trc-height-fail",
              from: "TFrom111111111111111111111111111",
              to: ADDRESS,
              value: "1000000",
              block_timestamp: 1700000000000,
              token_info: { symbol: "USDT", name: "Tether USD", decimals: 6, address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
            },
          ],
          meta: {},
        }),
      )
      .mockRejectedValueOnce(new Error("info lookup failed"))
      .mockRejectedValueOnce(new Error("info lookup failed")) // retry
    const provider = new TronProvider()
    const { transfers } = await provider.getTokenTransfersPaged(ADDRESS)
    expect(transfers[0].blockHeight).toBeNull()
    expect(transfers[0].blockHeight).not.toBe(0)
  })

  it("converts sun-less balance and never reports usdBalance as 0 for a live wallet", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ balance: 3_000_000 }] }))
    const provider = new TronProvider()
    const balance = await provider.getWalletBalance(ADDRESS)
    expect(balance.balance).toBeCloseTo(3, 6)
    expect(balance.usdBalance).toBeNull()
  })

  it("falls back to the demo dataset (via the service layer) when Tron live calls fail — verified by throwing here", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockRejectedValue(new Error("network down"))
    const provider = new TronProvider()
    await expect(provider.getTransactionsPaged(ADDRESS)).rejects.toThrow()
  })

  function nativeRow(txID: string, blockTsMs: number) {
    return {
      txID,
      block_timestamp: blockTsMs,
      blockNumber: 500,
      ret: [{ contractRet: "SUCCESS" }],
      raw_data: {
        contract: [
          { type: "TransferContract", parameter: { value: { amount: 1_000_000, owner_address: OWNER_HEX, to_address: OWNER_HEX } } },
        ],
      },
    }
  }

  const TS_2024_06 = Date.parse("2024-06-01T00:00:00Z")
  const TS_2024_03 = Date.parse("2024-03-01T00:00:00Z")
  const TS_2023_12 = Date.parse("2023-12-01T00:00:00Z")

  it("applies endDate by skipping native transactions newer than the bound", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: [nativeRow("new", TS_2024_06), nativeRow("keep", TS_2024_03)], meta: {} }),
    )
    const provider = new TronProvider()
    const { transactions } = await provider.getTransactionsPaged(ADDRESS, "tron", { endDate: "2024-04-01" })
    expect(transactions.map((t) => t.hash)).toEqual(["keep"])
  })

  it("applies startDate and stops paging at the first older-than-start tx (fingerprint order desc)", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    // fingerprint always present → would loop until maxPages without early-stop.
    mockFetch.mockResolvedValue(
      jsonResponse({ data: [nativeRow("keep", TS_2024_06), nativeRow("old", TS_2023_12)], meta: { fingerprint: "next" } }),
    )
    const provider = new TronProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS, "tron", { startDate: "2024-01-01" })
    expect(transactions.map((t) => t.hash)).toEqual(["keep"])
    expect(meta.truncated).toBe(false)
    expect(meta.pagesFetched).toBe(1)
  })
})
