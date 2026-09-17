import { NextResponse } from "next/server"
import { ensureSeeded, getCase, appendEvidence } from "@/lib/store"
import { requireRole } from "@/lib/api/session"
import { PERMISSIONS } from "@/lib/auth"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded()
  const auth = await requireRole(PERMISSIONS.editCase)
  if ("response" in auth) return auth.response
  const { id } = await params
  const c = getCase(id)
  if (!c) return NextResponse.json({ error: "Case not found." }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const text = (body?.body ?? "").trim()
  if (!text) return NextResponse.json({ error: "Note body is required." }, { status: 400 })

  const now = new Date().toISOString()
  const note = { id: `n_${c.notes.length + 1}_${Date.now()}`, author: auth.user.name, createdAt: now, body: text }
  c.notes.push(note)
  c.activity.push({
    id: `a_${c.activity.length + 1}`,
    actor: auth.user.name,
    action: "NOTE_ADDED",
    detail: text.length > 60 ? `${text.slice(0, 60)}…` : text,
    createdAt: now,
  })
  c.updatedAt = now
  await appendEvidence({
    caseId: id,
    type: "INVESTIGATOR_NOTE",
    title: "Investigator note",
    summary: text.length > 120 ? `${text.slice(0, 120)}…` : text,
    content: { note: text },
    createdBy: auth.user.name,
    provenance: "UNKNOWN",
  })
  return NextResponse.json({ note, case: c }, { status: 201 })
}
