import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { BitcoinProvider } from "./bitcoin"

const ADDRESS = "bc1qaddresstest0000000000000000000000000"

// Stubs `fetch` as a tiny fake Bitcoin Core JSON-RPC server: the handler
// receives (method, params) for every RPC call, regardless of ordering, and
// returns whatever `result` the real node would.
function stubBitcoinRpc(handler: (method: string, params: unknown[]) => unknown) {
  const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
  mockFetch.mockImplementation(async (_url: string, opts: { body?: string }) => {
    const body = JSON.parse(String(opts?.body))
    let result: unknown
    let error: { code: number; message: string } | null = null
    try {
      result = handler(body.method, body.params)
    } catch (e) {
      error = { code: -1, message: e instanceof Error ? e.message : "rpc error" }
    }
    return new Response(JSON.stringify({ result, error }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })
}

function makeTx(txid: string, opts: { toAddress?: string; toValue?: number; height?: number }) {
  return {
    txid,
    vin: [] as unknown[],
    vout: opts.toAddress ? [{ value: opts.toValue ?? 0.001, n: 0, scriptPubKey: { address: opts.toAddress } }] : [],
  }
}

describe("BitcoinProvider — raw Bitcoin Core RPC only", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
    delete process.env.BITCOIN_RPC_URL
    delete process.env.BITCOIN_RPC_USER
    delete process.env.BITCOIN_RPC_PASSWORD
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.BITCOIN_RPC_URL
  })

  it("is NOT configured without a real Bitcoin Core node (no free public Bitcoin RPC exists)", () => {
    expect(new BitcoinProvider().isConfigured()).toBe(false)
  })

  it("becomes configured once BITCOIN_RPC_URL is set", () => {
    process.env.BITCOIN_RPC_URL = "http://localhost:8332"
    expect(new BitcoinProvider().isConfigured()).toBe(true)
  })

  it("getWalletBalance reads the live UTXO set via scantxoutset — never 0 misreported as unpriced", async () => {
    process.env.BITCOIN_RPC_URL = "http://localhost:8332"
    stubBitcoinRpc((method) => {
      if (method === "scantxoutset") return { success: true, total_amount: 0.5, unspents: [] }
      throw new Error("unexpected method " + method)
    })
    const provider = new BitcoinProvider()
    const balance = await provider.getWalletBalance(ADDRESS)
    expect(balance.balance).toBe(0.5)
    expect(balance.usdBalance).toBeNull()
    expect(balance.usdBalance).not.toBe(0)
  })

  it("getTransaction decodes a real transaction via getrawtransaction verbosity 2", async () => {
    process.env.BITCOIN_RPC_URL = "http://localhost:8332"
    stubBitcoinRpc((method) => {
      if (method === "getrawtransaction") {
        return {
          txid: "0xhash",
          blockheight: 800000,
          blocktime: 1700000000,
          vin: [],
          vout: [{ value: 0.25, n: 0, scriptPubKey: { address: "bc1recipient" } }],
        }
      }
      throw new Error("unexpected method " + method)
    })
    const provider = new BitcoinProvider()
    const tx = await provider.getTransaction("0xhash")
    expect(tx?.amount).toBe(0.25)
    expect(tx?.to).toBe("bc1recipient")
    expect(tx?.timestamp).toBe(new Date(1700000000 * 1000).toISOString())
    expect(tx?.blockHeight).toBe(800000)
  })

  it("getTransaction returns null (never throws) when the node cannot find the tx", async () => {
    process.env.BITCOIN_RPC_URL = "http://localhost:8332"
    stubBitcoinRpc((method) => {
      if (method === "getrawtransaction") throw new Error("No such mempool or blockchain transaction")
      throw new Error("unexpected method " + method)
    })
    const provider = new BitcoinProvider()
    const tx = await provider.getTransaction("0xmissing")
    expect(tx).toBeNull()
  })

  it("getTransactionsPaged scans recent full blocks for outputs paying the address", async () => {
    process.env.BITCOIN_RPC_URL = "http://localhost:8332"
    stubBitcoinRpc((method, params) => {
      if (method === "getblockcount") return 0
      if (method === "getblockhash") return "hash" + params[0]
      if (method === "getblock") {
        return {
          height: 0,
          time: 1700000000,
          tx: [makeTx("t1", { toAddress: ADDRESS, toValue: 0.1 }), makeTx("t2", { toAddress: "bc1other", toValue: 0.2 })],
        }
      }
      throw new Error("unexpected method " + method)
    })
    const provider = new BitcoinProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS)
    expect(transactions).toHaveLength(1)
    expect(transactions[0].hash).toBe("t1")
    expect(transactions[0].amount).toBe(0.1)
    // Scan reached genesis (height 0) without hitting the cap — complete, not truncated.
    expect(meta.truncated).toBe(false)
  })

  it("marks the result truncated once the investigation cap is hit mid-scan", async () => {
    process.env.BITCOIN_RPC_URL = "http://localhost:8332"
    stubBitcoinRpc((method, params) => {
      if (method === "getblockcount") return 0
      if (method === "getblockhash") return "hash" + params[0]
      if (method === "getblock") {
        return {
          height: 0,
          time: 1700000000,
          tx: [makeTx("t1", { toAddress: ADDRESS }), makeTx("t2", { toAddress: ADDRESS })],
        }
      }
      throw new Error("unexpected method " + method)
    })
    const provider = new BitcoinProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS, "bitcoin", { maxTransactions: 1 })
    expect(transactions.length).toBeLessThanOrEqual(1)
    expect(meta.truncated).toBe(true)
  })

  it("returns no token transfers (Bitcoin has no token layer)", async () => {
    const provider = new BitcoinProvider()
    expect(await provider.getTokenTransfers()).toEqual([])
  })

  it("never reports blockHeight as 0 when the node returns no height", async () => {
    process.env.BITCOIN_RPC_URL = "http://localhost:8332"
    stubBitcoinRpc((method) => {
      if (method === "getrawtransaction") {
        return { txid: "0xhash", blockheight: null, blocktime: null, vin: [], vout: [{ value: 0.1, n: 0, scriptPubKey: { address: "bc1x" } }] }
      }
      throw new Error("unexpected method " + method)
    })
    const provider = new BitcoinProvider()
    const tx = await provider.getTransaction("0xhash")
    expect(tx?.blockHeight).toBeNull()
    expect(tx?.blockHeight).not.toBe(0)
    expect(tx?.timestamp).toBeNull()
  })

  const TS_2024_06 = Math.floor(Date.parse("2024-06-01T00:00:00Z") / 1000)
  const TS_2024_03 = Math.floor(Date.parse("2024-03-01T00:00:00Z") / 1000)
  const TS_2024_02 = Math.floor(Date.parse("2024-02-01T00:00:00Z") / 1000)
  const TS_2023_12 = Math.floor(Date.parse("2023-12-01T00:00:00Z") / 1000)

  it("applies endDate by skipping blocks newer than the bound", async () => {
    process.env.BITCOIN_RPC_URL = "http://localhost:8332"
    const heightToTime = new Map<number, number>([
      [2, TS_2024_06],
      [1, TS_2024_03],
      [0, TS_2024_02],
    ])
    const hashToHeight = new Map<string, number>([["h2", 2], ["h1", 1], ["h0", 0]])
    stubBitcoinRpc((method, params) => {
      if (method === "getblockcount") return 2
      if (method === "getblockhash") return "h" + params[0]
      if (method === "getblock") {
        const h = hashToHeight.get(params[0] as string)!
        return { height: h, time: heightToTime.get(h), tx: [makeTx("tx" + h, { toAddress: ADDRESS })] }
      }
      throw new Error("unexpected method " + method)
    })
    const provider = new BitcoinProvider()
    const { transactions } = await provider.getTransactionsPaged(ADDRESS, "bitcoin", { endDate: "2024-04-01" })
    expect(transactions.map((t) => t.hash)).toEqual(["tx1", "tx0"])
  })

  it("applies startDate and stops scanning once an older-than-start block appears", async () => {
    process.env.BITCOIN_RPC_URL = "http://localhost:8332"
    const heightToTime = new Map<number, number>([
      [1, TS_2024_06],
      [0, TS_2023_12],
    ])
    stubBitcoinRpc((method, params) => {
      if (method === "getblockcount") return 1
      if (method === "getblockhash") return "h" + params[0]
      if (method === "getblock") {
        const h = params[0] === "h1" ? 1 : 0
        return { height: h, time: heightToTime.get(h), tx: [makeTx("tx" + h, { toAddress: ADDRESS })] }
      }
      throw new Error("unexpected method " + method)
    })
    const provider = new BitcoinProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS, "bitcoin", { startDate: "2024-01-01" })
    expect(transactions.map((t) => t.hash)).toEqual(["tx1"])
    expect(meta.truncated).toBe(false)
    expect(meta.pagesFetched).toBe(1)
  })
})
