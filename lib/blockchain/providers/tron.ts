import type { Chain, Transaction } from "@/lib/types"
import { AbstractProvider } from "./base"
import { fetchJson, ProviderError } from "@/lib/blockchain/net"
import { getChainConfig } from "@/lib/blockchain/config"
import { tronHexToBase58 } from "@/lib/blockchain/address-utils"
import { normalizeNative, normalizeToken, baseUnitsToDecimal, parseDateBounds, classifyTimestamp } from "@/lib/blockchain/normalize"
import {
  MAX_ROWS_PER_PAGE,
  DEFAULT_MAX_PAGES,
  MAX_INVESTIGATION_TRANSACTIONS,
  type DataSource,
  type PagedTransactions,
  type PagedTokenTransfers,
  type TokenTransfer,
  type TxQueryOptions,
  type WalletBalance,
} from "@/lib/blockchain/data-source"

// TronGrid adapter — TronGrid is TRON's own official full-node HTTP API
// (LIVE_NATIVE_API), the network infrastructure the TRON protocol itself is
// built on, NOT a third-party indexer like Etherscan/Blockscout. It is free
// and keyless for read access, which is why TRON is live by default.
//
// Native TRX transfers come back from /v1/accounts/{addr}/transactions with
// hex (0x41-prefixed) owner/to addresses inside raw_data.contract — decoded
// via tronHexToBase58. TRC-20 transfers come back from the dedicated
// /transactions/trc20 endpoint already base58-encoded.
const SUN_PER_TRX = 1_000_000

// The dedicated TRC-20 transfer list endpoint does not return a block
// number, only a timestamp. Resolving the authoritative block height
// requires a per-transaction /v1/transactions/{id}/info lookup, so this is
// bounded (MAX_BLOCKHEIGHT_LOOKUPS_PER_CALL) and cached (block numbers never
// change once mined) to avoid an unbounded N+1 fan-out against TronGrid.
// Transfers beyond the bound get blockHeight: null — never a fabricated 0.
const trc20BlockHeightCache = new Map<string, number | null>()
const TRC20_BLOCKHEIGHT_CACHE_MAX = 5000
const MAX_BLOCKHEIGHT_LOOKUPS_PER_CALL = 20

interface TronEnvelope<T> {
  data?: T[]
  success?: boolean
  meta?: { fingerprint?: string; links?: { next?: string } }
}

interface TronAccount {
  address?: string
  balance?: number
}

interface TronContractValue {
  amount?: number
  owner_address?: string
  to_address?: string
}

interface TronContract {
  type?: string
  parameter?: { value?: TronContractValue }
}

interface TronTx {
  txID?: string
  block_timestamp?: number
  blockNumber?: number
  ret?: Array<{ contractRet?: string }>
  raw_data?: { contract?: TronContract[] }
}

interface TronTxInfo {
  id?: string
  blockNumber?: number
  blockTimeStamp?: number
}

interface TronTrc20Tx {
  transaction_id?: string
  block_timestamp?: number
  from?: string
  to?: string
  value?: string
  type?: string
  token_info?: { symbol?: string; name?: string; decimals?: number; address?: string }
}

function isSuccessfulTx(tx: TronTx): boolean {
  if (!tx.ret || tx.ret.length === 0) return true
  return tx.ret.some((r) => r.contractRet === "SUCCESS")
}

export class TronProvider extends AbstractProvider {
  readonly chain: Chain = "tron"
  readonly name = "tron:trongrid"
  readonly nativeSource: DataSource = "LIVE_NATIVE_API"

  isConfigured(): boolean {
    return getChainConfig("tron").configured
  }

  private cfg() {
    const cfg = getChainConfig("tron")
    if (!cfg.configured) {
      throw new ProviderError("tron live provider is not configured.", "not_configured")
    }
    return cfg
  }

  private headers(): Record<string, string> {
    const cfg = this.cfg()
    // TronGrid takes the key as a header, never a query param — nothing
    // secret ever ends up in a URL we might log.
    return cfg.apiKey ? { "TRON-PRO-API-KEY": cfg.apiKey } : {}
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const cfg = this.cfg()
    const u = new URL(`${cfg.baseUrl.replace(/\/$/, "")}${path}`)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    return u.toString()
  }

  private direction(address: string, from: string, to: string): "in" | "out" {
    return to.toLowerCase() === address.toLowerCase() ? "in" : "out"
  }

  private nativeTxToTransaction(address: string, tx: TronTx): Transaction | null {
    if (!isSuccessfulTx(tx)) return null
    const contract = tx.raw_data?.contract?.find((c) => c.type === "TransferContract")
    if (!contract?.parameter?.value) return null
    const v = contract.parameter.value
    const from = tronHexToBase58(v.owner_address)
    const to = tronHexToBase58(v.to_address)
    if (!from || !to) return null
    const timestamp = tx.block_timestamp ? new Date(tx.block_timestamp).toISOString() : null
    return normalizeNative({
      hash: tx.txID ?? "",
      chain: "tron",
      from,
      to,
      amount: (v.amount ?? 0) / SUN_PER_TRX,
      asset: "TRX",
      timestamp,
      // TronGrid's transaction-list endpoint always includes blockNumber for
      // confirmed rows; null (never 0) if it is ever genuinely absent.
      blockHeight: tx.blockNumber ?? null,
      address,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      // TronGrid is TRON's own official full-node API — LIVE_NATIVE_API,
      // not a third-party indexer.
      sourceType: "LIVE_NATIVE_API",
    })
  }

  private trc20ToTokenTransfer(t: TronTrc20Tx, address: string, blockHeight: number | null = null): TokenTransfer | null {
    if (!t.transaction_id || !t.from || !t.to) return null
    const decimals = t.token_info?.decimals ?? 6
    return {
      hash: t.transaction_id,
      chain: "tron",
      from: t.from,
      to: t.to,
      tokenSymbol: t.token_info?.symbol || "TOKEN",
      tokenName: t.token_info?.name || "Unknown token",
      tokenAddress: t.token_info?.address || "",
      amount: baseUnitsToDecimal(t.value, decimals),
      decimals,
      timestamp: t.block_timestamp ? new Date(t.block_timestamp).toISOString() : null,
      // Resolved via a bounded/cached lookup below — null (never 0) when the
      // lookup is skipped (budget exhausted) or fails.
      blockHeight,
      direction: this.direction(address, t.from, t.to),
      usdValue: null,
    }
  }

  // Authoritative block-number lookup for a single TRC-20 transfer. Cached
  // module-wide since a mined transaction's block number is immutable.
  private async getTrc20BlockHeight(txHash: string): Promise<number | null> {
    if (trc20BlockHeightCache.has(txHash)) return trc20BlockHeightCache.get(txHash) ?? null

    let result: number | null = null
    try {
      const res = await fetchJson<TronEnvelope<TronTxInfo> | TronTxInfo>(this.url(`/v1/transactions/${txHash}/info`), {
        label: "tron trc20 tx info",
        headers: this.headers(),
        retries: 1,
      })
      const info = Array.isArray((res as TronEnvelope<TronTxInfo>).data)
        ? (res as TronEnvelope<TronTxInfo>).data?.[0]
        : (res as TronTxInfo)
      if (info?.blockNumber) result = info.blockNumber
    } catch {
      result = null
    }

    if (trc20BlockHeightCache.size >= TRC20_BLOCKHEIGHT_CACHE_MAX) trc20BlockHeightCache.clear()
    trc20BlockHeightCache.set(txHash, result)
    return result
  }

  // Paginated native-transaction fetch. TronGrid pages via an opaque
  // `fingerprint` cursor rather than a page number.
  async getTransactionsPaged(address: string, _chain?: Chain, options: TxQueryOptions = {}): Promise<PagedTransactions> {
    const rowsPerPage = Math.min(options.offset ?? MAX_ROWS_PER_PAGE, 200)
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
    const cap = Math.min(options.maxTransactions ?? MAX_INVESTIGATION_TRANSACTIONS, MAX_INVESTIGATION_TRANSACTIONS)
    const bounds = parseDateBounds(options)

    const all: Transaction[] = []
    let fingerprint: string | undefined
    let pagesFetched = 0
    let truncated = false
    let reachedWindowEnd = false

    for (let page = 0; page < maxPages; page++) {
      const params: Record<string, string> = {
        limit: String(rowsPerPage),
        order_by: "block_timestamp,desc",
        only_confirmed: "true",
      }
      if (fingerprint) params.fingerprint = fingerprint

      const res = await fetchJson<TronEnvelope<TronTx>>(this.url(`/v1/accounts/${address}/transactions`, params), {
        label: "tron transactions",
        headers: this.headers(),
      })
      pagesFetched++
      const rows = res.data ?? []
      for (const tx of rows) {
        const t = this.nativeTxToTransaction(address, tx)
        if (!t) continue
        const cls = classifyTimestamp(t.timestamp, bounds)
        if (cls === "after") continue // newer than endDate — keep scanning
        if (cls === "before") {
          // order_by block_timestamp desc → nothing older can match.
          reachedWindowEnd = true
          break
        }
        all.push(t)
        if (all.length >= cap) break
      }

      const next = res.meta?.fingerprint
      if (all.length >= cap) {
        truncated = rows.length > 0 && Boolean(next)
        break
      }
      if (reachedWindowEnd) break
      if (!next || rows.length === 0) break
      fingerprint = next
    }

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
    try {
      const [txRes, infoRes] = await Promise.all([
        fetchJson<TronEnvelope<TronTx>>(this.url(`/v1/transactions/${hash}`), {
          label: "tron transaction",
          headers: this.headers(),
        }),
        fetchJson<TronTxInfo | TronEnvelope<TronTxInfo>>(this.url(`/v1/transactions/${hash}/info`), {
          label: "tron transaction info",
          headers: this.headers(),
          retries: 1,
        }).catch(() => null),
      ])

      const tx = txRes.data?.[0]
      if (!tx) return null
      const contract = tx.raw_data?.contract?.find((c) => c.type === "TransferContract")
      if (!contract?.parameter?.value) return null
      const v = contract.parameter.value

      // Prefer the /info endpoint's block data (authoritative block number +
      // timestamp); fall back to the raw tx's own block_timestamp if info is
      // unavailable, and to null (never "now") if neither resolves.
      let blockNumber: number | null = tx.blockNumber ?? null
      let blockTimeMs: number | null = tx.block_timestamp ?? null
      if (infoRes) {
        const info = Array.isArray((infoRes as TronEnvelope<TronTxInfo>).data)
          ? (infoRes as TronEnvelope<TronTxInfo>).data?.[0]
          : (infoRes as TronTxInfo)
        if (info?.blockNumber) blockNumber = info.blockNumber
        if (info?.blockTimeStamp) blockTimeMs = info.blockTimeStamp
      }

      return normalizeNative({
        hash,
        chain: "tron",
        from: tronHexToBase58(v.owner_address),
        to: tronHexToBase58(v.to_address),
        amount: (v.amount ?? 0) / SUN_PER_TRX,
        asset: "TRX",
        timestamp: blockTimeMs ? new Date(blockTimeMs).toISOString() : null,
        blockHeight: blockNumber,
        provenance: "LIVE_BLOCKCHAIN_DATA",
        sourceType: "LIVE_NATIVE_API",
      })
    } catch {
      return null
    }
  }

  async getWalletBalance(address: string): Promise<WalletBalance> {
    const res = await fetchJson<TronEnvelope<TronAccount>>(this.url(`/v1/accounts/${address}`), {
      label: "tron balance",
      headers: this.headers(),
    })
    const account = res.data?.[0]
    return {
      address,
      chain: "tron",
      balance: (account?.balance ?? 0) / SUN_PER_TRX,
      asset: "TRX",
      // No price data at this layer — null (never 0) means "unpriced";
      // enriched in service.ts when a price provider is configured.
      usdBalance: null,
    }
  }

  // TRC-20 token transfers (USDT and friends). No contract filter is applied
  // by default so every token the wallet touched is surfaced; callers can
  // filter client-side (e.g. to just USDT) using tokenAddress/tokenSymbol.
  async getTokenTransfersPaged(address: string, _chain?: Chain, options: TxQueryOptions = {}): Promise<PagedTokenTransfers> {
    const rowsPerPage = Math.min(options.offset ?? MAX_ROWS_PER_PAGE, 200)
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
    const cap = Math.min(options.maxTransactions ?? MAX_INVESTIGATION_TRANSACTIONS, MAX_INVESTIGATION_TRANSACTIONS)
    const bounds = parseDateBounds(options)

    const all: TokenTransfer[] = []
    let fingerprint: string | undefined
    let pagesFetched = 0
    let truncated = false
    let reachedWindowEnd = false

    for (let page = 0; page < maxPages; page++) {
      const params: Record<string, string> = { limit: String(rowsPerPage), only_confirmed: "true" }
      if (fingerprint) params.fingerprint = fingerprint

      const res = await fetchJson<TronEnvelope<TronTrc20Tx>>(
        this.url(`/v1/accounts/${address}/transactions/trc20`, params),
        { label: "tron trc20 transfers", headers: this.headers() },
      )
      pagesFetched++
      const rows = res.data ?? []
      for (const t of rows) {
        const transfer = this.trc20ToTokenTransfer(t, address)
        if (!transfer) continue
        const cls = classifyTimestamp(transfer.timestamp, bounds)
        if (cls === "after") continue // newer than endDate — keep scanning
        if (cls === "before") {
          // TRC-20 list is returned newest-first, so nothing older can match.
          reachedWindowEnd = true
          break
        }
        all.push(transfer)
        if (all.length >= cap) break
      }

      const next = res.meta?.fingerprint
      if (all.length >= cap) {
        truncated = rows.length > 0 && Boolean(next)
        break
      }
      if (reachedWindowEnd) break
      if (!next || rows.length === 0) break
      fingerprint = next
    }

    // Resolve authoritative block heights for a bounded, deduplicated subset
    // of transfers rather than fabricating 0 or fanning out one lookup per
    // row. Transfers beyond the budget keep blockHeight: null.
    const hashesToResolve = Array.from(new Set(all.map((t) => t.hash))).slice(0, MAX_BLOCKHEIGHT_LOOKUPS_PER_CALL)
    if (hashesToResolve.length > 0) {
      const resolved = await Promise.all(
        hashesToResolve.map(async (hash) => [hash, await this.getTrc20BlockHeight(hash)] as const),
      )
      const byHash = new Map(resolved)
      for (const transfer of all) {
        if (byHash.has(transfer.hash)) transfer.blockHeight = byHash.get(transfer.hash) ?? null
      }
    }

    return { transfers: all.slice(0, cap), meta: { totalFetched: all.length, pagesFetched, truncated } }
  }

  async getTokenTransfers(address: string, chain?: Chain, options?: TxQueryOptions): Promise<TokenTransfer[]> {
    const { transfers } = await this.getTokenTransfersPaged(address, chain, options)
    return transfers
  }
}

// Re-exported so callers that want the normalized Transaction shape for a
// token transfer (rather than the raw TokenTransfer) can reuse the shared
// helper instead of re-deriving it.
export function tronTokenTransferToTransaction(t: TokenTransfer, referenceAddress?: string): Transaction {
  return normalizeToken({
    hash: t.hash,
    chain: t.chain,
    from: t.from,
    to: t.to,
    amount: t.amount,
    asset: t.tokenSymbol,
    tokenAddress: t.tokenAddress,
    timestamp: t.timestamp,
    blockHeight: t.blockHeight,
    address: referenceAddress,
    sourceType: "LIVE_NATIVE_API",
  })
}
