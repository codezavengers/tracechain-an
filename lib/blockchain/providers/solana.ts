import type { Chain, Transaction } from "@/lib/types"
import { AbstractProvider } from "./base"
import { ProviderError } from "@/lib/blockchain/net"
import { getChainConfig, NATIVE_ASSET } from "@/lib/blockchain/config"
import { normalizeNative, parseDateBounds, classifyTimestamp } from "@/lib/blockchain/normalize"
import {
  MAX_INVESTIGATION_TRANSACTIONS,
  type DataSource,
  type PagedTransactions,
  type TokenTransfer,
  type TxQueryOptions,
  type WalletBalance,
} from "@/lib/blockchain/data-source"

interface SolanaResponse<T> {
  result?: T
  error?: { message?: string }
}

interface SolanaSignatureInfo {
  signature: string
  slot: number
  blockTime: number | null
  err: unknown
}

interface SolanaParsedAccountKey {
  pubkey: string
}

interface SolanaParsedTransaction {
  slot: number
  blockTime: number | null
  meta?: {
    err: unknown
    preBalances?: number[]
    postBalances?: number[]
  }
  transaction?: {
    message?: {
      accountKeys?: SolanaParsedAccountKey[]
    }
  }
}

const LAMPORTS_PER_SOL = 1_000_000_000
// The public mainnet-beta RPC is aggressively rate-limited for a single IP
// (roughly tens of requests / 10s), and getSignaturesForAddress + one
// getTransaction call per signature is the ONLY way to reconstruct native
// SOL transfer history without a paid indexer — so history retrieval here is
// intentionally small and sequential rather than the wide/parallel pages
// used by the EVM/Bitcoin/Tron adapters (PART 15 — avoid excessive calls).
const SOLANA_ROWS_PER_PAGE = 20
const SOLANA_MAX_PAGES = 2
const SOLANA_TX_FETCH_DELAY_MS = 120

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export class SolanaProvider extends AbstractProvider {
  readonly chain: Chain = "solana"
  readonly name = "solana:rpc"
  readonly nativeSource: DataSource = "RAW_RPC"

  isConfigured(): boolean {
    return getChainConfig(this.chain).configured
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const cfg = getChainConfig(this.chain)
    if (!cfg.configured) throw new ProviderError("Solana RPC is not configured.", "not_configured")
    const response = await fetch(cfg.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { "x-api-key": cfg.apiKey } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    })
    if (!response.ok) throw new ProviderError(`Solana RPC request failed (${response.status}).`, "http", response.status)
    const payload = (await response.json()) as SolanaResponse<T>
    if (payload.error) throw new ProviderError(payload.error.message ?? "Solana RPC error.", "http")
    if (payload.result === undefined) throw new ProviderError("Solana RPC returned no result.", "parse")
    return payload.result
  }

  async getWalletBalance(address: string): Promise<WalletBalance> {
    const result = await this.rpc<{ value: number }>("getBalance", [address])
    return {
      address,
      chain: this.chain,
      balance: (result.value ?? 0) / LAMPORTS_PER_SOL,
      asset: NATIVE_ASSET.solana,
      usdBalance: null,
    }
  }

  // Projects a parsed Solana transaction onto the same simplified
  // {from,to,amount} shape the Bitcoin adapter uses for UTXO transactions —
  // net lamport change for the queried address, with the largest
  // opposite-direction balance change picked as the counterparty.
  private projectTx(address: string, signature: string, tx: SolanaParsedTransaction): Transaction | null {
    const keys = tx.transaction?.message?.accountKeys
    const pre = tx.meta?.preBalances
    const post = tx.meta?.postBalances
    if (!keys || !pre || !post) return null
    const idx = keys.findIndex((k) => k.pubkey === address)
    if (idx === -1 || pre[idx] === undefined || post[idx] === undefined) return null

    const net = post[idx] - pre[idx]
    const direction: "in" | "out" = net >= 0 ? "in" : "out"

    let counterpartyIdx = -1
    let counterpartyDelta = 0
    for (let i = 0; i < keys.length; i++) {
      if (i === idx) continue
      const delta = (post[i] ?? 0) - (pre[i] ?? 0)
      // Opposite sign from the queried address's own change, largest magnitude.
      if ((direction === "in" && delta < counterpartyDelta) || (direction === "out" && delta > counterpartyDelta)) {
        counterpartyDelta = delta
        counterpartyIdx = i
      }
    }
    const counterparty = counterpartyIdx >= 0 ? keys[counterpartyIdx].pubkey : "unknown"

    return normalizeNative({
      hash: signature,
      chain: "solana",
      from: direction === "in" ? counterparty : address,
      to: direction === "in" ? address : counterparty,
      amount: Math.abs(net) / LAMPORTS_PER_SOL,
      asset: "SOL",
      timestamp: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
      blockHeight: tx.slot ?? null,
      provenance: "LIVE_BLOCKCHAIN_DATA",
      // getSignaturesForAddress/getTransaction are native Solana JSON-RPC
      // methods — no separate indexer is involved.
      sourceType: "RAW_RPC",
    })
  }

  // Native SOL transaction history: getSignaturesForAddress (paginated via a
  // "before" signature cursor) followed by one getTransaction call per
  // signature. Intentionally bounded/sequential — see the rate-limit note on
  // the constants above.
  async getTransactionsPaged(address: string, _chain?: Chain, options: TxQueryOptions = {}): Promise<PagedTransactions> {
    const rowsPerPage = Math.min(options.offset ?? SOLANA_ROWS_PER_PAGE, SOLANA_ROWS_PER_PAGE)
    const maxPages = Math.min(options.maxPages ?? SOLANA_MAX_PAGES, SOLANA_MAX_PAGES)
    const cap = Math.min(options.maxTransactions ?? MAX_INVESTIGATION_TRANSACTIONS, MAX_INVESTIGATION_TRANSACTIONS)
    const bounds = parseDateBounds(options)

    const all: Transaction[] = []
    let pagesFetched = 0
    let totalSigsSeen = 0
    let truncated = false
    let reachedWindowEnd = false
    let before: string | undefined

    for (let page = 0; page < maxPages; page++) {
      const params: [string, Record<string, unknown>] = [
        address,
        before ? { limit: rowsPerPage, before } : { limit: rowsPerPage },
      ]
      const signatures = await this.rpc<SolanaSignatureInfo[]>("getSignaturesForAddress", params)
      pagesFetched++
      if (signatures.length === 0) break
      totalSigsSeen += signatures.length

      for (const sig of signatures) {
        if (sig.err) continue // skip failed transactions — not a real fund movement
        const ts = sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : null
        const cls = classifyTimestamp(ts, bounds)
        if (cls === "after") continue
        if (cls === "before") {
          reachedWindowEnd = true
          break
        }

        try {
          const tx = await this.rpc<SolanaParsedTransaction | null>("getTransaction", [
            sig.signature,
            { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
          ])
          if (tx) {
            const normalized = this.projectTx(address, sig.signature, tx)
            if (normalized) all.push(normalized)
          }
        } catch {
          // A single unresolved transaction never fails the whole page — it
          // is simply omitted rather than fabricated.
        }
        if (all.length >= cap) break
        // Respect the public RPC's strict per-IP rate limit between calls.
        await sleep(SOLANA_TX_FETCH_DELAY_MS)
      }

      if (all.length >= cap) {
        truncated = true
        break
      }
      if (reachedWindowEnd) break
      if (signatures.length < rowsPerPage) break // reached the end of history
      before = signatures[signatures.length - 1].signature
    }

    // The public RPC's practical page/rate-limit budget is much smaller than
    // the shared investigation cap, so a page that legitimately ran out
    // (rather than being cut short by the cap) still needs an honest
    // truncation flag whenever more signatures likely exist beyond it.
    if (!truncated && !reachedWindowEnd && totalSigsSeen >= rowsPerPage * maxPages) truncated = true

    return {
      transactions: all.slice(0, cap),
      meta: { totalFetched: all.length, pagesFetched, truncated },
    }
  }

  async getTransactions(address: string, chain?: Chain, options?: TxQueryOptions): Promise<Transaction[]> {
    const { transactions } = await this.getTransactionsPaged(address, chain, options)
    return transactions
  }

  // Single-signature lookup, reusing the same projection as the list path.
  async getTransaction(hash: string): Promise<Transaction | null> {
    try {
      const tx = await this.rpc<SolanaParsedTransaction | null>("getTransaction", [
        hash,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ])
      if (!tx) return null
      // No reference address for a bare hash lookup — report the largest
      // balance decrease as "from" and largest increase as "to", the same
      // best-effort convention the Bitcoin adapter uses for a bare tx lookup.
      const keys = tx.transaction?.message?.accountKeys
      const pre = tx.meta?.preBalances
      const post = tx.meta?.postBalances
      if (!keys || !pre || !post) return null
      let fromIdx = 0
      let toIdx = 0
      for (let i = 0; i < keys.length; i++) {
        const delta = (post[i] ?? 0) - (pre[i] ?? 0)
        if (delta < (post[fromIdx] ?? 0) - (pre[fromIdx] ?? 0)) fromIdx = i
        if (delta > (post[toIdx] ?? 0) - (pre[toIdx] ?? 0)) toIdx = i
      }
      const amount = Math.abs((post[toIdx] ?? 0) - (pre[toIdx] ?? 0)) / LAMPORTS_PER_SOL
      return normalizeNative({
        hash,
        chain: "solana",
        from: keys[fromIdx]?.pubkey ?? "unknown",
        to: keys[toIdx]?.pubkey ?? "unknown",
        amount,
        asset: "SOL",
        timestamp: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
        blockHeight: tx.slot ?? null,
        provenance: "LIVE_BLOCKCHAIN_DATA",
        sourceType: "RAW_RPC",
      })
    } catch {
      return null
    }
  }

  // SPL token-transfer history requires parsing token-program instructions
  // (a heavier indexing task than native-transfer balance-diffing) and is not
  // yet implemented — explicitly empty rather than fabricated.
  async getTokenTransfers(): Promise<TokenTransfer[]> {
    return []
  }
}

export { SolanaProvider as SolanaRpcProvider }
