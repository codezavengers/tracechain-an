import type { IntelResult, FraudTypology } from "@/lib/types"
import { nowIso, usd } from "./context"
import type { ExitPointResult } from "./exitpoint"
import type { RecoverResult } from "./recover"

export interface ActionItem {
  order: number
  action: string
  target: string
  rationale: string
  urgency: "IMMEDIATE" | "HIGH" | "ROUTINE"
}

export interface ActionPackResult {
  disclaimer: string
  summary: string
  actions: ActionItem[]
  draftVaspRequest: string
}

// ACTIONPACK AI: generates an investigator-ready DRAFT action package.
// Every document is explicitly a DRAFT requiring investigator review. It makes
// no claim of automatic legal action or asset freezing.
export function runActionPack(input: {
  caseId: string
  complaintRef: string
  reportedWallet: string
  typology: FraudTypology
  exit: ExitPointResult
  recover: RecoverResult
  reportedLossUsd: number
}): IntelResult<ActionPackResult> {
  const disclaimer =
    "DRAFT — REQUIRES INVESTIGATOR REVIEW. This package is a machine-generated draft to assist a human investigator. It does not constitute legal action, and TRACECHAIN AI does not freeze assets or contact any exchange automatically. All attributions are PROBABLE unless independently verified."

  const actions: ActionItem[] = []
  let order = 1

  actions.push({
    order: order++,
    action: "Preserve evidence and freeze the case snapshot",
    target: `Case ${input.caseId}`,
    rationale: "Lock the current graph, transactions, and hash-chained evidence before requesting external action.",
    urgency: "IMMEDIATE",
  })

  const topExits = input.exit.exitPoints.slice(0, 3)
  for (const e of topExits) {
    actions.push({
      order: order++,
      action: "Draft VASP information/freeze request",
      target: `${e.attribution.vasp?.name ?? "Unattributed endpoint"} — deposit ${e.address.slice(0, 12)}…`,
      rationale: `${usd(e.inboundValue)} of value reached this ${e.attribution.category} endpoint. Request KYC data and a hold pending legal process.`,
      urgency: e.inboundValue > input.reportedLossUsd * 0.25 ? "IMMEDIATE" : "HIGH",
    })
  }

  actions.push({
    order: order++,
    action: "Notify connected-victim complaints for consolidation",
    target: `Complaint ref ${input.complaintRef}`,
    rationale: "Link related complaints to strengthen the case and the freeze request.",
    urgency: "ROUTINE",
  })

  const draftVaspRequest = [
    `[DRAFT — REQUIRES INVESTIGATOR REVIEW]`,
    ``,
    `To: Compliance / Law Enforcement Response, ${topExits[0]?.attribution.vasp?.name ?? "[VASP name]"}`,
    `Re: Suspected fraud proceeds — Complaint ${input.complaintRef} / Case ${input.caseId}`,
    ``,
    `We are investigating a reported cryptocurrency fraud (working typology: ${input.typology.replace(/_/g, " ")}).`,
    `Approximately ${usd(input.reportedLossUsd)} was reported lost. Tracing indicates ${usd(input.exit.totalToExits)}`,
    `moved toward deposit endpoint(s) associated (PROBABLE, unverified) with your platform, including:`,
    ...topExits.map((e) => `  - ${e.address}  (~${usd(e.inboundValue)})`),
    ``,
    `Request: (1) preserve records for these deposit addresses; (2) provide available KYC/transaction data`,
    `under applicable legal process; (3) apply any lawful hold pending formal request.`,
    ``,
    `This is a draft prepared with investigative tooling and must be reviewed, verified, and issued through`,
    `proper legal channels by the assigned investigator. No automated action has been taken.`,
  ].join("\n")

  return {
    result: {
      disclaimer,
      summary: `Draft action package for case ${input.caseId}: ${actions.length} recommended steps, prioritizing ${topExits.length} exit endpoint(s).`,
      actions,
      draftVaspRequest,
    },
    confidence: 0.7,
    explanation:
      "ActionPack AI assembles a prioritized, investigator-ready DRAFT: evidence preservation, targeted VASP outreach for the highest-value exit points, and complaint consolidation.",
    evidence: actions.map((a) => `#${a.order} [${a.urgency}] ${a.action} → ${a.target}`),
    recommendation: "Review and verify every item. Issue requests only through authorized legal channels.",
    analysisType: "rule",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
