import { describe, it, expect, afterEach } from "vitest"
import { LiveProvider } from "./live-provider"

// Regression guard for a real bug found during the Prompt 1 audit: the
// manual case-creation route (app/api/cases/route.ts) and the manual-case
// branch of app/api/cases/[id]/investigate/route.ts used to call this
// legacy `LiveProvider` scaffold directly via `getProvider(chain, "AUTO")`.
// Its read methods are intentionally unimplemented stubs, so any chain with
// real credentials configured made both routes throw instead of returning
// live data. Both routes now go through the production `blockchain` facade
// (lib/blockchain/service.ts) instead, which has full LIVE/INDEXED/MOCK
// adapters. This test documents that LiveProvider's stubs still throw, so a
// future change can't silently reintroduce a direct dependency on them.
describe("legacy LiveProvider scaffold — intentionally unimplemented", () => {
  afterEach(() => {
    delete process.env.TRACECHAIN_ETH_API_URL
    delete process.env.TRACECHAIN_ETH_API_KEY
  })

  it("throws from getWalletTransactions even when configured — callers must use the production blockchain service instead", async () => {
    process.env.TRACECHAIN_ETH_API_URL = "https://example.test"
    process.env.TRACECHAIN_ETH_API_KEY = "test-key"
    const provider = new LiveProvider("ethereum")
    await expect(provider.getWalletTransactions("0xabc")).rejects.toThrow(/not implemented/i)
  })

  it("throws a configuration error (not a silent fallback) when unconfigured", async () => {
    const provider = new LiveProvider("ethereum")
    await expect(provider.getWalletTransactions("0xabc")).rejects.toThrow(/LIVE mode not configured/i)
  })
})
