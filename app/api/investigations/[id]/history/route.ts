import { NextResponse } from "next/server"
import { ensureSeeded } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { getRepository } from "@/lib/db"

const ID_RE = /^[A-Za-z0-9_-]+$/

// Returns the append-only investigation history (audit log), oldest first.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response

  const { id } = await params
  if (!id || !ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid investigation id." }, { status: 400 })
  }

  const repo = getRepository()
  try {
    await repo.init()
    // Respect ownership: do not expose another investigator's audit trail.
    const visible = await repo.getInvestigation(id, auth.user.id)
    if (!visible) return NextResponse.json({ error: "Investigation not found." }, { status: 404 })
    const events = await repo.getInvestigationHistory(id)
    return NextResponse.json({ events, persistenceMode: repo.persistenceMode })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown persistence error."
    return NextResponse.json(
      { error: `Failed to load history: ${message}`, persistenceMode: repo.persistenceMode },
      { status: 500 },
    )
  }
}
