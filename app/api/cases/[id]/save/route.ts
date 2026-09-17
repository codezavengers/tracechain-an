import { NextResponse } from "next/server"
import { ensureSeeded, getCase, getInvestigation, listAlerts, listEvidence } from "@/lib/store"
import { requireRole } from "@/lib/api/session"
import { PERMISSIONS } from "@/lib/auth"
import { getRepository, persistenceLabel } from "@/lib/db"

const ID_RE = /^[A-Za-z0-9_-]+$/

// Persists the current investigation (case + multi-engine result + alerts +
// evidence) to the active repository. Upserts by case id, so re-saving updates
// the existing record rather than creating duplicates. Returns the persistence
// mode so the UI can reflect whether the save is durable.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded()
  const auth = await requireRole(PERMISSIONS.runInvestigation)
  if ("response" in auth) return auth.response

  const { id } = await params
  if (!id || !ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid investigation id." }, { status: 400 })
  }

  const c = getCase(id)
  if (!c) return NextResponse.json({ error: "Case not found." }, { status: 404 })

  const investigation = getInvestigation(id) ?? null
  const alerts = listAlerts().filter((a) => a.caseId === id)
  const evidence = listEvidence(id)

  const repo = getRepository()
  try {
    await repo.init()
    const record = await repo.saveInvestigation({
      case: c,
      investigation,
      alerts,
      evidence,
      userId: auth.user.id,
      actor: auth.user.name,
    })
    await repo.appendInvestigationEvent({
      investigationId: id,
      actor: auth.user.name,
      action: "INVESTIGATION_SAVED",
      detail: `Investigation saved (${repo.persistenceMode === "POSTGRES" ? "persistent database" : "in-memory store"}).`,
      metadata: { alerts: alerts.length, evidence: evidence.length, hasResult: Boolean(investigation) },
    })
    return NextResponse.json({
      id: record.id,
      savedAt: record.updatedAt,
      persistenceMode: repo.persistenceMode,
      persistenceLabel: persistenceLabel(repo.persistenceMode),
    })
  } catch (err) {
    // Never report success when persistence failed, and never silently fall
    // back to in-memory storage for a configured database.
    const message = err instanceof Error ? err.message : "Unknown persistence error."
    return NextResponse.json(
      { error: `Failed to save investigation: ${message}`, persistenceMode: repo.persistenceMode },
      { status: 500 },
    )
  }
}
