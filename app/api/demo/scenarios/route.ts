import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api/session"
import { getDemoScenarios } from "@/lib/data/demo-dataset"

export async function GET() {
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const scenarios = getDemoScenarios().map((s) => ({
    id: s.id,
    typology: s.typology,
    name: s.name,
    chain: s.chain,
    crossChain: s.crossChain,
    complaintRef: s.complaintRef,
    complaintText: s.complaintText,
    reportedWallet: s.reportedWallet,
    reportedLossUsd: s.reportedLossUsd,
    connectedVictims: s.connectedVictims,
    nodeCount: s.nodes.length,
    edgeCount: s.edges.length,
    narrative: s.narrative,
  }))
  return NextResponse.json({ scenarios })
}
