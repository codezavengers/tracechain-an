import type { Chain, RiskBand, CaseStatus, AttributionCategory } from "@/lib/types"
import { getCase, getInvestigation, listEvidence } from "@/lib/store"

// A concise, careful, decision-support summary of an investigation. It is
// assembled entirely from data the platform already produced (case, multi-
// engine result, evidence chain) — nothing is fabricated. Language stays in
// the observed / potential / suspicious / detected register and never asserts
// guilt.
export interface CaseSummaryVaspAttribution {
  address: string
  category: AttributionCategory
  vasp: string | null
  inboundUsd: number
}

export interface CaseSummary {
  investigationId: string
  complaint: { reference: string; text: string }
  targetWallet: string
  chain: Chain
  riskScore: number
  riskBand: RiskBand
  patterns: string[]
  findings: string[]
  evidenceCount: number
  traceSummary: string
  vaspAttribution: CaseSummaryVaspAttribution[]
  status: CaseStatus
  hasInvestigation: boolean
  generatedAt: string
}

export function buildCaseSummary(caseId: string): CaseSummary | null {
  const c = getCase(caseId)
  if (!c) return null
  const inv = getInvestigation(caseId) ?? null
  const evidence = listEvidence(caseId)

  // Detected patterns: behavioral patterns from Investigation Intelligence,
  // the working fraud typology, and a laundering signal when present.
  const patterns: string[] = []
  if (inv) {
    for (const p of inv.intelligence.result.detectedPatterns) patterns.push(p.title)
    if (inv.typology && inv.typology !== "UNKNOWN") {
      patterns.push(`Working typology: ${inv.typology.replace(/_/g, " ").toLowerCase()}`)
    }
    if (inv.laundering.result.launderingScore >= 50) {
      patterns.push(`Elevated laundering signal (${inv.laundering.result.launderingScore}/100)`)
    }
  }

  const findings = inv ? inv.intelligence.result.findings : []

  const vaspAttribution: CaseSummaryVaspAttribution[] = inv
    ? inv.exitPoint.result.exitPoints.map((e) => ({
        address: e.address,
        category: e.attribution.category,
        vasp: e.attribution.vasp?.name ?? null,
        inboundUsd: e.inboundValue,
      }))
    : []

  const traceSummary = inv?.fundTrace?.summary ?? "No fund-flow trace has been run for this investigation yet."

  return {
    investigationId: c.id,
    complaint: { reference: c.complaintRef, text: c.complaintText },
    targetWallet: c.reportedWallet,
    chain: c.chain,
    riskScore: c.riskScore,
    riskBand: c.riskBand,
    patterns: [...new Set(patterns)],
    findings,
    evidenceCount: evidence.length,
    traceSummary,
    vaspAttribution,
    status: c.status,
    hasInvestigation: Boolean(inv),
    generatedAt: new Date().toISOString(),
  }
}
