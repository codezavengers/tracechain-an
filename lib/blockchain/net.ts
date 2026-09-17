// Resilient HTTP layer for blockchain provider adapters.
//
// Responsibilities:
//   - Request timeouts (AbortController)
//   - Retry with exponential backoff + jitter for transient failures
//   - Rate-limit awareness (HTTP 429 + Retry-After header)
//   - Typed, human-readable errors so callers can decide to fall back to MOCK
//
// This module NEVER logs or exposes API keys. Callers build fully-formed URLs
// (with the key already appended from a server-side env var) and pass them in.

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "rate_limit" | "http" | "network" | "parse" | "not_configured" | "unsupported",
    readonly status?: number,
    // Only meaningful when kind === "unsupported" — the exact honest reason
    // code to surface, since "unsupported" covers several distinct raw-RPC
    // limitations (no address index, no native API configured, etc).
    readonly code?: LiveErrorCode,
  ) {
    super(message)
    this.name = "ProviderError"
  }
}

// Reason codes surfaced to API responses / the UI when a LIVE-mode request
// cannot be completed. There is no "fell back to demo data" code here —
// by design, a LIVE investigation either returns real data or one of these.
export type LiveErrorCode =
  | "PROVIDER_CONFIGURATION_REQUIRED"
  | "LIVE_PROVIDER_TIMEOUT"
  | "LIVE_PROVIDER_RATE_LIMIT"
  | "LIVE_PROVIDER_UNAVAILABLE"
  | "INVALID_WALLET"
  | "UNSUPPORTED_NETWORK"
  // Raw-RPC-only architecture: some capabilities a third-party indexer would
  // normally provide are simply not obtainable from a raw node without
  // additional infrastructure (e.g. enumerating every historical transaction
  // for an arbitrary Bitcoin address requires an address index or a
  // wallet-import+rescan that Bitcoin Core RPC does not expose directly).
  // These codes report that honestly instead of silently returning nothing.
  | "HISTORICAL_DATA_UNAVAILABLE"
  | "UNSUPPORTED_WITH_CURRENT_RPC"
  | "NATIVE_API_UNAVAILABLE"

export class LiveProviderError extends Error {
  constructor(
    readonly code: LiveErrorCode,
    message: string,
    readonly chain?: string,
    readonly provider?: string,
  ) {
    super(message)
    this.name = "LiveProviderError"
  }
}

// Maps a low-level transport failure onto the reason code an investigator
// actually needs to see. Never invents a more specific reason than the
// underlying error actually supports.
export function classifyProviderFailure(err: unknown, chain: string, provider: string): LiveProviderError {
  if (err instanceof ProviderError) {
    if (err.kind === "not_configured") {
      return new LiveProviderError("PROVIDER_CONFIGURATION_REQUIRED", `Live provider not configured for ${chain}.`, chain, provider)
    }
    if (err.kind === "timeout") {
      return new LiveProviderError("LIVE_PROVIDER_TIMEOUT", err.message, chain, provider)
    }
    if (err.kind === "rate_limit") {
      return new LiveProviderError("LIVE_PROVIDER_RATE_LIMIT", err.message, chain, provider)
    }
    if (err.kind === "unsupported") {
      return new LiveProviderError(err.code ?? "UNSUPPORTED_WITH_CURRENT_RPC", err.message, chain, provider)
    }
    return new LiveProviderError("LIVE_PROVIDER_UNAVAILABLE", err.message, chain, provider)
  }
  const message = err instanceof Error ? err.message : "Live provider request failed."
  return new LiveProviderError("LIVE_PROVIDER_UNAVAILABLE", message, chain, provider)
}

export interface FetchOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  method?: "GET" | "POST"
  body?: string
  // A label used only for error messages (never includes secrets).
  label?: string
}

const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_RETRIES = 2

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function backoffDelay(attempt: number): number {
  // Exponential backoff: 300ms, 600ms, 1200ms ... with up to 200ms jitter.
  const base = 300 * 2 ** attempt
  return base + Math.floor(Math.random() * 200)
}

// Redact anything that looks like a key/token from a URL before it ever
// appears in an error message.
function safeUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const secretParam of ["apikey", "apiKey", "api_key", "key", "token", "access_token"]) {
      if (u.searchParams.has(secretParam)) u.searchParams.set(secretParam, "***")
    }
    return `${u.origin}${u.pathname}`
  } catch {
    return "<url>"
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
  method: "GET" | "POST" = "GET",
  body?: string,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      method,
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body,
      signal: controller.signal,
      cache: "no-store",
    })
  } finally {
    clearTimeout(timer)
  }
}

// Core resilient JSON fetch. Throws a typed ProviderError on failure.
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = opts.retries ?? DEFAULT_RETRIES
  const label = opts.label ?? safeUrl(url)

  let lastErr: ProviderError | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs, opts.headers, opts.method ?? "GET", opts.body)

      // Rate limited — respect Retry-After when present, otherwise back off.
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffDelay(attempt)
        lastErr = new ProviderError(`${label} rate-limited (429).`, "rate_limit", 429)
        if (attempt < retries) {
          await sleep(waitMs)
          continue
        }
        throw lastErr
      }

      // Retry 5xx (transient upstream failures).
      if (res.status >= 500) {
        lastErr = new ProviderError(`${label} upstream error (${res.status}).`, "http", res.status)
        if (attempt < retries) {
          await sleep(backoffDelay(attempt))
          continue
        }
        throw lastErr
      }

      if (!res.ok) {
        // 4xx (other than 429) are not retryable.
        throw new ProviderError(`${label} request failed (${res.status}).`, "http", res.status)
      }

      try {
        return (await res.json()) as T
      } catch {
        throw new ProviderError(`${label} returned a malformed response.`, "parse")
      }
    } catch (err) {
      if (err instanceof ProviderError) {
        // Non-retryable errors bubble up immediately.
        if (err.kind === "http" && err.status && err.status < 500 && err.status !== 429) throw err
        if (err.kind === "parse") throw err
        lastErr = err
      } else if (err instanceof DOMException && err.name === "AbortError") {
        lastErr = new ProviderError(`${label} timed out after ${timeoutMs}ms.`, "timeout")
      } else {
        lastErr = new ProviderError(
          `${label} network error: ${err instanceof Error ? err.message : "unknown"}.`,
          "network",
        )
      }
      if (attempt < retries) {
        await sleep(backoffDelay(attempt))
        continue
      }
    }
  }

  throw lastErr ?? new ProviderError(`${label} failed after ${retries + 1} attempts.`, "network")
}
