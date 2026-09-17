import { ProviderError } from "@/lib/blockchain/net"

// Minimal raw JSON-RPC client for a Bitcoin Core node — the ONLY way this
// app talks to Bitcoin. No Esplora/Blockstream/mempool.space indexer call
// exists anywhere in this file or its callers.

export interface BitcoinRpcConfig {
  url: string
  user?: string
  password?: string
}

interface JsonRpcResponse<T> {
  result: T
  error: { code: number; message: string } | null
}

let requestId = 0

export async function bitcoinRpcCall<T>(cfg: BitcoinRpcConfig, method: string, params: unknown[] = []): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (cfg.user || cfg.password) {
    const token = Buffer.from(`${cfg.user ?? ""}:${cfg.password ?? ""}`).toString("base64")
    headers.authorization = `Basic ${token}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  let res: Response
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: ++requestId, method, params }),
      signal: controller.signal,
      cache: "no-store",
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ProviderError(`Bitcoin RPC ${method} timed out.`, "timeout")
    }
    throw new ProviderError(
      `Bitcoin RPC ${method} network error: ${err instanceof Error ? err.message : "unknown"}.`,
      "network",
    )
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401) throw new ProviderError("Bitcoin RPC authentication failed.", "http", 401)
  if (!res.ok) throw new ProviderError(`Bitcoin RPC ${method} failed (${res.status}).`, "http", res.status)

  let payload: JsonRpcResponse<T>
  try {
    payload = await res.json()
  } catch {
    throw new ProviderError(`Bitcoin RPC ${method} returned a malformed response.`, "parse")
  }
  if (payload.error) {
    throw new ProviderError(`Bitcoin RPC ${method} error: ${payload.error.message}`, "http")
  }
  return payload.result
}

// --- scantxoutset: computes a balance/UTXO set for an arbitrary address
// directly from the node's UTXO set, with NO wallet import/rescan required.
export interface ScanTxOutSetResult {
  success: boolean
  total_amount: number
  unspents: Array<{ txid: string; vout: number; amount: number; height: number }>
}

export async function scanAddressUtxos(cfg: BitcoinRpcConfig, address: string): Promise<ScanTxOutSetResult> {
  return bitcoinRpcCall<ScanTxOutSetResult>(cfg, "scantxoutset", ["start", [`addr(${address})`]])
}

export async function getBlockCount(cfg: BitcoinRpcConfig): Promise<number> {
  return bitcoinRpcCall<number>(cfg, "getblockcount")
}

export interface RawTxVin {
  txid?: string
  vout?: number
  prevout?: { value: number; scriptPubKey?: { address?: string } }
}
export interface RawTxVout {
  value: number
  n: number
  scriptPubKey: { address?: string }
}
export interface RawTransaction {
  txid: string
  confirmations?: number
  blockheight?: number
  blocktime?: number
  vin: RawTxVin[]
  vout: RawTxVout[]
}

// verbosity 2 asks Core to resolve each input's prevout (value + address)
// when the node has that data available (requires -txindex for old/pruned
// inputs — Core returns the tx without prevout enrichment if it can't).
export async function getRawTransactionVerbose(cfg: BitcoinRpcConfig, txid: string): Promise<RawTransaction> {
  return bitcoinRpcCall<RawTransaction>(cfg, "getrawtransaction", [txid, 2])
}

export async function getBlockHashByHeight(cfg: BitcoinRpcConfig, height: number): Promise<string> {
  return bitcoinRpcCall<string>(cfg, "getblockhash", [height])
}

export interface RawBlock {
  height: number
  time: number
  tx: RawTransaction[]
}

// verbosity 2 returns full transaction data for every tx in the block.
export async function getBlockVerbose(cfg: BitcoinRpcConfig, hash: string): Promise<RawBlock> {
  return bitcoinRpcCall<RawBlock>(cfg, "getblock", [hash, 2])
}
