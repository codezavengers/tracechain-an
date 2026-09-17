import type { EvidenceRecord, DataProvenance } from "@/lib/types"

const encoder = new TextEncoder()

// SHA-256 hex digest via Web Crypto.
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export const GENESIS_HASH = "0".repeat(64)

// The exact fields that are hashed into an evidence record's contentHash.
// This is the single source of truth for the canonical form so that the hash
// computed at creation time and the hash recomputed at verification time are
// guaranteed to be produced identically. `filename` is omitted from the JSON
// when absent (JSON.stringify drops undefined), so records without a filename
// keep the same hash they always had.
export interface EvidenceCanonicalFields {
  caseId: string
  type: string
  title: string
  summary: string
  content: unknown
  createdBy: string
  createdAt: string
  prevHash: string
  filename?: string
}

export function canonicalizeEvidence(fields: EvidenceCanonicalFields): string {
  return JSON.stringify({
    caseId: fields.caseId,
    type: fields.type,
    title: fields.title,
    summary: fields.summary,
    content: fields.content,
    createdBy: fields.createdBy,
    createdAt: fields.createdAt,
    prevHash: fields.prevHash,
    filename: fields.filename,
  })
}

// Create an evidence record chained to the previous record's hash (tamper-evident).
export async function createEvidenceRecord(params: {
  caseId: string
  type: string
  title: string
  summary: string
  content: unknown
  createdBy: string
  prevHash: string
  provenance: DataProvenance
  filename?: string
}): Promise<EvidenceRecord> {
  const createdAt = new Date().toISOString()
  const contentHash = await sha256Hex(
    canonicalizeEvidence({
      caseId: params.caseId,
      type: params.type,
      title: params.title,
      summary: params.summary,
      content: params.content,
      createdBy: params.createdBy,
      createdAt,
      prevHash: params.prevHash,
      filename: params.filename,
    }),
  )
  return {
    id: `ev_${contentHash.slice(0, 12)}`,
    caseId: params.caseId,
    type: params.type,
    title: params.title,
    contentHash,
    prevHash: params.prevHash,
    createdAt,
    createdBy: params.createdBy,
    provenance: params.provenance,
    summary: params.summary,
    ...(params.filename ? { filename: params.filename } : {}),
  }
}

export type EvidenceVerificationStatus = "VERIFIED" | "INTEGRITY_MISMATCH" | "CONTENT_UNAVAILABLE"

export interface EvidenceVerification {
  status: EvidenceVerificationStatus
  storedHash: string
  recomputedHash: string | null
  message: string
}

// Verify a single evidence record by recomputing its SHA-256 from the original
// content and comparing it to the stored hash. When the original content is not
// available (e.g. only the hash was persisted), verification CANNOT be
// performed and we say so honestly rather than falsely claiming success.
export async function verifyEvidenceRecord(
  record: EvidenceRecord,
  originalContent: unknown,
  contentAvailable: boolean,
): Promise<EvidenceVerification> {
  if (!contentAvailable) {
    return {
      status: "CONTENT_UNAVAILABLE",
      storedHash: record.contentHash,
      recomputedHash: null,
      message:
        "Original content is unavailable for this record, so integrity verification cannot be performed. The stored hash is shown for reference only.",
    }
  }
  const recomputedHash = await sha256Hex(
    canonicalizeEvidence({
      caseId: record.caseId,
      type: record.type,
      title: record.title,
      summary: record.summary,
      content: originalContent,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      prevHash: record.prevHash,
      filename: record.filename,
    }),
  )
  const match = recomputedHash === record.contentHash
  return {
    status: match ? "VERIFIED" : "INTEGRITY_MISMATCH",
    storedHash: record.contentHash,
    recomputedHash,
    message: match
      ? "Recomputed SHA-256 matches the stored hash. Evidence integrity VERIFIED."
      : "Recomputed SHA-256 does NOT match the stored hash. INTEGRITY MISMATCH — this record may have been altered.",
  }
}

// Verify the integrity of an evidence chain (each prevHash must match).
//
// Each case has its OWN independent hash chain rooted at GENESIS_HASH
// (see appendEvidence in lib/store.ts, which computes prevHash from that
// case's own most recent record). Records are therefore grouped by caseId
// before verifying — checking cross-case sequence would treat unrelated
// cases' records as needing to link together and falsely report "broken"
// any time more than one case's evidence is viewed together (e.g. the
// unfiltered Evidence Center view).
export function verifyChain(records: EvidenceRecord[]): { valid: boolean; brokenAt?: string } {
  const byCase = new Map<string, EvidenceRecord[]>()
  for (const r of records) {
    const list = byCase.get(r.caseId)
    if (list) list.push(r)
    else byCase.set(r.caseId, [r])
  }
  for (const caseRecords of byCase.values()) {
    const ordered = [...caseRecords].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    let prev = GENESIS_HASH
    for (const r of ordered) {
      if (r.prevHash !== prev) return { valid: false, brokenAt: r.id }
      prev = r.contentHash
    }
  }
  return { valid: true }
}
