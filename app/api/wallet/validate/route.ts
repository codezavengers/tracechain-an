import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api/session"
import { validateAddress } from "@/lib/blockchain/address-utils"
import type { Chain } from "@/lib/types"

export async function POST(req: Request) {
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const body = await req.json().catch(() => ({}))
  const address = (body?.address ?? "").trim()
  const chain = body?.chain as Chain | undefined
  if (!address) return NextResponse.json({ error: "Address is required." }, { status: 400 })
  return NextResponse.json({ validation: validateAddress(address, chain) })
}
