import type { Chain, Transaction, WalletMetadata } from "@/lib/types"
import { AbstractProvider } from "./base"
import { DemoProvider } from "@/lib/blockchain/demo-provider"
import { NATIVE_ASSET } from "@/lib/blockchain/config"
import type { DataSource, TokenTransfer, WalletBalance } from "@/lib/blockchain/data-source"

// Deterministic demo adapter. Delegates to the existing seeded DemoProvider so
// the offline experience stays identical, then adapts it to the production
// interface (adds getTokenTransfers). Every value it returns is MOCK data.
export class MockBlockchainProvider extends AbstractProvider {
  readonly name = "mock:demo-dataset"
  readonly nativeSource: DataSource = "MOCK"
  private demo: DemoProvider

  constructor(readonly chain: Chain) {
    super()
    this.demo = new DemoProvider(chain)
  }

  getMetadata(address: string): Promise<WalletMetadata | null> {
    return this.demo.getAddressMetadata(address)
  }

  getTransactions(address: string): Promise<Transaction[]> {
    return this.demo.getWalletTransactions(address)
  }

  getTransaction(hash: string): Promise<Transaction | null> {
    return this.demo.getTransaction(hash)
  }

  async getWalletBalance(address: string): Promise<WalletBalance> {
    const b = await this.demo.getWalletBalance(address)
    return { address, chain: this.chain, balance: b.balance, asset: b.asset, usdBalance: b.usdBalance }
  }

  async getTokenTransfers(address: string): Promise<TokenTransfer[]> {
    // Derive token movements from demo transactions whose asset is not the
    // chain's native asset (e.g. USDT flows in a laundering scenario).
    const native = NATIVE_ASSET[this.chain]
    const txs = await this.demo.getWalletTransactions(address)
    return txs
      .filter((t) => t.asset !== native)
      .map((t) => ({
        hash: t.hash,
        chain: t.chain,
        from: t.from,
        to: t.to,
        tokenSymbol: t.asset,
        tokenName: t.asset,
        tokenAddress: "demo",
        amount: t.amount,
        decimals: 6,
        timestamp: t.timestamp,
        blockHeight: t.blockHeight,
        direction: t.direction,
      }))
  }
}
