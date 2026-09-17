import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api/session"
import { extractWalletsFromText } from "@/lib/blockchain/address-utils"

// Extract candidate wallet addresses from free-form complaint text.
export async function POST(req: Request) {
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const body = await req.json().catch(() => ({}))
  const text = (body?.text ?? "").toString()
  if (!text.trim()) return NextResponse.json({ wallets: [] })
  return NextResponse.json({ wallets: extractWalletsFromText(text) })
}
