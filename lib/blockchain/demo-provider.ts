import type { Chain, Transaction, WalletMetadata } from "@/lib/types"
import { BaseProvider, CHAIN_ASSET } from "./provider"
import { getDemoAddressIndex, getDemoScenarios } from "@/lib/data/demo-dataset"

// DEMO provider: resolves any seeded wallet from the demo scenarios.
// All results are explicitly labeled DEMO_DATA.
export class DemoProvider extends BaseProvider {
  readonly mode = "DEMO" as const
  constructor(readonly chain: Chain) {
    super()
  }

  async getWalletTransactions(address: string): Promise<Transaction[]> {
    const idx = getDemoAddressIndex()
    const scenario = idx.get(address)
    if (!scenario) return []
    return scenario.transactions
      .filter((t) => t.from === address || t.to === address)
      .map((t) => ({ ...t, direction: t.from === address ? ("out" as const) : ("in" as const) }))
      .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""))
  }

  async getTransaction(hash: string): Promise<Transaction | null> {
    for (const s of getDemoScenarios()) {
      const tx = s.transactions.find((t) => t.hash === hash)
      if (tx) return tx
    }
    return null
  }

  async getWalletBalance(address: string) {
    const idx = getDemoAddressIndex()
    const scenario = idx.get(address)
    const meta = scenario?.metadata[address]
    if (!meta) {
      return { balance: 0, asset: CHAIN_ASSET[this.chain], usdBalance: 0 }
    }
    return { balance: meta.balance, asset: meta.asset, usdBalance: meta.usdBalance }
  }

  async getAddressMetadata(address: string): Promise<WalletMetadata | null> {
    const idx = getDemoAddressIndex()
    const scenario = idx.get(address)
    return scenario?.metadata[address] ?? null
  }
}
