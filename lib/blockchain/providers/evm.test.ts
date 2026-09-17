import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EthereumProvider } from "./evm"

function rpcResponse(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function hexBytes32FromAscii(text: string): string {
  const hex = Buffer.from(text, "utf8").toString("hex")
  return "0x" + hex.padEnd(64, "0")
}

const ADDRESS = "0x000000000000000000000000000000000000dEaD"
const ADDRESS_LOWER = ADDRESS.toLowerCase()

describe("EvmProvider (Ethereum) — raw RPC only", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("is configured with zero environment variables via the free public RPC endpoint", () => {
    const provider = new EthereumProvider()
    expect(provider.isConfigured()).toBe(true)
  })

  it("getTransaction resolves the real block timestamp via eth_getBlockByNumber, never 'now'", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(
        rpcResponse({ hash: "0xhash", from: "0xa", to: "0xb", value: "0xde0b6b3a7640000", blockNumber: "0x64" }),
      )
      .mockResolvedValueOnce(rpcResponse({ timestamp: "0x60000000" }))

    const provider = new EthereumProvider()
    const tx = await provider.getTransaction("0xhash")
    expect(tx).not.toBeNull()
    expect(tx?.timestamp).toBe(new Date(Number(0x60000000) * 1000).toISOString())
    expect(tx?.amount).toBeCloseTo(1, 6)
    expect(tx?.blockHeight).toBe(0x64)
  })

  it("getTransaction returns a null timestamp (never 'now') when the block lookup fails", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(
        rpcResponse({ hash: "0xhash", from: "0xa", to: "0xb", value: "0x1", blockNumber: "0x65" }),
      )
      .mockRejectedValueOnce(new Error("block lookup failed"))

    const provider = new EthereumProvider()
    const tx = await provider.getTransaction("0xhash")
    expect(tx?.timestamp).toBeNull()
  })

  it("returns a null (never 0) blockHeight when a transaction's block number cannot be parsed", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(rpcResponse({ from: "0xa", to: "0xb", value: "0x1", blockNumber: null }))
    const provider = new EthereumProvider()
    const tx = await provider.getTransaction("0xhash-noblock")
    expect(tx?.blockHeight).toBeNull()
    expect(tx?.blockHeight).not.toBe(0)
    expect(tx?.timestamp).toBeNull()
  })

  it("never reports usdBalance as 0 for a live non-zero wallet balance — null when unpriced", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(rpcResponse("0xde0b6b3a7640000"))
    const provider = new EthereumProvider()
    const balance = await provider.getWalletBalance(ADDRESS)
    expect(balance.balance).toBeCloseTo(1, 6)
    expect(balance.usdBalance).toBeNull()
    expect(balance.usdBalance).not.toBe(0)
  })

  it("getWalletBalance reads directly via eth_getBalance with no indexer involved", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(rpcResponse("0x0"))
    const provider = new EthereumProvider()
    const balance = await provider.getWalletBalance(ADDRESS)
    expect(balance.balance).toBe(0)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body))
    expect(body.method).toBe("eth_getBalance")
  })

  it("getTransactionsPaged scans recent full blocks for native transfers touching the address", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    const makeBlock = (blockNumber: number, hash: string) =>
      rpcResponse({
        timestamp: "0x60000000",
        transactions: [
          {
            hash,
            from: "0xsender",
            to: ADDRESS_LOWER,
            value: "0x1",
            blockNumber: "0x" + blockNumber.toString(16),
          },
        ],
      })

    mockFetch
      .mockResolvedValueOnce(rpcResponse("0x2")) // eth_blockNumber -> latest = 2
      .mockResolvedValueOnce(makeBlock(2, "0xtx2"))
      .mockResolvedValueOnce(makeBlock(1, "0xtx1"))
      .mockResolvedValueOnce(makeBlock(0, "0xtx0"))

    const provider = new EthereumProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS)
    expect(transactions).toHaveLength(3)
    expect(meta.pagesFetched).toBe(1)
    // The scan reached genesis (block 0) without hitting the cap, so this is
    // a complete result, not a truncated one.
    expect(meta.truncated).toBe(false)
  })

  it("marks the result truncated once the investigation cap is hit mid-scan", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    const makeBlock = (blockNumber: number, hash: string) =>
      rpcResponse({
        timestamp: "0x60000000",
        transactions: [{ hash, from: "0xsender", to: ADDRESS_LOWER, value: "0x1", blockNumber: "0x" + blockNumber.toString(16) }],
      })

    mockFetch
      .mockResolvedValueOnce(rpcResponse("0x2"))
      .mockResolvedValueOnce(makeBlock(2, "0xtx2"))
      .mockResolvedValueOnce(makeBlock(1, "0xtx1"))
      .mockResolvedValueOnce(makeBlock(0, "0xtx0"))

    const provider = new EthereumProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS, "ethereum", { maxTransactions: 1 })
    expect(transactions.length).toBeLessThanOrEqual(1)
    expect(meta.truncated).toBe(true)
  })

  it("getTokenTransfersPaged decodes an ERC-20 Transfer log via eth_getLogs and eth_call metadata", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    const addrTopic = "0x" + "0".repeat(24) + ADDRESS_LOWER.replace(/^0x/, "")
    const log = {
      address: "0xtoken000000000000000000000000000000000",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x" + "0".repeat(60) + "aaaa",
        addrTopic,
      ],
      data: "0x" + "0".repeat(62) + "01",
      blockNumber: "0x64",
      transactionHash: "0xtokentx",
      logIndex: "0x0",
    }

    mockFetch
      .mockResolvedValueOnce(rpcResponse("0x64")) // eth_blockNumber
      .mockResolvedValueOnce(rpcResponse([log])) // logs where address is recipient (topics[2])
      .mockResolvedValueOnce(rpcResponse([])) // logs where address is sender (topics[1])
      .mockResolvedValueOnce(rpcResponse({ timestamp: "0x60000000" })) // block timestamp
      .mockResolvedValueOnce(rpcResponse(hexBytes32FromAscii("TKN"))) // symbol()
      .mockResolvedValueOnce(rpcResponse(hexBytes32FromAscii("Token Coin"))) // name()
      .mockResolvedValueOnce(rpcResponse("0x6")) // decimals() = 6

    const provider = new EthereumProvider()
    const { transfers, meta } = await provider.getTokenTransfersPaged(ADDRESS)
    expect(transfers).toHaveLength(1)
    expect(transfers[0].tokenSymbol).toBe("TKN")
    expect(transfers[0].tokenName).toBe("Token Coin")
    expect(transfers[0].decimals).toBe(6)
    expect(transfers[0].amount).toBeCloseTo(0.000001, 9)
    expect(transfers[0].direction).toBe("in")
    expect(meta.truncated).toBe(false)
  })
})
