import type { IntelResult, JourneyStep, FraudTypology } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { usd, clamp, nowIso } from "./context"
import { computeRisk, type RiskBreakdown, riskBand } from "@/lib/risk/risk"
import { runExitPoint, type ExitPointResult } from "./exitpoint"
import { runFundDna, type FundDnaResult } from "./fund-dna"
import { runGhostWallet, type GhostWalletResult } from "./ghost-wallet"
import { runLaunderingRadar, type LaunderingResult } from "./laundering-radar"
import { runFraudprint, type FraudprintResult } from "./fraudprint"
import { runRecover, type RecoverResult } from "./recover"
import { runNetworkDiscovery, type NetworkDiscoveryResult } from "./network-discovery"
import { runEntityResolution, type EntityResolutionResult } from "./entity-resolution"
import { runCrossChainRadar, type CrossChainResult } from "./crosschain-radar"
import { runConfidence, type ConfidenceResult } from "./confidence"
import { runActionPack, type ActionPackResult } from "./actionpack"
import {
  runInvestigationIntelligence,
  toIntelResult as intelligenceToIntelResult,
  type InvestigationIntelligenceResult,
} from "./investigation-intelligence"
import { traceFundsFromContext, type TraceGraph } from "./fund-tracing"
import type { Alert, WalletKind } from "@/lib/types"

export interface InvestigationResult {
  risk: IntelResult<RiskBreakdown>
  exitPoint: IntelResult<ExitPointResult>
  fundDna: IntelResult<FundDnaResult>
  ghostWallet: IntelResult<GhostWalletResult>
  laundering: IntelResult<LaunderingResult>
  fraudprint: IntelResult<FraudprintResult>
  recover: IntelResult<RecoverResult>
  network: IntelResult<NetworkDiscoveryResult>
  entity: IntelResult<EntityResolutionResult>
  crossChain: IntelResult<CrossChainResult>
  confidence: IntelResult<ConfidenceResult>
  actionPack: IntelResult<ActionPackResult>
  intelligence: IntelResult<InvestigationIntelligenceResult>
  // Multi-hop fund-flow trace built from this same investigation's context —
  // reuses ctx.transactions rather than issuing any new blockchain fetches.
  fundTrace: TraceGraph
  journey: JourneyStep[]
  priorityScore: number
  summary: string
  typology: FraudTypology
  generatedAt: string
}

// CASE PRIORITY AI: combines risk, recoverability, and scale into a triage score.
export function computePriority(input: {
  risk: number
  recoveryProbability: number
  reportedLossUsd: number
  connectedVictims: number
  launderingScore: number
}): number {
  const riskComponent = input.risk * 0.35
  const recoverComponent = input.recoveryProbability * 100 * 0.25
  const lossComponent = clamp(input.reportedLossUsd / 500000, 0, 1) * 100 * 0.2
  const victimComponent = clamp(input.connectedVictims / 30, 0, 1) * 100 * 0.15
  const urgency = clamp(input.launderingScore / 100, 0, 1) * 100 * 0.05
  return Math.round(clamp((riskComponent + recoverComponent + lossComponent + victimComponent + urgency) / 100) * 100)
}

// Build the fraud-journey timeline from the highest-value path.
function buildJourney(ctx: AnalysisContext, exit: ExitPointResult): JourneyStep[] {
  const steps: JourneyStep[] = []
  const nodeMap = new Map(ctx.graph.nodes.map((n) => [n.id, n]))
  steps.push({
    step: 1,
    title: "Victim funds sent",
    address: ctx.rootAddress,
    kind: "SUSPICIOUS",
    usdValue: ctx.reportedLossUsd,
    timestamp: ctx.transactions[0]?.timestamp ?? nowIso(),
    description: `Reported wallet received approximately ${usd(ctx.reportedLossUsd)} from victim(s).`,
    attribution: "UNKNOWN",
  })

  // Walk the highest-value path
  let cursor = ctx.rootAddress
  let step = 2
  const visited = new Set<string>([cursor])
  while (step < 12) {
    const outs = ctx.graph.edges.filter((e) => e.source === cursor && !visited.has(e.target))
    if (!outs.length) break
    const best = outs.sort((a, b) => b.usdValue - a.usdValue)[0]
    const node = nodeMap.get(best.target)
    if (!node) break
    visited.add(best.target)
    const titleMap: Record<string, string> = {
      BURNER: "Relayed through burner wallet",
      MIXER: "Passed through mixing service",
      BRIDGE: "Bridged to another chain",
      EXCHANGE: "Deposited to exchange endpoint",
      SUSPICIOUS: "Moved to intermediary wallet",
    }
    steps.push({
      step: step++,
      title: titleMap[node.kind] ?? "Funds moved",
      address: node.id,
      kind: node.kind,
      usdValue: best.usdValue,
      timestamp: best.timestamp,
      description: `${usd(best.usdValue)} moved via ${best.kind.replace(/_/g, " ").toLowerCase()}.`,
      attribution: node.attribution,
    })
    if (node.kind === "EXCHANGE" || node.kind === "MIXER") break
    cursor = best.target
  }
  return steps
}

export async function runInvestigation(
  ctx: AnalysisContext,
  meta: {
    caseId: string
    complaintRef: string
    complaintText: string
    connectedVictims: number
    // Existing high-severity alerts for this wallet, reused by the
    // Investigation Intelligence engine. Optional so seeding (which raises
    // alerts AFTER the investigation) can omit them safely.
    alerts?: Alert[]
    // Requested fund-trace hop depth (1-3, default 2). Clamped again inside
    // traceFundsFromContext/FundTracingEngine regardless of what is passed.
    traceMaxHops?: number
  },
): Promise<InvestigationResult> {
  const risk = computeRisk(ctx)
  const exitPoint = runExitPoint(ctx)
  const fundDna = runFundDna(ctx)
  const ghostWallet = runGhostWallet(ctx)
  const laundering = runLaunderingRadar(ctx)
  const fraudprint = runFraudprint(ctx, meta.complaintText)
  const recover = runRecover(ctx)
  const network = runNetworkDiscovery(ctx)
  const entity = runEntityResolution(ctx)
  const crossChain = runCrossChainRadar(ctx)

  const depthReached = Math.max(0, ...ctx.graph.nodes.map((n) => n.depth ?? 0))
  const confidence = runConfidence(ctx, {
    attributionConfidence: exitPoint.result.probableVaspCount ? 0.62 : 0.4,
    hasExit: exitPoint.result.exitPoints.length > 0,
    depthReached,
  })

  const actionPack = runActionPack({
    caseId: meta.caseId,
    complaintRef: meta.complaintRef,
    reportedWallet: ctx.rootAddress,
    typology: fraudprint.result.typology,
    exit: exitPoint.result,
    recover: recover.result,
    reportedLossUsd: ctx.reportedLossUsd,
  })

  const priorityScore = computePriority({
    risk: risk.result.score,
    recoveryProbability: recover.result.recoveryProbability,
    reportedLossUsd: ctx.reportedLossUsd,
    connectedVictims: meta.connectedVictims,
    launderingScore: laundering.result.launderingScore,
  })

  // INVESTIGATION INTELLIGENCE: an explainable, transaction-level risk read
  // that reuses existing alerts and counterparty attribution. Attribution is
  // derived from the graph — if the trace touches mixer/burner infrastructure
  // that is a meaningful risk signal for this wallet.
  const riskyKinds: WalletKind[] = ["MIXER", "BURNER"]
  const riskyNode = ctx.graph.nodes.find((n) => riskyKinds.includes(n.kind))
  const intelligenceRaw = runInvestigationIntelligence({
    targetWallet: ctx.rootAddress,
    transactions: ctx.transactions,
    alerts: meta.alerts,
    attribution: riskyNode ? { kind: riskyNode.kind } : null,
    reportedLossUsd: ctx.reportedLossUsd,
  })
  const intelligence = intelligenceToIntelResult(intelligenceRaw)

  // FUND TRACING: multi-hop fund-flow graph for the "Fund Flow" investigation
  // view. Built from this same context's transactions (no new fetching) and
  // enriched with the attribution ExitPoint AI already derived above.
  const fundTrace = await traceFundsFromContext(ctx, {
    exitPoints: exitPoint.result.exitPoints,
    maxHops: meta.traceMaxHops,
  })

  const journey = buildJourney(ctx, exitPoint.result)

  const summary = [
    `Working typology: ${fraudprint.result.typology.replace(/_/g, " ")}.`,
    `Reported loss ~${usd(ctx.reportedLossUsd)}; ${usd(exitPoint.result.totalToExits)} traced to ${exitPoint.result.exitPoints.length} exit endpoint(s).`,
    `${ghostWallet.result.suspectedBurnerCount} burner(s) and laundering score ${laundering.result.launderingScore}/100 detected.`,
    crossChain.result.bridged ? `Cross-chain movement across ${crossChain.result.chainsInvolved.join(", ")}.` : `No cross-chain movement.`,
    `Risk ${risk.result.score}/100 (${risk.result.band}); estimated recovery ${(recover.result.recoveryProbability * 100).toFixed(0)}%.`,
    ctx.provenance === "DEMO_DATA" ? "NOTE: results derived from DEMO data." : "",
  ]
    .filter(Boolean)
    .join(" ")

  return {
    risk,
    exitPoint,
    fundDna,
    ghostWallet,
    laundering,
    fraudprint,
    recover,
    network,
    entity,
    crossChain,
    confidence,
    actionPack,
    intelligence,
    fundTrace,
    journey,
    priorityScore,
    summary,
    typology: fraudprint.result.typology,
    generatedAt: nowIso(),
  }
}

export { riskBand }
