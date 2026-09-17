import type { AddressValidation, Chain, Transaction } from "@/lib/types"
import { validateAddress } from "@/lib/blockchain/address-utils"
import type { BlockchainProvider, DataSource, TokenTransfer, WalletBalance } from "@/lib/blockchain/data-source"

// Shared base for every chain adapter. Provides structural address validation
// and a consistent `isConfigured` default; concrete adapters implement the
// network-bound reads.
export abstract class AbstractProvider implements BlockchainProvider {
  abstract readonly chain: Chain
  abstract readonly name: string
  abstract readonly nativeSource: DataSource

  isConfigured(): boolean {
    return true
  }

  validateAddress(address: string, chain?: Chain): AddressValidation {
    return validateAddress(address, chain ?? this.chain)
  }

  abstract getTransactions(address: string, chain?: Chain): Promise<Transaction[]>
  abstract getTransaction(hash: string, chain?: Chain): Promise<Transaction | null>
  abstract getWalletBalance(address: string, chain?: Chain): Promise<WalletBalance>
  abstract getTokenTransfers(address: string, chain?: Chain): Promise<TokenTransfer[]>
}
