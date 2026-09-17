import { NextResponse } from "next/server"
import { ensureSeeded } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { getRepository } from "@/lib/db"

const ID_RE = /^[A-Za-z0-9_-]+$/

// Loads a persisted investigation + related data (reload). Used to restore a
// saved investigation after a browser refresh / navigation / server restart.
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
    // Ownership-scoped load: another investigator's private investigation is
    // reported as not found rather than being returned.
    const record = await repo.getInvestigation(id, auth.user.id)
    if (!record) return NextResponse.json({ error: "Investigation not found." }, { status: 404 })
    return NextResponse.json({ investigation: record, persistenceMode: repo.persistenceMode })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown persistence error."
    return NextResponse.json(
      { error: `Failed to load investigation: ${message}`, persistenceMode: repo.persistenceMode },
      { status: 500 },
    )
  }
}
