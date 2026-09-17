import type { InvestigationCase } from "@/lib/types"
import type { InvestigationResult } from "./index"
import { usd } from "./context"

export interface AssistantAnswer {
  answer: string
  sources: string[]
  provenance: string
}

// TRACE ASSISTANT / INVESTIGATION COPILOT
// Grounded, rule-based Q&A over a completed investigation. It answers ONLY
// from computed results (no fabrication) and always states provenance.
export function askTraceAssistant(
  question: string,
  ctx: { case: InvestigationCase; investigation: InvestigationResult | null },
): AssistantAnswer {
  const q = question.toLowerCase()
  const inv = ctx.investigation
  const sources: string[] = []
  const provenance = ctx.case.provenance === "DEMO_DATA" ? "Derived from DEMO data" : "Derived from heuristic analysis"

  if (!inv) {
    return {
      answer:
        "No investigation results are available yet for this case. Run the investigation first, then I can answer questions grounded in the computed intelligence.",
      sources: [],
      provenance,
    }
  }

  const say = (text: string, src: string[]) => ({ answer: text, sources: src, provenance })

  if (q.includes("exit") || q.includes("exchange") || q.includes("vasp") || q.includes("cash")) {
    const exits = inv.exitPoint.result.exitPoints
    sources.push("ExitPoint AI")
    if (!exits.length) return say("No clear exit endpoint was identified within the current trace depth. Consider extending the depth.", sources)
    const top = exits[0]
    return say(
      `The primary exit point is ${top.address} (${top.attribution.category} attribution${top.attribution.vasp ? `, heuristically ${top.attribution.vasp.name}` : ""}), which received ${usd(top.inboundValue)}. In total ${usd(inv.exitPoint.result.totalToExits)} reached ${exits.length} exit endpoint(s). All exchange attributions are PROBABLE and unverified.`,
      sources,
    )
  }

  if (q.includes("burner") || q.includes("ghost")) {
    sources.push("Ghost Wallet Detector")
    const b = inv.ghostWallet.result
    return say(
      b.suspectedBurnerCount
        ? `${b.suspectedBurnerCount} suspected burner wallet(s) were detected. The strongest is ${b.burners[0].address} at ${(b.burners[0].score * 100).toFixed(0)}% likelihood — ${b.burners[0].signals[0]}`
        : "No burner-pattern wallets were detected in the current trace.",
      sources,
    )
  }

  if (q.includes("launder") || q.includes("mix") || q.includes("pattern")) {
    sources.push("Laundering Radar")
    const l = inv.laundering.result
    return say(
      `Laundering score is ${l.launderingScore}/100. Detected patterns: ${l.patterns.map((p) => p.pattern).join(", ") || "none"}. ${l.patterns[0]?.detail ?? ""}`,
      sources,
    )
  }

  if (q.includes("recover") || q.includes("get back") || q.includes("probability")) {
    sources.push("Recover AI")
    const r = inv.recover.result
    return say(
      `Estimated recovery probability is ${(r.recoveryProbability * 100).toFixed(0)}%. About ${usd(r.atExchangeUsd)} reached exchange endpoints where action is possible, while ~${usd(r.dispersedUsd)} appears dispersed. This is an estimate to prioritize effort, not a guarantee.`,
      sources,
    )
  }

  if (q.includes("cross") || q.includes("bridge") || q.includes("chain")) {
    sources.push("CrossChain Radar")
    const c = inv.crossChain.result
    return say(
      c.bridged
        ? `Yes — cross-chain movement was detected across ${c.chainsInvolved.join(", ")}. ${usd(c.relinkedValue)} was bridged and re-linked on the destination chain.`
        : "No cross-chain bridge activity was detected in this trace.",
      sources,
    )
  }

  if (q.includes("typolog") || q.includes("type of") || q.includes("kind of fraud") || q.includes("classif")) {
    sources.push("Fraudprint AI")
    return say(
      `The working typology is ${inv.fraudprint.result.typology.replace(/_/g, " ")} (${(inv.fraudprint.confidence * 100).toFixed(0)}% confidence). Key indicators: ${inv.fraudprint.result.indicators.slice(0, 2).join("; ")}.`,
      sources,
    )
  }

  if (q.includes("risk") || q.includes("priorit") || q.includes("severity")) {
    sources.push("Risk Engine", "Case Priority AI")
    return say(
      `Risk score is ${inv.risk.result.score}/100 (${inv.risk.result.band}). Priority score is ${inv.priorityScore}/100. Top risk factor: ${inv.risk.result.factors[0].label}.`,
      sources,
    )
  }

  if (q.includes("summary") || q.includes("overview") || q.includes("what happened") || q.includes("brief")) {
    sources.push("Full investigation")
    return say(inv.summary, sources)
  }

  if (q.includes("next") || q.includes("action") || q.includes("do now") || q.includes("recommend")) {
    sources.push("ActionPack AI")
    return say(
      `Recommended next steps (DRAFT — requires review): ${inv.actionPack.result.actions.slice(0, 3).map((a) => a.action).join("; ")}.`,
      sources,
    )
  }

  return say(
    "I can answer questions about exit points, burner wallets, laundering patterns, recovery probability, cross-chain movement, fraud typology, risk/priority, a case summary, or recommended next steps. Ask about any of these and I'll answer strictly from the computed results.",
    ["Trace Assistant"],
  )
}

export const ASSISTANT_SUGGESTIONS = [
  "Give me a summary of this case",
  "Where did the funds exit?",
  "Were any burner wallets used?",
  "What laundering patterns were detected?",
  "What is the recovery probability?",
  "Was there cross-chain movement?",
  "What are the recommended next steps?",
]
