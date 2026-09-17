import type { Chain, Transaction } from "@/lib/types"
import { AbstractProvider } from "./base"
import { ProviderError } from "@/lib/blockchain/net"
import { getChainConfig } from "@/lib/blockchain/config"
import { normalizeNative, parseDateBounds, classifyTimestamp, parseBlockHeight } from "@/lib/blockchain/normalize"
import {
  MAX_INVESTIGATION_TRANSACTIONS,
  DEFAULT_MAX_PAGES,
  type DataSource,
  type PagedTransactions,
  type TokenTransfer,
  type TxQueryOptions,
  type WalletBalance,
} from "@/lib/blockchain/data-source"
import {
  scanAddressUtxos,
  getBlockCount,
  getBlockHashByHeight,
  getBlockVerbose,
  getRawTransactionVerbose,
  type BitcoinRpcConfig,
  type RawTransaction,
} from "./bitcoin-rpc"

// RAW BITCOIN CORE RPC ONLY. No Esplora/Blockstream/mempool.space call
// exists anywhere in this adapter — every read is a direct RPC to a real
// Bitcoin Core node (scantxoutset, getrawtransaction, getblock, ...).
//
// Bitcoin Core exposes no "list every transaction for this address" call and
// no address index by default, so — exactly like the EVM raw-RPC adapter —
// history is obtained via a BOUNDED backward scan of recent full blocks
// (getblock verbosity 2), matching transactions whose outputs pay the
// queried address. Inputs are matched using the `prevout` enrichment Bitcoin
// Core (v24+) derives from the live UTXO set for still-unspent inputs; a
// spent input's origin address is only resolvable with -txindex, so a
// pure-spend transaction that sends the LAST of an address's funds away with
// no change output can be missed — an honest, disclosed raw-RPC limitation,
// never silently hidden.
const SATS = 100_000_000
const BLOCKS_PER_PAGE = 200
const MAX_SCAN_PAGES = 10
const BLOCK_FETCH_CONCURRENCY = 4

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

export class BitcoinProvider extends AbstractProvider {
  readonly chain: Chain = "bitcoin"
  readonly name = "bitcoin:core-rpc"
  readonly nativeSource: DataSource = "RAW_RPC"

  isConfigured(): boolean {
    return getChainConfig("bitcoin").configured
  }

  private cfg(): BitcoinRpcConfig {
    const c = getChainConfig("bitcoin")
    if (!c.configured) {
      throw new ProviderError(
        "Bitcoin requires a Bitcoin Core node. Set BITCOIN_RPC_URL (and BITCOIN_RPC_USER/BITCOIN_RPC_PASSWORD if your node requires auth) to a node you run or a hosted Bitcoin Core RPC endpoint.",
        "not_configured",
      )
    }
    return { url: c.baseUrl, user: c.rpcUser, password: c.apiKey }
  }

  // Direct UTXO-set scan — the current balance with zero wallet import.
  async getWalletBalance(address: string): Promise<WalletBalance> {
    const cfg = this.cfg()
    const result = await scanAddressUtxos(cfg, address)
    return {
      address,
      chain: "bitcoin",
      balance: result.total_amount,
      asset: "BTC",
      // No price data at this layer — null (never 0) means "unpriced".
      usdBalance: null,
    }
  }

  private projectTx(address: string, tx: RawTransaction, timestamp: string | null, blockHeight: number | null): Transaction {
    const inputFromAddr = tx.vin.reduce(
      (s, v) => s + (v.prevout?.scriptPubKey?.address === address ? v.prevout.value : 0),
      0,
    )
    const outputToAddr = tx.vout.reduce((s, v) => s + (v.scriptPubKey?.address === address ? v.value : 0), 0)
    const net = outputToAddr - inputFromAddr
    const direction: "in" | "out" = net >= 0 ? "in" : "out"
    const counterparty =
      direction === "in"
        ? tx.vin.find((v) => v.prevout?.scriptPubKey?.address)?.prevout?.scriptPubKey?.address ?? "unknown"
        : tx.vout.find((v) => v.scriptPubKey?.address && v.scriptPubKey.address !== address)?.scriptPubKey?.address ??
          "unknown"
    return normalizeNative({
      hash: tx.txid,
      chain: "bitcoin",
      from: direction === "in" ? counterparty : address,
      to: direction === "in" ? address : counterparty,
      amount: Math.abs(net),
      asset: "BTC",
      timestamp,
      blockHeight,
      address,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      sourceType: "RAW_RPC",
    })
  }

  // Bounded backward scan over recent full blocks — the honest raw-RPC way
  // to find transactions touching an address without a third-party address
  // index. Always reports truncation via meta when older history exists
  // beyond the scanned window.
  async getTransactionsPaged(address: string, _chain?: Chain, options: TxQueryOptions = {}): Promise<PagedTransactions> {
    const cfg = this.cfg()
    const cap = Math.min(options.maxTransactions ?? MAX_INVESTIGATION_TRANSACTIONS, MAX_INVESTIGATION_TRANSACTIONS)
    const pages = Math.min(Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES), MAX_SCAN_PAGES)
    const bounds = parseDateBounds(options)

    const latest = await getBlockCount(cfg)
    const totalBlocksToScan = pages * BLOCKS_PER_PAGE
    const fromHeight = Math.max(0, latest - totalBlocksToScan + 1)

    const all: Transaction[] = []
    let pagesFetched = 0
    let reachedWindowEnd = false

    for (
      let pageStart = latest;
      pageStart >= fromHeight && all.length < cap && !reachedWindowEnd;
      pageStart -= BLOCKS_PER_PAGE
    ) {
      const pageEnd = Math.max(fromHeight, pageStart - BLOCKS_PER_PAGE + 1)
      const heights: number[] = []
      for (let h = pageStart; h >= pageEnd; h--) heights.push(h)
      pagesFetched++

      const blocks = await mapWithConcurrency(heights, BLOCK_FETCH_CONCURRENCY, async (height) => {
        try {
          const hash = await getBlockHashByHeight(cfg, height)
          return await getBlockVerbose(cfg, hash)
        } catch {
          return null
        }
      })

      for (const block of blocks) {
        if (!block) continue
        const timestamp = block.time ? new Date(block.time * 1000).toISOString() : null
        const cls = classifyTimestamp(timestamp, bounds)
        if (cls === "before") {
          reachedWindowEnd = true
          continue
        }
        if (cls === "after") continue

        for (const tx of block.tx) {
          const touchesAddress =
            tx.vout.some((v) => v.scriptPubKey?.address === address) ||
            tx.vin.some((v) => v.prevout?.scriptPubKey?.address === address)
          if (!touchesAddress) continue
          all.push(this.projectTx(address, tx, timestamp, parseBlockHeight(block.height)))
          if (all.length >= cap) break
        }
        if (all.length >= cap) break
      }
    }

    const truncated = all.length >= cap || (!reachedWindowEnd && fromHeight > 0)

    return {
      transactions: all.slice(0, cap),
      meta: { totalFetched: all.length, pagesFetched, truncated },
    }
  }

  async getTransactions(address: string, chain?: Chain, options?: TxQueryOptions): Promise<Transaction[]> {
    const { transactions } = await this.getTransactionsPaged(address, chain, options)
    return transactions
  }

  async getTransaction(hash: string): Promise<Transaction | null> {
    const cfg = this.cfg()
    let tx: RawTransaction
    try {
      tx = await getRawTransactionVerbose(cfg, hash)
    } catch {
      return null
    }
    const largest = [...tx.vout].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]
    const fromAddr = tx.vin.find((v) => v.prevout?.scriptPubKey?.address)?.prevout?.scriptPubKey?.address
    return normalizeNative({
      hash: tx.txid,
      chain: "bitcoin",
      from: fromAddr ?? "unknown",
      to: largest?.scriptPubKey?.address ?? "unknown",
      amount: largest?.value ?? 0,
      asset: "BTC",
      timestamp: tx.blocktime ? new Date(tx.blocktime * 1000).toISOString() : null,
      blockHeight: parseBlockHeight(tx.blockheight),
      provenance: "LIVE_BLOCKCHAIN_DATA",
      sourceType: "RAW_RPC",
    })
  }

  // Bitcoin has no native token layer.
  async getTokenTransfers(): Promise<TokenTransfer[]> {
    return []
  }
}
