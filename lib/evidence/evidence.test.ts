import { describe, it, expect } from "vitest"
import { createEvidenceRecord, verifyEvidenceRecord, verifyChain, GENESIS_HASH } from "./evidence"

describe("evidence integrity verification", () => {
  const base = {
    caseId: "TC-2026-1001",
    type: "MANUAL_EVIDENCE",
    title: "KYC request acknowledgement",
    summary: "Exchange acknowledged the KYC request.",
    content: { ticket: "EX-4821", status: "acknowledged" },
    createdBy: "Lead Investigator",
    prevHash: GENESIS_HASH,
    provenance: "KNOWN_ATTRIBUTION" as const,
  }

  it("VERIFIED when recomputed hash matches the stored hash", async () => {
    const record = await createEvidenceRecord(base)
    const result = await verifyEvidenceRecord(record, base.content, true)
    expect(result.status).toBe("VERIFIED")
    expect(result.recomputedHash).toBe(record.contentHash)
  })

  it("INTEGRITY_MISMATCH when the original content was altered", async () => {
    const record = await createEvidenceRecord(base)
    const tampered = { ...base.content, status: "rejected" }
    const result = await verifyEvidenceRecord(record, tampered, true)
    expect(result.status).toBe("INTEGRITY_MISMATCH")
    expect(result.recomputedHash).not.toBe(record.contentHash)
  })

  it("CONTENT_UNAVAILABLE when the original content is not retained", async () => {
    const record = await createEvidenceRecord(base)
    const result = await verifyEvidenceRecord(record, undefined, false)
    expect(result.status).toBe("CONTENT_UNAVAILABLE")
    expect(result.recomputedHash).toBeNull()
  })

  it("filename participates in the hash and preserves verifiability", async () => {
    const withFile = await createEvidenceRecord({ ...base, filename: "report.pdf" })
    expect(withFile.filename).toBe("report.pdf")
    const ok = await verifyEvidenceRecord(withFile, base.content, true)
    expect(ok.status).toBe("VERIFIED")
  })
})

describe("verifyChain", () => {
  const base = {
    type: "MANUAL_EVIDENCE",
    title: "Note",
    summary: "Note",
    content: { x: 1 },
    createdBy: "Lead Investigator",
    provenance: "KNOWN_ATTRIBUTION" as const,
  }

  it("is valid for a single case's own sequential chain", async () => {
    const r1 = await createEvidenceRecord({ ...base, caseId: "TC-A", prevHash: GENESIS_HASH })
    const r2 = await createEvidenceRecord({ ...base, caseId: "TC-A", prevHash: r1.contentHash })
    expect(verifyChain([r1, r2]).valid).toBe(true)
  })

  it("detects a genuinely broken chain within a single case", async () => {
    const r1 = await createEvidenceRecord({ ...base, caseId: "TC-A", prevHash: GENESIS_HASH })
    const r2 = await createEvidenceRecord({ ...base, caseId: "TC-A", prevHash: "tampered-prev-hash" })
    const result = verifyChain([r1, r2])
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(r2.id)
  })

  // Each case roots its own chain at GENESIS_HASH independently — viewing
  // multiple cases' records together must never report a false "broken"
  // chain just because their prevHash sequences don't link across cases.
  it("stays valid when multiple cases each have their own independent, intact chain", async () => {
    const a1 = await createEvidenceRecord({ ...base, caseId: "TC-A", prevHash: GENESIS_HASH })
    const a2 = await createEvidenceRecord({ ...base, caseId: "TC-A", prevHash: a1.contentHash })
    const b1 = await createEvidenceRecord({ ...base, caseId: "TC-B", prevHash: GENESIS_HASH })
    const result = verifyChain([a1, b1, a2])
    expect(result.valid).toBe(true)
  })
})
