import { NextResponse } from "next/server"
import { ensureSeeded, getStore } from "@/lib/store"
import { requireRole } from "@/lib/api/session"
import { PERMISSIONS } from "@/lib/auth"

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded()
  const auth = await requireRole(PERMISSIONS.acknowledgeAlert)
  if ("response" in auth) return auth.response
  const { id } = await params
  const alert = getStore().alerts.find((a) => a.id === id)
  if (!alert) return NextResponse.json({ error: "Alert not found." }, { status: 404 })
  alert.acknowledged = true
  return NextResponse.json({ alert })
}
