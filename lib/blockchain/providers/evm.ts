import type { Chain, Transaction } from "@/lib/types"
import { AbstractProvider } from "./base"
import { ProviderError } from "@/lib/blockchain/net"
import { getChainConfig, NATIVE_ASSET } from "@/lib/blockchain/config"
import {
  getBalanceViaRpc,
  getBlockByNumberFullViaRpc,
  getBlockNumberViaRpc,
  getBlockTimestampViaRpc,
  getLogsViaRpc,
  getTransactionViaRpc,
  ethCallViaRpc,
  type RpcLog,
  type RpcTx,
} from "./evm-rpc"
import {
  normalizeNative,
  baseUnitsToDecimal,
  directionOf,
  parseDateBounds,
  classifyTimestamp,
  parseBlockHeight,
} from "@/lib/blockchain/normalize"
import {
  DEFAULT_MAX_PAGES,
  MAX_INVESTIGATION_TRANSACTIONS,
  type DataSource,
  type PagedTokenTransfers,
  type PagedTransactions,
  type TokenTransfer,
  type TxQueryOptions,
  type WalletBalance,
} from "@/lib/blockchain/data-source"

// RAW-RPC-ONLY EVM adapter. Every read is a direct JSON-RPC call to a chain
// node (see config.ts PUBLIC_RPC / <CHAIN>_RPC_URL) — no third-party
// block-explorer or indexer API is ever contacted.
//
// A raw node has no "list every transaction for this address" call, so
// address-level transaction/token-transfer HISTORY is obtained honestly with
// a BOUNDED backward scan over recent blocks:
//   - Native transfers: fetch full block bodies (eth_getBlockByNumber with
//     `true`) and keep transactions touching the address.
//   - Token transfers: eth_getLogs for the standard ERC-20/BEP-20 `Transfer`
//     event, filtered by the address as either topic[1] (sender) or
//     topic[2] (recipient).
// This means history is limited to the recent-block window actually
// scanned — always reported honestly via `meta.truncated`, never silently
// presented as "the complete history" for an address with older activity.

// Number of blocks scanned per "page" for native-transfer history, and how
// many pages a single request will scan by default / at most.
const NATIVE_BLOCKS_PER_PAGE = 300
const NATIVE_SCAN_CONCURRENCY = 6
const MAX_SCAN_PAGES = 10

// eth_getLogs block-range chunk size and scan bounds for token-transfer
// history (kept below common provider caps on the number of blocks/logs
// returned per call).
const LOG_CHUNK_BLOCKS = 2000
const LOG_SCAN_CONCURRENCY = 4

// keccak256("Transfer(address,address,uint256)") — the standard ERC-20/
// BEP-20 Transfer event topic. A well-known constant, not a secret.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

function toHexBlock(n: number): string {
  return "0x" + Math.max(0, Math.trunc(n)).toString(16)
}

function addressToTopic(address: string): string {
  return "0x" + "0".repeat(24) + address.replace(/^0x/, "").toLowerCase().padStart(40, "0")
}

function addressFromTopic(topic: string): string {
  return "0x" + topic.slice(-40)
}

// Minimal ABI-string decoder for symbol()/name() — handles both the standard
// dynamic `string` return and the legacy fixed `bytes32` return some older
// token contracts use.
function decodeAbiString(hex: string): string | null {
  try {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex
    if (!clean || /^0*$/.test(clean)) return null
    if (clean.length <= 64) {
      const buf = Buffer.from(clean, "hex")
      const str = buf.toString("utf8").replace(/\0+$/, "").trim()
      return str || null
    }
    const length = Number.parseInt(clean.slice(64, 128), 16)
    if (!Number.isFinite(length) || length <= 0) return null
    const dataHex = clean.slice(128, 128 + length * 2)
    const str = Buffer.from(dataHex, "hex").toString("utf8").trim()
    return str || null
  } catch {
    return null
  }
}

function decodeAbiUint(hex: string): number | null {
  try {
    const n = Number(BigInt(hex))
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

interface TokenMetadata {
  symbol: string
  name: string
  decimals: number
}

// Token metadata never changes for a given contract address, so this cache
// never needs a TTL — only a simple size cap.
const tokenMetadataCache = new Map<string, TokenMetadata>()
const TOKEN_METADATA_CACHE_MAX = 2000

// Concurrency-bounded map — avoids firing hundreds of simultaneous RPC calls
// against a public node while still processing a bounded scan quickly.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function dedupeLogs(logs: RpcLog[]): RpcLog[] {
  const seen = new Set<string>()
  const out: RpcLog[] = []
  for (const log of logs) {
    const key = `${log.transactionHash}:${log.logIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(log)
  }
  return out
}

export class EvmProvider extends AbstractProvider {
  readonly nativeSource: DataSource = "RAW_RPC"
  readonly name: string

  constructor(readonly chain: Chain) {
    super()
    this.name = `evm-rpc:${chain}`
  }

  isConfigured(): boolean {
    return getChainConfig(this.chain).configured
  }

  private rpcUrl(): string {
    const cfg = getChainConfig(this.chain)
    if (!cfg.configured) {
      throw new ProviderError(`${this.chain} live provider is not configured.`, "not_configured")
    }
    return cfg.baseUrl
  }

  // RAW_RPC balance read — works with zero configuration for every EVM
  // chain in this app via a free, keyless public node.
  async getWalletBalance(address: string): Promise<WalletBalance> {
    const rpcUrl = this.rpcUrl()
    const wei = await getBalanceViaRpc(rpcUrl, address)
    return {
      address,
      chain: this.chain,
      balance: baseUnitsToDecimal(wei, 18),
      asset: NATIVE_ASSET[this.chain],
      // No price data at this layer — null (never 0) means "unpriced".
      // usdBalance is enriched from a configured price provider in
      // service.ts, which also lets an actually-zero balance stay 0.
      usdBalance: null,
    }
  }

  // A single known transaction hash is always answerable directly by any
  // node — no history enumeration required.
  async getTransaction(hash: string): Promise<Transaction | null> {
    const rpcUrl = this.rpcUrl()
    const tx = await getTransactionViaRpc(rpcUrl, hash)
    if (!tx) return null
    const timestamp = tx.blockNumber ? await getBlockTimestampViaRpc(rpcUrl, tx.blockNumber) : null
    return normalizeNative({
      hash,
      chain: this.chain,
      from: tx.from,
      to: tx.to ?? "",
      amount: baseUnitsToDecimal(tx.value, 18),
      asset: NATIVE_ASSET[this.chain],
      timestamp,
      blockHeight: parseBlockHeight(tx.blockNumber),
      provenance: "LIVE_BLOCKCHAIN_DATA",
      sourceType: "RAW_RPC",
    })
  }

  // Bounded backward scan over recent full block bodies — the honest,
  // raw-RPC way to find native transfers touching an address without an
  // indexer. Always reports truncation via meta when older history exists
  // beyond the scanned window.
  async getTransactionsPaged(
    address: string,
    _chain?: Chain,
    options: TxQueryOptions = {},
  ): Promise<PagedTransactions> {
    const rpcUrl = this.rpcUrl()
    const cap = Math.min(options.maxTransactions ?? MAX_INVESTIGATION_TRANSACTIONS, MAX_INVESTIGATION_TRANSACTIONS)
    const pages = Math.min(Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES), MAX_SCAN_PAGES)
    const asset = NATIVE_ASSET[this.chain]
    const bounds = parseDateBounds(options)
    const addrLower = address.toLowerCase()

    const latest = Number(BigInt(await getBlockNumberViaRpc(rpcUrl)))
    const totalBlocksToScan = pages * NATIVE_BLOCKS_PER_PAGE
    const fromBlock = Math.max(0, latest - totalBlocksToScan + 1)

    const all: Transaction[] = []
    let pagesFetched = 0
    let reachedWindowEnd = false

    for (let pageStart = latest; pageStart >= fromBlock && all.length < cap && !reachedWindowEnd; pageStart -= NATIVE_BLOCKS_PER_PAGE) {
      const pageEnd = Math.max(fromBlock, pageStart - NATIVE_BLOCKS_PER_PAGE + 1)
      const blockNumbers: number[] = []
      for (let b = pageStart; b >= pageEnd; b--) blockNumbers.push(b)

      const blocks = await mapWithConcurrency(blockNumbers, NATIVE_SCAN_CONCURRENCY, async (bn) => {
        try {
          return await getBlockByNumberFullViaRpc(rpcUrl, toHexBlock(bn))
        } catch {
          return null
        }
      })
      pagesFetched++

      for (const block of blocks) {
        if (!block) continue
        const timestamp = block.timestamp ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() : null
        const cls = classifyTimestamp(timestamp, bounds)
        if (cls === "before") {
          reachedWindowEnd = true
          continue
        }
        if (cls === "after") continue
        for (const tx of block.transactions as RpcTx[]) {
          if (!tx.to) continue // contract creation — no simple address match
          const from = tx.from?.toLowerCase()
          const to = tx.to?.toLowerCase()
          if (from !== addrLower && to !== addrLower) continue
          let value: bigint
          try {
            value = BigInt(tx.value ?? "0x0")
          } catch {
            continue
          }
          if (value === BigInt(0)) continue // skip zero-value contract calls
          all.push(
            normalizeNative({
              hash: tx.hash,
              chain: this.chain,
              from: tx.from,
              to: tx.to,
              amount: baseUnitsToDecimal(tx.value, 18),
              asset,
              timestamp,
              blockHeight: parseBlockHeight(tx.blockNumber),
              address,
              provenance: "LIVE_BLOCKCHAIN_DATA",
              sourceType: "RAW_RPC",
            }),
          )
          if (all.length >= cap) break
        }
        if (all.length >= cap) break
      }
    }

    // Truncated whenever the cap was hit, or the scan window didn't reach
    // genesis without first completing the requested date window.
    const truncated = all.length >= cap || (!reachedWindowEnd && fromBlock > 0)

    return {
      transactions: all.slice(0, cap),
      meta: { totalFetched: all.length, pagesFetched, truncated },
    }
  }

  async getTransactions(address: string, chain?: Chain, options?: TxQueryOptions): Promise<Transaction[]> {
    const { transactions } = await this.getTransactionsPaged(address, chain, options)
    return transactions
  }

  private async getTokenMetadata(rpcUrl: string, tokenAddress: string): Promise<TokenMetadata> {
    const key = `${this.chain}:${tokenAddress.toLowerCase()}`
    const cached = tokenMetadataCache.get(key)
    if (cached) return cached

    const [symbolHex, nameHex, decimalsHex] = await Promise.all([
      ethCallViaRpc(rpcUrl, tokenAddress, "0x95d89b41").catch(() => null), // symbol()
      ethCallViaRpc(rpcUrl, tokenAddress, "0x06fdde03").catch(() => null), // name()
      ethCallViaRpc(rpcUrl, tokenAddress, "0x313ce567").catch(() => null), // decimals()
    ])

    const meta: TokenMetadata = {
      symbol: (symbolHex && decodeAbiString(symbolHex)) || "TOKEN",
      name: (nameHex && decodeAbiString(nameHex)) || "Unknown token",
      decimals: (decimalsHex && decodeAbiUint(decimalsHex)) ?? 18,
    }

    if (tokenMetadataCache.size >= TOKEN_METADATA_CACHE_MAX) tokenMetadataCache.clear()
    tokenMetadataCache.set(key, meta)
    return meta
  }

  // Bounded backward eth_getLogs scan for the standard ERC-20/BEP-20
  // Transfer event — real on-chain log data straight from the node, never a
  // third-party indexer's derived table.
  async getTokenTransfersPaged(
    address: string,
    _chain?: Chain,
    options: TxQueryOptions = {},
  ): Promise<PagedTokenTransfers> {
    const rpcUrl = this.rpcUrl()
    const cap = Math.min(options.maxTransactions ?? MAX_INVESTIGATION_TRANSACTIONS, MAX_INVESTIGATION_TRANSACTIONS)
    const pages = Math.min(Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES), MAX_SCAN_PAGES)
    const bounds = parseDateBounds(options)
    const addrTopic = addressToTopic(address)

    const latest = Number(BigInt(await getBlockNumberViaRpc(rpcUrl)))
    const totalBlocksToScan = pages * LOG_CHUNK_BLOCKS
    const fromBlock = Math.max(0, latest - totalBlocksToScan + 1)

    const all: TokenTransfer[] = []
    let pagesFetched = 0
    let reachedWindowEnd = false

    for (
      let chunkEnd = latest;
      chunkEnd >= fromBlock && all.length < cap && !reachedWindowEnd;
      chunkEnd -= LOG_CHUNK_BLOCKS
    ) {
      const chunkStart = Math.max(fromBlock, chunkEnd - LOG_CHUNK_BLOCKS + 1)
      pagesFetched++

      let logs: RpcLog[]
      try {
        const [asSender, asRecipient] = await Promise.all([
          getLogsViaRpc(rpcUrl, {
            fromBlock: toHexBlock(chunkStart),
            toBlock: toHexBlock(chunkEnd),
            topics: [TRANSFER_TOPIC, addrTopic, null],
          }),
          getLogsViaRpc(rpcUrl, {
            fromBlock: toHexBlock(chunkStart),
            toBlock: toHexBlock(chunkEnd),
            topics: [TRANSFER_TOPIC, null, addrTopic],
          }),
        ])
        logs = dedupeLogs([...asSender, ...asRecipient])
      } catch {
        continue // skip an unreachable chunk rather than aborting the whole scan
      }

      const uniqueBlocks = [...new Set(logs.map((l) => l.blockNumber))]
      const timestamps = await mapWithConcurrency(uniqueBlocks, LOG_SCAN_CONCURRENCY, (bn) =>
        getBlockTimestampViaRpc(rpcUrl, bn).catch(() => null),
      )
      const timestampByBlock = new Map(uniqueBlocks.map((bn, i) => [bn, timestamps[i]]))

      logs.sort((a, b) => Number(BigInt(b.blockNumber)) - Number(BigInt(a.blockNumber)))

      for (const log of logs) {
        if (log.topics.length < 3) continue
        const timestamp = timestampByBlock.get(log.blockNumber) ?? null
        const cls = classifyTimestamp(timestamp, bounds)
        if (cls === "after") continue
        if (cls === "before") {
          reachedWindowEnd = true
          continue
        }
        const from = addressFromTopic(log.topics[1])
        const to = addressFromTopic(log.topics[2])
        const meta = await this.getTokenMetadata(rpcUrl, log.address)
        all.push({
          hash: log.transactionHash,
          chain: this.chain,
          from,
          to,
          tokenSymbol: meta.symbol,
          tokenName: meta.name,
          tokenAddress: log.address,
          amount: baseUnitsToDecimal(log.data, meta.decimals),
          decimals: meta.decimals,
          timestamp,
          blockHeight: parseBlockHeight(log.blockNumber),
          direction: directionOf(address, from, to),
          usdValue: null,
        })
        if (all.length >= cap) break
      }
    }

    const truncated = all.length >= cap || (!reachedWindowEnd && fromBlock > 0)

    return {
      transfers: all.slice(0, cap),
      meta: { totalFetched: all.length, pagesFetched, truncated },
    }
  }

  async getTokenTransfers(address: string, chain?: Chain, options?: TxQueryOptions): Promise<TokenTransfer[]> {
    const { transfers } = await this.getTokenTransfersPaged(address, chain, options)
    return transfers
  }
}

// Named subclasses matching the adapter architecture. Each binds the shared
// raw-RPC logic to a specific network's configured JSON-RPC endpoint.
export class EthereumProvider extends EvmProvider {
  constructor() {
    super("ethereum")
  }
}
export class PolygonProvider extends EvmProvider {
  constructor() {
    super("polygon")
  }
}
export class BSCProvider extends EvmProvider {
  constructor() {
    super("bsc")
  }
}

export class ArbitrumProvider extends EvmProvider {
  constructor() {
    super("arbitrum")
  }
}

export class OptimismProvider extends EvmProvider {
  constructor() {
    super("optimism")
  }
}

export class BaseProvider extends EvmProvider {
  constructor() {
    super("base")
  }
}

export class AvalancheProvider extends EvmProvider {
  constructor() {
    super("avalanche")
  }
}
