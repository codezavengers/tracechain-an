import { NextResponse } from "next/server"
import { ensureSeeded, getCase, getInvestigation, getScenarioForCase, hydrateInvestigation } from "@/lib/store"
import { requireUser, requireRole } from "@/lib/api/session"
import { PERMISSIONS } from "@/lib/auth"
import { getRepository } from "@/lib/db"
import type { CaseStatus } from "@/lib/types"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const { id } = await params
  let c = getCase(id)
  if (!c) {
    // Attempt to restore a persisted investigation into the store (survives a
    // server restart when a persistent database is configured).
    const repo = getRepository()
    if (repo.persistenceMode === "POSTGRES") {
      await repo.init()
      const record = await repo.getInvestigation(id)
      if (record) {
        hydrateInvestigation(record)
        c = getCase(id)
      }
    }
  }
  if (!c) return NextResponse.json({ error: "Case not found." }, { status: 404 })
  const investigation = getInvestigation(id) ?? null
  const scenario = getScenarioForCase(id)
  return NextResponse.json({
    case: c,
    investigation,
    graph: scenario ? { rootAddress: scenario.reportedWallet, chain: scenario.chain, depth: 5, nodes: scenario.nodes, edges: scenario.edges, provenance: "DEMO_DATA" } : null,
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded()
  const auth = await requireRole(PERMISSIONS.editCase)
  if ("response" in auth) return auth.response
  const { id } = await params
  const c = getCase(id)
  if (!c) return NextResponse.json({ error: "Case not found." }, { status: 404 })

  let body: { status?: CaseStatus; investigator?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }
  const now = new Date().toISOString()
  if (body.status && body.status !== c.status) {
    c.activity.push({
      id: `a_${c.activity.length + 1}`,
      actor: auth.user.name,
      action: "STATUS_CHANGED",
      detail: `Status changed ${c.status} → ${body.status}.`,
      createdAt: now,
    })
    c.status = body.status
  }
  if (body.investigator && body.investigator !== c.investigator) {
    c.activity.push({
      id: `a_${c.activity.length + 1}`,
      actor: auth.user.name,
      action: "REASSIGNED",
      detail: `Reassigned ${c.investigator} → ${body.investigator}.`,
      createdAt: now,
    })
    c.investigator = body.investigator
  }
  c.updatedAt = now
  return NextResponse.json({ case: c })
}
