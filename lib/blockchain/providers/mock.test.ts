import { describe, it, expect } from "vitest"
import { MockBlockchainProvider } from "./mock"
import { getDemoScenarios } from "@/lib/data/demo-dataset"

describe("MockBlockchainProvider", () => {
  const scenario = getDemoScenarios()[0]
  const address = scenario.reportedWallet

  it("is always configured and always yields MOCK-labeled data", () => {
    const provider = new MockBlockchainProvider("ethereum")
    expect(provider.isConfigured()).toBe(true)
    expect(provider.nativeSource).toBe("MOCK")
  })

  it("returns deterministic transactions for a seeded demo wallet", async () => {
    const provider = new MockBlockchainProvider(scenario.chain)
    const first = await provider.getTransactions(address)
    const second = await provider.getTransactions(address)
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
  })

  it("returns an empty list for an address with no seeded data", async () => {
    const provider = new MockBlockchainProvider("ethereum")
    const txs = await provider.getTransactions("0x000000000000000000000000000000deadbeef")
    expect(txs).toEqual([])
  })

  it("derives token transfers only from non-native-asset demo transactions", async () => {
    const provider = new MockBlockchainProvider(scenario.chain)
    const transfers = await provider.getTokenTransfers(address)
    for (const t of transfers) {
      expect(t.tokenSymbol).not.toBe("")
    }
  })

  it("serves this provider as the fallback the service layer uses when live fails", async () => {
    const provider = new MockBlockchainProvider(scenario.chain)
    const balance = await provider.getWalletBalance(address)
    expect(balance.chain).toBe(scenario.chain)
    expect(typeof balance.balance).toBe("number")
  })
})
