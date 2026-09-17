import { NextResponse } from "next/server"
import { ensureSeeded, listCases, getStore, getCase, nextCaseId, appendEvidence, hydrateInvestigation } from "@/lib/store"
import { getScenarioForCase } from "@/lib/store"
import { getRepository } from "@/lib/db"
import { requireUser, requireRole } from "@/lib/api/session"
import { PERMISSIONS } from "@/lib/auth"
import { validateAddress, extractWalletsFromText } from "@/lib/blockchain/address-utils"
import { blockchain } from "@/lib/blockchain"
import { buildContext } from "@/lib/engines/context"
import { runInvestigation } from "@/lib/engines"
import { getDemoScenarios } from "@/lib/data/demo-dataset"
import type { InvestigationCase, Chain } from "@/lib/types"

export async function GET() {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response

  // In persistent mode, rehydrate any saved investigations that are not yet in
  // the in-memory store (e.g. after a server restart) so the case list and
  // reopen keep working across restarts.
  const repo = getRepository()
  if (repo.persistenceMode === "POSTGRES") {
    await repo.init()
    // Only rehydrate investigations visible to this investigator (their own +
    // shared/seeded) so another user's private cases are not pulled into the
    // shared in-memory view.
    const saved = await repo.listInvestigations(auth.user.id)
    for (const item of saved) {
      if (!getCase(item.id)) {
        const record = await repo.getInvestigation(item.id)
        if (record) hydrateInvestigation(record)
      }
    }
  }

  return NextResponse.json({ cases: listCases(), persistenceMode: repo.persistenceMode })
}

export async function POST(req: Request) {
  await ensureSeeded()
  const auth = await requireRole(PERMISSIONS.createCase)
  if ("response" in auth) return auth.response

  let body: {
    title?: string
    complaintRef?: string
    complaintText?: string
    reportedWallet?: string
    chain?: Chain
    reportedLossUsd?: number
    demoScenarioId?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const store = getStore()

  // Path A: create from a demo scenario (clones seeded intelligence).
  if (body.demoScenarioId) {
    const scenario = getDemoScenarios().find((s) => s.id === body.demoScenarioId)
    if (!scenario) return NextResponse.json({ error: "Unknown demo scenario." }, { status: 404 })
    const caseId = nextCaseId()
    const ctx = buildContext({
      chain: scenario.chain,
      rootAddress: scenario.reportedWallet,
      reportedLossUsd: scenario.reportedLossUsd,
      nodes: scenario.nodes,
      edges: scenario.edges,
      transactions: scenario.transactions,
      depth: 5,
      provenance: "DEMO_DATA",
      crossChain: scenario.crossChain,
    })
    const investigation = await runInvestigation(ctx, {
      caseId,
      complaintRef: scenario.complaintRef,
      complaintText: scenario.complaintText,
      connectedVictims: scenario.connectedVictims,
    })
    const now = new Date().toISOString()
    const c: InvestigationCase = {
      id: caseId,
      complaintRef: scenario.complaintRef,
      title: scenario.name,
      reportedWallet: scenario.reportedWallet,
      chain: scenario.chain,
      complaintText: scenario.complaintText,
      extractedWallets: [scenario.reportedWallet],
      typology: investigation.typology,
      riskScore: investigation.risk.result.score,
      riskBand: investigation.risk.result.band,
      priorityScore: investigation.priorityScore,
      status: "NEW",
      investigator: auth.user.name,
      reportedLossUsd: scenario.reportedLossUsd,
      traceableUsd: investigation.recover.result.traceableUsd,
      recoveryProbability: investigation.recover.result.recoveryProbability,
      connectedVictims: scenario.connectedVictims,
      createdAt: now,
      updatedAt: now,
      notes: [],
      activity: [
        { id: "a1", actor: auth.user.name, action: "CASE_CREATED", detail: `Demo scenario '${scenario.name}' instantiated.`, createdAt: now },
      ],
      provenance: "DEMO_DATA",
      demoScenario: scenario.typology,
    }
    store.cases.push(c)
    store.investigations.set(caseId, investigation)
    store.scenarioByCase.set(caseId, scenario)
    await appendEvidence({
      caseId,
      type: "CASE_SNAPSHOT",
      title: "Initial case snapshot",
      summary: `Snapshot for ${scenario.reportedWallet}.`,
      content: { rootAddress: scenario.reportedWallet },
      createdBy: auth.user.name,
      provenance: "DEMO_DATA",
    })
    return NextResponse.json({ case: c }, { status: 201 })
  }

  // Path B: create from complaint text / wallet.
  const complaintText = (body.complaintText ?? "").trim()
  let reportedWallet = (body.reportedWallet ?? "").trim()
  const extracted = complaintText ? extractWalletsFromText(complaintText) : []
  if (!reportedWallet && extracted.length) reportedWallet = extracted[0].address

  if (!reportedWallet) {
    return NextResponse.json(
      { error: "No wallet address provided or extractable from the complaint text." },
      { status: 400 },
    )
  }

  const validation = validateAddress(reportedWallet, body.chain)
  if (!validation.valid || !validation.chain) {
    return NextResponse.json({ error: validation.reason || "Invalid wallet address." }, { status: 400 })
  }
  const chain = (body.chain && validation.candidateChains.includes(body.chain) ? body.chain : validation.chain) as Chain

  const caseId = nextCaseId()
  const now = new Date().toISOString()
  const reportedLossUsd = Number(body.reportedLossUsd) || 0

  // Pull transactions/graph from the production provider layer (LIVE/INDEXED
  // when the chain is configured, honest MOCK fallback otherwise). Uses the
  // same service the wallet-investigation route uses, rather than the
  // legacy LiveProvider scaffold whose read methods are unimplemented stubs.
  const txRes = await blockchain.getTransactions(reportedWallet, chain)
  const txs = txRes.data
  const isLive = txRes.dataSource !== "MOCK"

  const c: InvestigationCase = {
    id: caseId,
    complaintRef: body.complaintRef || `MANUAL/${caseId}`,
    title: body.title || `Investigation ${caseId}`,
    reportedWallet,
    chain,
    complaintText,
    extractedWallets: extracted.length ? extracted.map((e) => e.address) : [reportedWallet],
    typology: "UNKNOWN",
    riskScore: 0,
    riskBand: "LOW",
    priorityScore: 0,
    status: "NEW",
    investigator: auth.user.name,
    reportedLossUsd,
    traceableUsd: 0,
    recoveryProbability: 0,
    connectedVictims: 0,
    createdAt: now,
    updatedAt: now,
    notes: [],
    activity: [
      {
        id: "a1",
        actor: auth.user.name,
        action: "CASE_CREATED",
        detail: `Case opened for ${reportedWallet} on ${chain} (${isLive ? "LIVE" : "DEMO"} mode). ${txs.length} transaction(s) available.`,
        createdAt: now,
      },
    ],
    provenance: isLive ? "LIVE_BLOCKCHAIN_DATA" : "DEMO_DATA",
  }
  store.cases.push(c)
  await appendEvidence({
    caseId,
    type: "CASE_SNAPSHOT",
    title: "Initial case snapshot",
    summary: `Manual case for ${reportedWallet}. ${extracted.length} wallet(s) extracted from complaint.`,
    content: { reportedWallet, chain, extracted },
    createdBy: auth.user.name,
    provenance: c.provenance,
  })

  return NextResponse.json({ case: c, note: "Run investigation to populate intelligence." }, { status: 201 })
}
