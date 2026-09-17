import { NextResponse } from "next/server"
import { ensureSeeded, listWatchlist, getStore } from "@/lib/store"
import { requireUser, requireRole } from "@/lib/api/session"
import { PERMISSIONS } from "@/lib/auth"
import { validateAddress } from "@/lib/blockchain/address-utils"
import type { Chain, WatchedWallet } from "@/lib/types"

export async function GET() {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  return NextResponse.json({ watchlist: listWatchlist() })
}

// WATCHTOWER: add a wallet to continuous monitoring.
export async function POST(req: Request) {
  await ensureSeeded()
  const auth = await requireRole(PERMISSIONS.runInvestigation)
  if ("response" in auth) return auth.response
  const body = await req.json().catch(() => ({}))
  const address = (body?.address ?? "").trim()
  const chain = body?.chain as Chain | undefined
  const validation = validateAddress(address, chain)
  if (!validation.valid || !validation.chain) {
    return NextResponse.json({ error: validation.reason || "Invalid address." }, { status: 400 })
  }
  const now = new Date().toISOString()
  const w: WatchedWallet = {
    id: `w_${Date.now()}`,
    address,
    chain: validation.chain,
    label: body?.label || "Manually watched wallet",
    caseId: body?.caseId,
    addedAt: now,
    lastActivity: now,
    status: "ACTIVE",
    balance: 0,
    usdBalance: 0,
  }
  getStore().watchlist.push(w)
  return NextResponse.json({ watched: w }, { status: 201 })
}
