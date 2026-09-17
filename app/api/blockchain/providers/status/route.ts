import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api/session"
import { checkProviderHealth } from "@/lib/blockchain/health"

// Reports live provider health for Ethereum, Polygon, BSC, Bitcoin and Tron.
// Never returns secrets — only booleans/status derived from them.
export async function GET() {
  const auth = await requireUser()
  if ("response" in auth) return auth.response

  const health = await checkProviderHealth()

  return NextResponse.json({
    chains: health.map((h) => ({
      chain: h.chain,
      provider: h.provider,
      configured: h.configured,
      liveCapable: h.liveCapable,
      status: h.status,
      sourceType: h.sourceType,
      historicalSearch: h.historicalSearch,
      latencyMs: h.latencyMs,
      lastSuccess: h.lastSuccess,
      latestBlock: h.latestBlock,
    })),
  })
}
