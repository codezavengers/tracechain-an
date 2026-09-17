import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fetchJson, ProviderError } from "./net"

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  })
}

describe("fetchJson", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("returns parsed JSON on success", async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true }))
    const data = await fetchJson<{ ok: boolean }>("https://example.com/api")
    expect(data.ok).toBe(true)
  })

  it("times out and throws a ProviderError of kind timeout", async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            const err = new DOMException("aborted", "AbortError")
            reject(err)
          })
        }),
    )
    await expect(fetchJson("https://example.com/slow", { timeoutMs: 10, retries: 0 })).rejects.toMatchObject({
      kind: "timeout",
    })
  })

  it("retries transient 5xx failures then succeeds", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const data = await fetchJson<{ ok: boolean }>("https://example.com/api", { retries: 2 })
    expect(data.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("honors Retry-After on 429 responses", async () => {
    vi.useFakeTimers()
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const promise = fetchJson<{ ok: boolean }>("https://example.com/api", { retries: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    const data = await promise
    expect(data.ok).toBe(true)
  })

  it("throws a rate_limit ProviderError when retries are exhausted on 429", async () => {
    vi.useFakeTimers()
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue(jsonResponse({}, { status: 429 }))
    const promise = fetchJson("https://example.com/api", { retries: 0 })
    const assertion = expect(promise).rejects.toMatchObject({ kind: "rate_limit", status: 429 })
    await vi.runAllTimersAsync()
    await assertion
  })

  it("does not retry non-429 4xx errors", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
    await expect(fetchJson("https://example.com/api", { retries: 3 })).rejects.toBeInstanceOf(ProviderError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("redacts API keys from error messages", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
    try {
      await fetchJson("https://example.com/api?apikey=super-secret-value", { retries: 0 })
      expect.fail("expected fetchJson to throw")
    } catch (err) {
      const message = (err as Error).message
      expect(message).not.toContain("super-secret-value")
    }
  })
})
