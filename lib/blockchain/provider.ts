import type { Chain, Transaction, WalletMetadata, AddressValidation } from "@/lib/types"
import { validateAddress } from "./address-utils"

// Legacy provider abstraction (kept for backward compatibility with the
// original demo/live scaffold and the case-creation flow). The production
// interface lives in ./providers/base.ts as `BlockchainProvider`.
export interface LegacyChainProvider {
  readonly chain: Chain
  readonly mode: "LIVE" | "DEMO"
  validateAddress(address: string): AddressValidation
  getWalletTransactions(address: string): Promise<Transaction[]>
  getTransaction(hash: string): Promise<Transaction | null>
  getWalletBalance(address: string): Promise<{ balance: number; asset: string; usdBalance: number | null }>
  getAddressMetadata(address: string): Promise<WalletMetadata | null>
}

// Base with shared validation logic.
export abstract class BaseProvider implements LegacyChainProvider {
  abstract readonly chain: Chain
  abstract readonly mode: "LIVE" | "DEMO"
  validateAddress(address: string): AddressValidation {
    return validateAddress(address, this.chain)
  }
  abstract getWalletTransactions(address: string): Promise<Transaction[]>
  abstract getTransaction(hash: string): Promise<Transaction | null>
  abstract getWalletBalance(
    address: string,
  ): Promise<{ balance: number; asset: string; usdBalance: number | null }>
  abstract getAddressMetadata(address: string): Promise<WalletMetadata | null>
}

export const CHAIN_ASSET: Record<Chain, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  polygon: "MATIC",
  bsc: "BNB",
  arbitrum: "ETH",
  optimism: "ETH",
  base: "ETH",
  avalanche: "AVAX",
  solana: "SOL",
  tron: "TRX",
}
