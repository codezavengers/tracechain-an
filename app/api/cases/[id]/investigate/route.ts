import { NextResponse } from "next/server"
import { ensureSeeded, getCase, getStore, getScenarioForCase, appendEvidence } from "@/lib/store"
import { requireRole } from "@/lib/api/session"
import { PERMISSIONS } from "@/lib/auth"
import { blockchain } from "@/lib/blockchain"
import { buildContext } from "@/lib/engines/context"
import { runInvestigation } from "@/lib/engines"
import type { GraphNode, GraphEdge, Transaction } from "@/lib/types"

// Runs the full multi-engine investigation for a case.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded()
  const auth = await requireRole(PERMISSIONS.runInvestigation)
  if ("response" in auth) return auth.response
  const { id } = await params
  const c = getCase(id)
  if (!c) return NextResponse.json({ error: "Case not found." }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const depth: number = [1, 2, 3, 5].includes(body?.depth) ? body.depth : 5
  // Requested fund-trace hop depth (1-3, default 2, hard max 3) — independent
  // of the graph-reconstruction `depth` above.
  const traceMaxHops: number =
    Number.isFinite(body?.traceMaxHops) && body.traceMaxHops >= 1
      ? Math.min(3, Math.round(body.traceMaxHops))
      : 2

  const store = getStore()
  const scenario = getScenarioForCase(id)

  let nodes: GraphNode[] = []
  let edges: GraphEdge[] = []
  let transactions: Transaction[] = []
  let crossChain = scenario?.crossChain

  if (scenario) {
    nodes = scenario.nodes
    edges = scenario.edges
    transactions = scenario.transactions
  } else {
    // Manual case: build a minimal graph from the production provider layer
    // (LIVE/INDEXED when the chain is configured, honest MOCK fallback
    // otherwise) — the same service the wallet-investigation route uses,
    // rather than the legacy LiveProvider scaffold whose read methods are
    // unimplemented stubs that would throw for any configured live chain.
    const txRes = await blockchain.getTransactions(c.reportedWallet, c.chain)
    transactions = txRes.data
    const nodeSet = new Map<string, GraphNode>()
    nodeSet.set(c.reportedWallet, {
      id: c.reportedWallet,
      kind: "SUSPICIOUS",
      chain: c.chain,
      depth: 0,
      provenance: c.provenance,
      attribution: "UNKNOWN",
    })
    transactions.forEach((t, i) => {
      for (const addr of [t.from, t.to]) {
        if (!nodeSet.has(addr)) {
          nodeSet.set(addr, { id: addr, kind: "UNKNOWN", chain: t.chain, depth: 1, provenance: c.provenance, attribution: "UNKNOWN" })
        }
      }
      edges.push({
        id: `e_${i}`,
        source: t.from,
        target: t.to,
        kind: t.from === c.reportedWallet ? "SENT_FUNDS" : "RECEIVED_FUNDS",
        amount: t.amount,
        asset: t.asset,
        // GraphEdge requires concrete values for visualization; a
        // provider-honest null (unknown price / unresolved block timestamp)
        // falls back to a neutral default rather than a fabricated "now".
        usdValue: t.usdValue ?? 0,
        timestamp: t.timestamp ?? c.createdAt,
        txHash: t.hash,
      })
    })
    nodes = Array.from(nodeSet.values())
  }

  const ctx = buildContext({
    chain: c.chain,
    rootAddress: c.reportedWallet,
    reportedLossUsd: c.reportedLossUsd,
    nodes,
    edges,
    transactions,
    depth,
    provenance: c.provenance,
    crossChain,
  })
  const investigation = await runInvestigation(ctx, {
    caseId: c.id,
    complaintRef: c.complaintRef,
    complaintText: c.complaintText,
    connectedVictims: c.connectedVictims || scenario?.connectedVictims || 0,
    // Reuse alerts already raised for this case's reported wallet so the
    // Investigation Intelligence engine can factor them into its risk read.
    alerts: store.alerts.filter((a) => a.caseId === id),
    traceMaxHops,
  })

  // Persist derived case fields.
  c.typology = investigation.typology
  c.riskScore = investigation.risk.result.score
  c.riskBand = investigation.risk.result.band
  c.priorityScore = investigation.priorityScore
  c.traceableUsd = investigation.recover.result.traceableUsd
  c.recoveryProbability = investigation.recover.result.recoveryProbability
  if (scenario) c.connectedVictims = scenario.connectedVictims
  if (c.status === "NEW") c.status = "ANALYZING"
  const now = new Date().toISOString()
  c.updatedAt = now
  c.activity.push({
    id: `a_${c.activity.length + 1}`,
    actor: auth.user.name,
    action: "INVESTIGATION_RUN",
    detail: `Multi-engine investigation completed at depth ${depth}. Risk ${c.riskScore}/100.`,
    createdAt: now,
  })
  store.investigations.set(id, investigation)

  await appendEvidence({
    caseId: id,
    type: "INVESTIGATION_RESULT",
    title: `Investigation run (depth ${depth})`,
    summary: investigation.summary,
    content: {
      risk: c.riskScore,
      priority: c.priorityScore,
      typology: c.typology,
      depth,
      // Persist the intelligence read alongside the run so it survives with
      // the evidence chain, not only inside the (also-persisted) result.
      intelligence: {
        overallRiskScore: investigation.intelligence.result.overallRiskScore,
        riskLevel: investigation.intelligence.result.riskLevel,
        confidence: investigation.intelligence.result.confidence,
        detectedPatterns: investigation.intelligence.result.detectedPatterns.map((p) => p.type),
      },
    },
    createdBy: auth.user.name,
    provenance: "HEURISTIC_ANALYSIS",
  })

  return NextResponse.json({ case: c, investigation })
}
