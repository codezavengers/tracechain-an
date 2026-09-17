import type { IntelResult } from "@/lib/types"
import type { AnalysisContext } from "./context"
import { nowIso, clamp, usd } from "./context"
import { runExitPoint } from "./exitpoint"
import { runLaunderingRadar } from "./laundering-radar"

export interface RecoverResult {
  recoveryProbability: number // 0..1
  traceableUsd: number
  atExchangeUsd: number
  dispersedUsd: number
  factors: { label: string; impact: number; detail: string }[]
}

// RECOVER AI: estimates realistic recovery probability and traceable funds.
// Recovery hinges on (a) how much value reached a KYC'd/cooperative endpoint,
// (b) how much laundering/dispersion occurred, and (c) speed of action.
export function runRecover(ctx: AnalysisContext): IntelResult<RecoverResult> {
  const exit = runExitPoint(ctx).result
  const laundering = runLaunderingRadar(ctx).result

  const atExchangeUsd = exit.exitPoints
    .filter((e) => e.attribution.category === "PROBABLE" || e.attribution.vasp?.type === "EXCHANGE")
    .reduce((s, e) => s + e.inboundValue, 0)

  const traceableUsd = exit.totalToExits
  const dispersedUsd = Math.max(0, ctx.reportedLossUsd - traceableUsd)

  const factors: RecoverResult["factors"] = []
  let p = 0.1
  factors.push({ label: "Base rate", impact: 0.1, detail: "Conservative baseline for crypto fraud recovery." })

  const exchShare = ctx.reportedLossUsd > 0 ? atExchangeUsd / ctx.reportedLossUsd : 0
  const exchImpact = clamp(exchShare * 0.5, 0, 0.5)
  p += exchImpact
  factors.push({
    label: "Value at exchange endpoints",
    impact: +exchImpact.toFixed(2),
    detail: `~${(exchShare * 100).toFixed(0)}% of value (${usd(atExchangeUsd)}) reached a probable exchange where KYC/freeze may apply.`,
  })

  // Cooperative VASP boost
  const cooperative = exit.exitPoints.some((e) => e.attribution.vasp?.cooperationLevel === "HIGH")
  if (cooperative) {
    p += 0.1
    factors.push({ label: "Cooperative VASP", impact: 0.1, detail: "At least one endpoint attributed to a historically cooperative exchange." })
  }

  // Laundering penalty
  const laundPenalty = -clamp((laundering.launderingScore / 100) * 0.35, 0, 0.35)
  p += laundPenalty
  factors.push({
    label: "Laundering / dispersion",
    impact: +laundPenalty.toFixed(2),
    detail: `Laundering score ${laundering.launderingScore}/100 reduces recoverable share.`,
  })

  // Mixer hard penalty
  if (laundering.patterns.some((x) => x.pattern === "MIXING")) {
    p -= 0.12
    factors.push({ label: "Mixing service used", impact: -0.12, detail: "Mixing materially degrades traceability." })
  }

  const recoveryProbability = clamp(p, 0.02, 0.9)

  return {
    result: {
      recoveryProbability: +recoveryProbability.toFixed(2),
      traceableUsd: +traceableUsd.toFixed(2),
      atExchangeUsd: +atExchangeUsd.toFixed(2),
      dispersedUsd: +dispersedUsd.toFixed(2),
      factors,
    },
    confidence: 0.6,
    explanation:
      "Recover AI estimates a realistic recovery probability from the share of funds that reached cooperative/KYC'd endpoints, offset by laundering and dispersion. It is an estimate to prioritize effort — not a guarantee of recovery.",
    evidence: factors.map((f) => `${f.label}: ${f.impact >= 0 ? "+" : ""}${(f.impact * 100).toFixed(0)}% — ${f.detail}`),
    recommendation:
      recoveryProbability >= 0.4
        ? "Recovery outlook is favorable. Move quickly on VASP outreach for the value sitting at exchange endpoints."
        : "Recovery outlook is guarded. Prioritize speed and evidence preservation; escalate to specialized units.",
    analysisType: "statistical",
    provenance: "HEURISTIC_ANALYSIS",
    generatedAt: nowIso(),
  }
}
