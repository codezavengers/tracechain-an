// Lightweight in-memory TTL cache for blockchain provider responses.
//
// Purpose: cut duplicate upstream calls, smooth over rate limits, and let the
// service label re-served entries as CACHED. Suitable for a single-node
// prototype; swap for Redis/KV in a multi-instance deployment.

interface Entry<T> {
  value: T
  expiresAt: number
}

class TtlCache {
  private store = new Map<string, Entry<unknown>>()
  private maxEntries: number

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries
  }

  get<T>(key: string): { hit: boolean; value?: T } {
    const entry = this.store.get(key) as Entry<T> | undefined
    if (!entry) return { hit: false }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return { hit: false }
    }
    return { hit: true, value: entry.value }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    // Simple size guard: evict oldest insertion when over capacity.
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}

// Module-level singleton so the cache survives across requests in a warm
// serverless instance.
export const providerCache = new TtlCache()

export const CACHE_TTL = {
  transactions: 30_000,
  transaction: 120_000,
  balance: 20_000,
  tokenTransfers: 30_000,
  metadata: 60_000,
} as const

export function cacheKey(parts: (string | number | undefined)[]): string {
  return parts.filter((p) => p !== undefined).join(":")
}

// Build the option-dependent suffix of a transaction/token-list cache key.
//
// Every query parameter that can change the returned rows is encoded with an
// explicit label so two logically DIFFERENT requests can never collide and two
// logically IDENTICAL requests always produce the same key. Labelling matters:
// a bare positional key (offset dropped when undefined, page present) could let
// `offset=100` reuse a `page=100` entry. With labels, `offset=50` vs
// `offset=100`, `maxPages=1` vs `maxPages=5`, and differing date ranges each
// hash to a distinct key. Returns undefined when no result-affecting option is
// set, so an unscoped request keeps a stable key.
export function txOptionsKey(
  options: {
    page?: number
    offset?: number
    maxPages?: number
    maxTransactions?: number
    startDate?: string
    endDate?: string
  } = {},
): string | undefined {
  const labeled: string[] = []
  if (options.page !== undefined) labeled.push(`page=${options.page}`)
  if (options.offset !== undefined) labeled.push(`offset=${options.offset}`)
  if (options.maxPages !== undefined) labeled.push(`maxPages=${options.maxPages}`)
  if (options.maxTransactions !== undefined) labeled.push(`max=${options.maxTransactions}`)
  if (options.startDate !== undefined) labeled.push(`start=${options.startDate}`)
  if (options.endDate !== undefined) labeled.push(`end=${options.endDate}`)
  return labeled.length > 0 ? labeled.join("|") : undefined
}
