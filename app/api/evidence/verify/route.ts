import { NextResponse } from "next/server"
import { ensureSeeded, getEvidenceById, getEvidenceContent } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { verifyEvidenceRecord } from "@/lib/evidence/evidence"
import { getRepository } from "@/lib/db"

// Verify the integrity of a single evidence record by recomputing its SHA-256
// from the retained original content and comparing it to the stored hash.
// Result is VERIFIED, INTEGRITY_MISMATCH, or CONTENT_UNAVAILABLE (when the
// original content is no longer retained, verification cannot be performed and
// is reported honestly rather than falsely claimed).
export async function POST(req: Request) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response

  const body = await req.json().catch(() => null)
  const evidenceId = body && typeof body.evidenceId === "string" ? body.evidenceId.trim() : ""
  if (!evidenceId) return NextResponse.json({ error: "evidenceId is required." }, { status: 400 })

  const record = getEvidenceById(evidenceId)
  if (!record) return NextResponse.json({ error: "Evidence record not found." }, { status: 404 })

  const { available, content } = getEvidenceContent(evidenceId)
  const verification = await verifyEvidenceRecord(record, content, available)

  // Chain of custody: record the verification attempt and its outcome.
  try {
    const repo = getRepository()
    await repo.init()
    await repo.appendInvestigationEvent({
      investigationId: record.caseId,
      actor: auth.user.name,
      action: "EVIDENCE_VERIFIED",
      detail: `Integrity check on evidence "${record.title}": ${verification.status.replace(/_/g, " ")}.`,
      metadata: {
        evidenceId: record.id,
        status: verification.status,
        storedHash: verification.storedHash,
        recomputedHash: verification.recomputedHash,
      },
    })
  } catch (err) {
    console.log("[v0] Chain-of-custody append (EVIDENCE_VERIFIED) failed:", err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ evidenceId: record.id, caseId: record.caseId, verification })
}
