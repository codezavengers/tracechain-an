import type { Chain } from "@/lib/types"

// Tiny shared in-memory state between the trace path (service.ts, which
// records a timestamp every time a live/indexed fetch succeeds) and the
// provider-health service (health.ts, which reads it). Kept in its own
// module so the two never need to import each other.
const lastSuccess = new Map<Chain, string>()

export function recordProviderSuccess(chain: Chain): void {
  lastSuccess.set(chain, new Date().toISOString())
}

export function getLastSuccess(chain: Chain): string | null {
  return lastSuccess.get(chain) ?? null
}
