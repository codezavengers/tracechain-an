import { NextResponse } from "next/server"
import { ensureSeeded } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { getRepository } from "@/lib/db"

// Lists persisted investigations (case-list projection), most recently updated
// first. Supports simple search via ?q= across id / title / reported wallet /
// complaint ref / status. ?status= filters by exact status.
export async function GET(req: Request) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response

  const url = new URL(req.url)
  const q = url.searchParams.get("q")?.trim() || undefined
  const status = url.searchParams.get("status")?.trim() || undefined

  const repo = getRepository()
  try {
    await repo.init()
    // Scope to the authenticated investigator: their own investigations plus
    // shared/seeded (unowned) demo cases. See isVisibleToViewer.
    const investigations =
      q || status
        ? await repo.searchInvestigations({ q, status }, auth.user.id)
        : await repo.listInvestigations(auth.user.id)
    return NextResponse.json({ investigations, persistenceMode: repo.persistenceMode })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown persistence error."
    return NextResponse.json(
      { error: `Failed to list investigations: ${message}`, persistenceMode: repo.persistenceMode },
      { status: 500 },
    )
  }
}
