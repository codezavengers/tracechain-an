import { ProviderError } from "@/lib/blockchain/net"

// Minimal, dependency-free JSON-RPC client for public, keyless EVM nodes
// (see PUBLIC_RPC in config.ts). Used for RPC-first balance reads and
// single-transaction lookups — operations a raw node CAN answer directly,
// unlike historical "list all transactions for this address" queries which
// require an indexer.

interface JsonRpcResponse<T> {
  result?: T
  error?: { code?: number; message?: string }
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new ProviderError(`EVM RPC request failed (${res.status}).`, res.status === 429 ? "rate_limit" : "http", res.status)
    }
    let payload: JsonRpcResponse<T>
    try {
      payload = (await res.json()) as JsonRpcResponse<T>
    } catch {
      throw new ProviderError("EVM RPC returned a malformed response.", "parse")
    }
    if (payload.error) {
      throw new ProviderError(payload.error.message ?? "EVM RPC error.", "http")
    }
    if (payload.result === undefined) {
      throw new ProviderError("EVM RPC returned no result.", "parse")
    }
    return payload.result
  } catch (err) {
    if (err instanceof ProviderError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ProviderError("EVM RPC timed out.", "timeout")
    }
    throw new ProviderError(`EVM RPC network error: ${err instanceof Error ? err.message : "unknown"}.`, "network")
  } finally {
    clearTimeout(timer)
  }
}

export interface RpcTx {
  hash: string
  from: string
  to: string | null
  value: string
  blockNumber: string | null
}

export interface RpcBlock {
  timestamp: string
}

// Direct-from-node balance read (eth_getBalance). Works on every EVM chain
// with zero configuration — no indexer, no API key.
export async function getBalanceViaRpc(rpcUrl: string, address: string): Promise<string> {
  return rpcCall<string>(rpcUrl, "eth_getBalance", [address, "latest"])
}

// Direct-from-node single-transaction read. Historical address-level
// transaction LISTS still require an indexer (see PART 3/4 of the audit) —
// a node has no efficient way to answer "every tx touching this address"
// without scanning the whole chain — but a single known hash is always
// answerable directly by any node.
export async function getTransactionViaRpc(rpcUrl: string, hash: string): Promise<RpcTx | null> {
  const tx = await rpcCall<RpcTx | null>(rpcUrl, "eth_getTransactionByHash", [hash])
  return tx ?? null
}

export async function getBlockTimestampViaRpc(rpcUrl: string, blockNumberHex: string): Promise<string | null> {
  try {
    const block = await rpcCall<RpcBlock | null>(rpcUrl, "eth_getBlockByNumber", [blockNumberHex, false])
    if (!block?.timestamp) return null
    return new Date(Number(BigInt(block.timestamp)) * 1000).toISOString()
  } catch {
    return null
  }
}

// Lightweight reachability/chain-identity probe used by health checks — a
// successful eth_chainId call proves the RPC endpoint is live and reachable
// without touching any wallet data.
export async function getChainIdViaRpc(rpcUrl: string): Promise<string> {
  return rpcCall<string>(rpcUrl, "eth_chainId", [])
}

// Current chain head — the anchor every bounded block-range scan (native tx
// history, token-transfer log scan) walks backwards from.
export async function getBlockNumberViaRpc(rpcUrl: string): Promise<string> {
  return rpcCall<string>(rpcUrl, "eth_blockNumber", [])
}

export interface RpcFullBlock {
  timestamp: string
  transactions: RpcTx[]
}

// Full block body (transactions included) — the primitive a raw node
// exposes for "which transactions touched this block", which is how a
// bounded native-transfer history scan is built without an indexer.
export async function getBlockByNumberFullViaRpc(rpcUrl: string, blockNumberHex: string): Promise<RpcFullBlock | null> {
  const block = await rpcCall<RpcFullBlock | null>(rpcUrl, "eth_getBlockByNumber", [blockNumberHex, true])
  return block ?? null
}

export interface RpcLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  logIndex: string
}

export interface LogFilter {
  fromBlock: string
  toBlock: string
  address?: string
  topics?: (string | null)[]
}

// eth_getLogs — the raw-node primitive used to scan for ERC-20/BEP-20/etc.
// Transfer events over a bounded block range. This is real on-chain log
// data straight from the node, not an indexer's derived table.
export async function getLogsViaRpc(rpcUrl: string, filter: LogFilter): Promise<RpcLog[]> {
  return rpcCall<RpcLog[]>(rpcUrl, "eth_getLogs", [filter])
}

// eth_call — used to read ERC-20 metadata (symbol/decimals/name) directly
// from each token contract via its standard ABI selectors.
export async function ethCallViaRpc(rpcUrl: string, to: string, data: string): Promise<string> {
  return rpcCall<string>(rpcUrl, "eth_call", [{ to, data }, "latest"])
}
