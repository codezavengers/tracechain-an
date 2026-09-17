import type { Chain, Transaction, WalletMetadata } from "@/lib/types"
import { BaseProvider, CHAIN_ASSET } from "./provider"

// LIVE provider scaffold. Reads API config from environment variables ONLY.
// No keys are ever hardcoded. If a chain's API is not configured, live calls
// throw a clear error so callers can fall back to DEMO mode.
//
// Expected env vars (per chain), configured by the operator:
//   TRACECHAIN_ETH_API_URL / TRACECHAIN_ETH_API_KEY
//   TRACECHAIN_BTC_API_URL / TRACECHAIN_BTC_API_KEY
//   ...etc.
const ENV_MAP: Record<Chain, { url: string; key: string }> = {
  ethereum: { url: "TRACECHAIN_ETH_API_URL", key: "TRACECHAIN_ETH_API_KEY" },
  polygon: { url: "TRACECHAIN_POLYGON_API_URL", key: "TRACECHAIN_POLYGON_API_KEY" },
  bsc: { url: "TRACECHAIN_BSC_API_URL", key: "TRACECHAIN_BSC_API_KEY" },
  arbitrum: { url: "TRACECHAIN_ARBITRUM_API_URL", key: "TRACECHAIN_ARBITRUM_API_KEY" },
  optimism: { url: "TRACECHAIN_OPTIMISM_API_URL", key: "TRACECHAIN_OPTIMISM_API_KEY" },
  base: { url: "TRACECHAIN_BASE_API_URL", key: "TRACECHAIN_BASE_API_KEY" },
  avalanche: { url: "TRACECHAIN_AVALANCHE_API_URL", key: "TRACECHAIN_AVALANCHE_API_KEY" },
  solana: { url: "TRACECHAIN_SOLANA_RPC_URL", key: "TRACECHAIN_SOLANA_RPC_KEY" },
  bitcoin: { url: "TRACECHAIN_BTC_API_URL", key: "TRACECHAIN_BTC_API_KEY" },
  tron: { url: "TRACECHAIN_TRON_API_URL", key: "TRACECHAIN_TRON_API_KEY" },
}

export function isLiveConfigured(chain: Chain): boolean {
  const cfg = ENV_MAP[chain]
  return Boolean(process.env[cfg.url] && process.env[cfg.key])
}

export class LiveProvider extends BaseProvider {
  readonly mode = "LIVE" as const
  constructor(readonly chain: Chain) {
    super()
  }

  private ensureConfigured() {
    if (!isLiveConfigured(this.chain)) {
      throw new Error(
        `LIVE mode not configured for ${this.chain}. Set ${ENV_MAP[this.chain].url} and ${ENV_MAP[this.chain].key}. Falling back to DEMO mode is recommended.`,
      )
    }
  }

  // These implementations intentionally throw until an operator wires real
  // endpoints. The interface + env wiring are complete; the fetch bodies are
  // where a licensed data feed (Etherscan, Blockstream, TronGrid, etc.) plugs in.
  async getWalletTransactions(_address: string): Promise<Transaction[]> {
    this.ensureConfigured()
    throw new Error("LIVE getWalletTransactions not implemented for this deployment.")
  }
  async getTransaction(_hash: string): Promise<Transaction | null> {
    this.ensureConfigured()
    throw new Error("LIVE getTransaction not implemented for this deployment.")
  }
  async getWalletBalance(_address: string) {
    this.ensureConfigured()
    return { balance: 0, asset: CHAIN_ASSET[this.chain], usdBalance: 0 }
  }
  async getAddressMetadata(_address: string): Promise<WalletMetadata | null> {
    this.ensureConfigured()
    return null
  }
}
