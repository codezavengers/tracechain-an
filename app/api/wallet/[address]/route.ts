import { NextResponse } from "next/server"
import { ensureSeeded } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { blockchain, DATA_SOURCE_LABEL } from "@/lib/blockchain"
import { validateAddress } from "@/lib/blockchain/address-utils"
import type { TxQueryOptions } from "@/lib/blockchain/data-source"
import { LiveProviderError, type LiveErrorCode } from "@/lib/blockchain/net"
import type { Chain } from "@/lib/types"

// LIVE-mode failures are never silently swapped for demo data — this maps
// the reason code onto the HTTP status an investigator/client should react to.
const LIVE_ERROR_STATUS: Record<LiveErrorCode, number> = {
  PROVIDER_CONFIGURATION_REQUIRED: 503,
  LIVE_PROVIDER_TIMEOUT: 504,
  LIVE_PROVIDER_RATE_LIMIT: 429,
  LIVE_PROVIDER_UNAVAILABLE: 502,
  INVALID_WALLET: 400,
  UNSUPPORTED_NETWORK: 400,
}

// Parse the optional investigation-scoping query params into TxQueryOptions.
// Absent/blank/invalid values are simply omitted so the provider defaults apply.
function parseQueryOptions(url: URL): TxQueryOptions {
  const options: TxQueryOptions = {}
  const startDate = url.searchParams.get("startDate")
  const endDate = url.searchParams.get("endDate")
  const maxTransactions = Number(url.searchParams.get("maxTransactions"))
  const page = Number(url.searchParams.get("page"))
  const offset = Number(url.searchParams.get("offset"))
  const maxPages = Number(url.searchParams.get("maxPages"))
  if (startDate && !Number.isNaN(Date.parse(startDate))) options.startDate = startDate
  if (endDate && !Number.isNaN(Date.parse(endDate))) options.endDate = endDate
  if (Number.isFinite(maxTransactions) && maxTransactions > 0) options.maxTransactions = maxTransactions
  if (Number.isFinite(page) && page > 0) options.page = page
  if (Number.isFinite(offset) && offset > 0) options.offset = offset
  if (Number.isFinite(maxPages) && maxPages > 0) options.maxPages = maxPages
  return options
}

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const { address } = await params
  const url = new URL(req.url)
  const chainParam = url.searchParams.get("chain") as Chain | null
  const requestedMode = url.searchParams.get("mode") === "DEMO" ? "DEMO" : "LIVE"

  const validation = validateAddress(address, chainParam ?? undefined)
  if (!validation.valid || !validation.chain) {
    return NextResponse.json({ error: validation.reason, validation }, { status: 400 })
  }
  const chain = (chainParam && validation.candidateChains.includes(chainParam) ? chainParam : validation.chain) as Chain

  const options = parseQueryOptions(url)

  let inspection: Awaited<ReturnType<typeof blockchain.inspectWallet>>
  try {
    inspection = await blockchain.inspectWallet(address, chain, options, requestedMode)
  } catch (err) {
    // Non-negotiable: a LIVE-mode failure is reported honestly — never
    // silently replaced with demo data. The investigator can retry, wait
    // out a rate limit, or explicitly switch to Demo mode themselves.
    if (err instanceof LiveProviderError) {
      return NextResponse.json(
        {
          status: "ERROR",
          reason: err.code,
          error: err.message,
          chain,
          provider: err.provider ?? null,
        },
        { status: LIVE_ERROR_STATUS[err.code] },
      )
    }
    throw err
  }

  return NextResponse.json({
    validation,
    // New, honest source labeling:
    dataSource: inspection.dataSource,
    dataSourceLabel: DATA_SOURCE_LABEL[inspection.dataSource],
    demo: inspection.demo,
    notice: inspection.notice ?? null,
    provider: inspection.provider,
    fetchedAt: inspection.fetchedAt,
    cached: inspection.cached,
    // Pagination / truncation metadata so the UI can honestly say when the
    // returned history was capped at the investigation maximum.
    meta: inspection.meta ?? null,
    truncated: inspection.meta?.truncated ?? false,
    metadata: inspection.metadata,
    balance: inspection.balance,
    transactions: inspection.transactions,
    tokenTransfers: inspection.tokenTransfers,
    // Back-compat fields for existing UI consumers:
    mode: inspection.demo ? "DEMO" : "LIVE",
    provenance: inspection.demo ? "DEMO_DATA" : "LIVE_BLOCKCHAIN_DATA",
  })
}
