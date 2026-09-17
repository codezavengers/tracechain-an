import { NextResponse } from "next/server"
import { ensureSeeded, getCase, getInvestigation, getScenarioForCase, listAlerts, listEvidence, appendEvidence } from "@/lib/store"
import { requireRole } from "@/lib/api/session"
import { PERMISSIONS } from "@/lib/auth"
import { verifyChain } from "@/lib/evidence/evidence"
import { getRepository } from "@/lib/db"
import { buildCaseSummary } from "@/lib/investigation/case-summary"

// Assembles a full investigation report payload (JSON). The frontend renders /
// exports it. Includes the evidence hash + chain-integrity check.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded()
  const auth = await requireRole(PERMISSIONS.exportReport)
  if ("response" in auth) return auth.response
  const { id } = await params
  const c = getCase(id)
  if (!c) return NextResponse.json({ error: "Case not found." }, { status: 404 })
  const investigation = getInvestigation(id)
  if (!investigation) {
    return NextResponse.json({ error: "Run the investigation before generating a report." }, { status: 409 })
  }
  const scenario = getScenarioForCase(id)
  const evidence = listEvidence(id)
  const integrity = verifyChain(evidence)
  const latestHash = evidence.length ? evidence[evidence.length - 1].contentHash : null
  const summary = buildCaseSummary(id)
  const trace = investigation.fundTrace

  const report = {
    generatedAt: new Date().toISOString(),
    generatedBy: auth.user.name,
    disclaimer:
      "This report is investigative decision-support. All exchange/VASP attributions are PROBABLE unless independently verified. TRACECHAIN AI performs no automatic legal action or asset freezing.",
    caseInformation: {
      id: c.id,
      title: c.title,
      complaintRef: c.complaintRef,
      status: c.status,
      investigator: c.investigator,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      provenance: c.provenance,
    },
    caseSummary: summary,
    reportedWallet: { address: c.reportedWallet, chain: c.chain },
    investigationSummary: investigation.summary,
    fraudTypology: investigation.fraudprint.result,
    // Explicit, transaction-level pattern detection surfaced for the report.
    detectedPatterns: investigation.intelligence.result.detectedPatterns.map((p) => ({
      type: p.type,
      title: p.title,
      description: p.description,
      confidence: p.confidence,
      supportingTransactions: p.supportingTransactions,
    })),
    fundFlow: {
      graphNodes: scenario?.nodes.length ?? 0,
      graphEdges: scenario?.edges.length ?? 0,
      journey: investigation.journey,
    },
    // Multi-hop fund tracing summary derived from this investigation's trace.
    fundTracingSummary: {
      summary: trace.summary,
      hopsReached: trace.hopsReached,
      maxHops: trace.maxHops,
      walletsTraced: trace.nodes.length,
      transfersTraced: trace.edges.length,
      representativePaths: trace.paths.length,
      truncated: trace.truncated,
      truncationReasons: trace.truncationReasons,
      provenance: trace.provenance,
    },
    suspiciousWallets: (scenario?.nodes ?? []).filter((n) => n.kind === "SUSPICIOUS").map((n) => n.id),
    burnerWallets: investigation.ghostWallet.result.burners,
    launderingAnalysis: investigation.laundering.result,
    crossChainActivity: investigation.crossChain.result,
    vaspAttribution: investigation.exitPoint.result.exitPoints.map((e) => ({
      address: e.address,
      category: e.attribution.category,
      vasp: e.attribution.vasp?.name ?? null,
      inboundUsd: e.inboundValue,
    })),
    exitPointAi: investigation.exitPoint.result,
    fundDna: investigation.fundDna.result,
    recoveryAnalysis: investigation.recover.result,
    risk: investigation.risk.result,
    // Plain-language explanation of how the risk score was derived, plus the
    // itemized factors behind it.
    riskExplanation: {
      score: investigation.risk.result.score,
      band: investigation.risk.result.band,
      explanation: investigation.risk.explanation,
      factors: investigation.risk.result.factors,
    },
    priorityScore: investigation.priorityScore,
    recommendations: investigation.actionPack.result,
    evidence: {
      records: evidence,
      chainIntegrity: integrity,
      latestHash,
      timestamp: new Date().toISOString(),
    },
    // Honest limitations so the report is never read as proof of wrongdoing.
    limitations: [
      "Findings are investigative decision-support, not a determination of guilt. Language is deliberately limited to potential, observed, suspicious, and detected.",
      "VASP and exchange attributions are PROBABLE heuristics unless independently verified with the named service.",
      c.provenance === "DEMO_DATA"
        ? "This case is built from DEMO data and does not reflect live blockchain state."
        : "Live blockchain coverage depends on configured providers; unconfigured chains fall back to bounded lookups.",
      trace.truncated
        ? "Fund tracing was truncated by safety limits and represents a partial trace, not the complete fund flow."
        : "Fund tracing is bounded to a limited hop depth and may not capture the complete downstream flow.",
      "USD values are omitted where no reliable price was available rather than shown as zero.",
    ],
  }

  await appendEvidence({
    caseId: id,
    type: "REPORT_GENERATED",
    title: "Investigation report generated",
    summary: `Report generated by ${auth.user.name}. Chain integrity: ${integrity.valid ? "VALID" : "BROKEN"}.`,
    content: { latestHash },
    createdBy: auth.user.name,
    provenance: "HEURISTIC_ANALYSIS",
  })

  // Persist the generated report and associate it with its investigation.
  // The report is generated on demand, so this is the point at which it is
  // persisted. It is best-effort: a persistence failure must not prevent the
  // investigator from viewing/downloading the report they just generated.
  let persistence: { mode: string; persisted: boolean } = {
    mode: "IN_MEMORY",
    persisted: false,
  }
  try {
    const repo = getRepository()
    await repo.init()
    // Ensure the investigation row exists (FK target) before writing the
    // report — idempotent upsert against the same in-memory case/result.
    await repo.saveInvestigation({
      case: c,
      investigation,
      alerts: listAlerts().filter((a) => a.caseId === id),
      evidence: listEvidence(id),
      userId: auth.user.id,
      actor: auth.user.name,
    })
    await repo.saveReport({ investigationId: id, generatedBy: auth.user.name, data: report })
    await repo.appendInvestigationEvent({
      investigationId: id,
      actor: auth.user.name,
      action: "REPORT_GENERATED",
      detail: `Investigation report generated and persisted (${repo.persistenceMode === "POSTGRES" ? "persistent database" : "in-memory store"}).`,
      metadata: { chainIntegrity: integrity.valid },
    })
    persistence = { mode: repo.persistenceMode, persisted: true }
  } catch (err) {
    console.log("[v0] Report persistence failed:", err instanceof Error ? err.message : err)
    persistence = { mode: getRepository().persistenceMode, persisted: false }
  }

  return NextResponse.json({ report, persistence })
}
