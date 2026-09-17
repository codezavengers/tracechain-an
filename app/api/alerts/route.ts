import { NextResponse } from "next/server"
import { ensureSeeded, listAlerts } from "@/lib/store"
import { requireUser } from "@/lib/api/session"

export async function GET() {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  return NextResponse.json({ alerts: listAlerts() })
}
