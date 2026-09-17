import { NextResponse } from "next/server"
import { ensureSeeded, listEvidence, getCase, appendEvidence } from "@/lib/store"
import { requireUser, requireRole } from "@/lib/api/session"
import { PERMISSIONS } from "@/lib/auth"
import { verifyChain } from "@/lib/evidence/evidence"
import { getRepository } from "@/lib/db"

export async function GET(req: Request) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const url = new URL(req.url)
  const caseId = url.searchParams.get("caseId") ?? undefined
  const records = listEvidence(caseId)
  const integrity = verifyChain(records)
  return NextResponse.json({ records, integrity })
}

// Add a new evidence record to a case's tamper-evident chain. The SHA-256 is
// computed and stored (see appendEvidence), and an EVIDENCE_ADDED event is
// written to the investigation's chain-of-custody log (InvestigationEvent).
export async function POST(req: Request) {
  await ensureSeeded()
  const auth = await requireRole(PERMISSIONS.runInvestigation)
  if ("response" in auth) return auth.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }
  const caseId = typeof body.caseId === "string" ? body.caseId.trim() : ""
  const title = typeof body.title === "string" ? body.title.trim() : ""
  const summary = typeof body.summary === "string" ? body.summary.trim() : ""
  const type = typeof body.type === "string" && body.type.trim() ? body.type.trim() : "MANUAL_EVIDENCE"
  const filename = typeof body.filename === "string" && body.filename.trim() ? body.filename.trim() : undefined
  const content = "content" in body ? body.content : summary

  if (!caseId) return NextResponse.json({ error: "caseId is required." }, { status: 400 })
  if (!title) return NextResponse.json({ error: "A title is required." }, { status: 400 })
  if (!getCase(caseId)) return NextResponse.json({ error: "Case not found." }, { status: 404 })

  const record = await appendEvidence({
    caseId,
    type,
    title,
    summary: summary || title,
    content,
    createdBy: auth.user.name,
    provenance: "KNOWN_ATTRIBUTION",
    filename,
  })

  // Chain of custody: record the "evidence added" event on the investigation
  // audit trail. Best-effort — a persistence hiccup must not lose the evidence
  // the investigator just added to the chain.
  try {
    const repo = getRepository()
    await repo.init()
    await repo.appendInvestigationEvent({
      investigationId: caseId,
      actor: auth.user.name,
      action: "EVIDENCE_ADDED",
      detail: `Evidence "${record.title}" added to the chain of custody${filename ? ` (file: ${filename})` : ""}.`,
      metadata: { evidenceId: record.id, contentHash: record.contentHash, filename: filename ?? null },
    })
  } catch (err) {
    console.log("[v0] Chain-of-custody append (EVIDENCE_ADDED) failed:", err instanceof Error ? err.message : err)
  }

  const records = listEvidence(caseId)
  return NextResponse.json({ record, records, integrity: verifyChain(records) }, { status: 201 })
}
