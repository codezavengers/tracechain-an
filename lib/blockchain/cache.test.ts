import { describe, it, expect, vi, afterEach } from "vitest"
import { providerCache, cacheKey, txOptionsKey } from "./cache"

describe("providerCache", () => {
  afterEach(() => {
    providerCache.clear()
    vi.useRealTimers()
  })

  it("stores and retrieves a value before it expires", () => {
    const key = cacheKey(["chain", "op", "addr"])
    providerCache.set(key, { hello: "world" }, 10_000)
    const result = providerCache.get<{ hello: string }>(key)
    expect(result.hit).toBe(true)
    expect(result.value?.hello).toBe("world")
  })

  it("expires entries after the TTL elapses", () => {
    vi.useFakeTimers()
    const key = cacheKey(["chain", "op"])
    providerCache.set(key, "value", 1000)
    vi.advanceTimersByTime(1500)
    const result = providerCache.get(key)
    expect(result.hit).toBe(false)
  })

  it("cacheKey skips undefined segments", () => {
    expect(cacheKey(["a", undefined, "b"])).toBe("a:b")
  })

  it("delete removes a key immediately", () => {
    const key = cacheKey(["x"])
    providerCache.set(key, 1, 10_000)
    providerCache.delete(key)
    expect(providerCache.get(key).hit).toBe(false)
  })
})

describe("txOptionsKey — complete, collision-free list cache keys", () => {
  it("returns undefined when no result-affecting option is set", () => {
    expect(txOptionsKey()).toBeUndefined()
    expect(txOptionsKey({})).toBeUndefined()
  })

  it("includes offset — offset=50 and offset=100 never share a key", () => {
    expect(txOptionsKey({ offset: 50 })).not.toBe(txOptionsKey({ offset: 100 }))
    expect(txOptionsKey({ offset: 50 })).toContain("offset=50")
  })

  it("includes maxPages — maxPages=1 and maxPages=5 never share a key", () => {
    expect(txOptionsKey({ maxPages: 1 })).not.toBe(txOptionsKey({ maxPages: 5 }))
    expect(txOptionsKey({ maxPages: 5 })).toContain("maxPages=5")
  })

  it("labels every parameter so a bare offset can never collide with a bare page", () => {
    // Without labels these would both be "100" and collide.
    expect(txOptionsKey({ page: 100 })).not.toBe(txOptionsKey({ offset: 100 }))
  })

  it("encodes every result-affecting option", () => {
    const key = txOptionsKey({
      page: 2,
      offset: 50,
      maxPages: 3,
      maxTransactions: 200,
      startDate: "2024-01-01",
      endDate: "2024-06-30",
    })
    expect(key).toContain("page=2")
    expect(key).toContain("offset=50")
    expect(key).toContain("maxPages=3")
    expect(key).toContain("max=200")
    expect(key).toContain("start=2024-01-01")
    expect(key).toContain("end=2024-06-30")
  })

  it("is stable for identical logical requests", () => {
    expect(txOptionsKey({ page: 1, maxTransactions: 10 })).toBe(txOptionsKey({ page: 1, maxTransactions: 10 }))
  })

  it("distinguishes different date ranges", () => {
    expect(txOptionsKey({ startDate: "2024-01-01", endDate: "2024-06-30" })).not.toBe(
      txOptionsKey({ startDate: "2024-07-01", endDate: "2024-12-31" }),
    )
  })
})
