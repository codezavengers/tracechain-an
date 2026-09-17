import type { Chain, ProviderHealth, ProviderHealthStatus } from "@/lib/types"
import { getChainConfig } from "@/lib/blockchain/config"
import { liveProviderFor } from "@/lib/blockchain/service"
import { getLastSuccess } from "@/lib/blockchain/health-state"
import { ProviderError } from "@/lib/blockchain/net"

const CHAINS: Chain[] = ["ethereum", "polygon", "bsc", "arbitrum", "optimism", "base", "avalanche", "bitcoin", "solana", "tron"]

// Well-known, always-exists addresses used purely to measure round-trip
// latency and reachability. Never touches investigation data, never leaks
// secrets (the health check only ever reads config booleans, not values).
const PROBE_ADDRESS: Partial<Record<Chain, string>> = {
  ethereum: "0x000000000000000000000000000000000000dEaD",
  polygon: "0x000000000000000000000000000000000000dEaD",
  bsc: "0x000000000000000000000000000000000000dEaD",
  arbitrum: "0x000000000000000000000000000000000000dEaD",
  optimism: "0x000000000000000000000000000000000000dEaD",
  base: "0x000000000000000000000000000000000000dEaD",
  avalanche: "0x000000000000000000000000000000000000dEaD",
  bitcoin: "1BitcoinEaterAddressDontSendf59kuE",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  solana: "11111111111111111111111111111111",
}

const PROBE_TIMEOUT_MS = 6000

async function checkOne(chain: Chain): Promise<ProviderHealth> {
  const cfg = getChainConfig(chain)
  const provider = liveProviderFor(chain)
  const liveCapable = provider !== null
  const configured = cfg.configured && liveCapable

  if (!configured || !provider) {
    return {
      chain,
      provider: "none",
      status: "CONFIGURATION_REQUIRED",
      sourceType: null,
      latencyMs: null,
      lastSuccess: getLastSuccess(chain),
      latestBlock: null,
      configured,
      liveCapable,
      historicalSearch: false,
    }
  }

  const probeAddress = PROBE_ADDRESS[chain]
  const started = Date.now()
  let historicalSearch = false
  try {
    if (probeAddress) {
      await Promise.race([
        provider.getWalletBalance(probeAddress, chain),
        new Promise((_, reject) => setTimeout(() => reject(new ProviderError("probe timeout", "timeout")), PROBE_TIMEOUT_MS)),
      ])
      // Balance alone isn't the primary investigation capability —
      // transaction history is. A chain that can only fetch a balance (e.g.
      // raw RPC without an indexer) must not be reported as fully LIVE for
      // investigation purposes; historicalSearch reflects that separately.
      if (provider.getTransactionsPaged) {
        await Promise.race([
          provider.getTransactionsPaged(probeAddress, chain, { maxPages: 1, offset: 1, maxTransactions: 1 }),
          new Promise((_, reject) => setTimeout(() => reject(new ProviderError("probe timeout", "timeout")), PROBE_TIMEOUT_MS)),
        ])
        historicalSearch = true
      }
    }
    const latencyMs = Date.now() - started
    return {
      chain,
      provider: provider.name,
      status: "LIVE",
      sourceType: provider.nativeSource === "LIVE_NATIVE_API" ? "LIVE_NATIVE_API" : "RAW_RPC",
      latencyMs,
      lastSuccess: new Date().toISOString(),
      latestBlock: null,
      configured: true,
      liveCapable,
      historicalSearch,
    }
  } catch (err) {
    const latencyMs = Date.now() - started
    const status: ProviderHealthStatus =
      err instanceof ProviderError && err.kind === "rate_limit"
        ? "RATE_LIMITED"
        : err instanceof ProviderError && err.kind === "timeout"
          ? "TIMEOUT"
          : err instanceof ProviderError && (err.kind === "http" || err.kind === "network")
            ? "UNAVAILABLE"
            : "ERROR"
    return {
      chain,
      provider: provider.name,
      status,
      sourceType: null,
      latencyMs,
      lastSuccess: getLastSuccess(chain),
      latestBlock: null,
      configured: true,
      liveCapable,
      historicalSearch,
    }
  }
}

// Checks every supported chain in parallel. Never throws — an individual
// probe failure surfaces as UNAVAILABLE/RATE_LIMITED for that chain only.
export async function checkProviderHealth(): Promise<ProviderHealth[]> {
  return Promise.all(CHAINS.map(checkOne))
}
