import { NextResponse } from "next/server"
import { ensureSeeded, listCases, listAlerts, listWatchlist, getInvestigation } from "@/lib/store"
import { requireUser } from "@/lib/api/session"

export async function GET() {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response

  const cases = listCases()
  const alerts = listAlerts()
  const watchlist = listWatchlist()

  const activeStatuses = ["ANALYZING", "TRACING", "VASP_IDENTIFIED", "ACTION_REQUIRED", "FREEZE_REVIEW"]
  let probableExitPoints = 0
  let connectedVictims = 0
  for (const c of cases) {
    const inv = getInvestigation(c.id)
    if (inv) probableExitPoints += inv.exitPoint.result.probableVaspCount
    connectedVictims += c.connectedVictims
  }

  const stats = {
    totalCases: cases.length,
    activeInvestigations: cases.filter((c) => activeStatuses.includes(c.status)).length,
    criticalAlerts: alerts.filter((a) => a.severity === "CRITICAL" && !a.acknowledged).length,
    unacknowledgedAlerts: alerts.filter((a) => !a.acknowledged).length,
    trackedWallets: watchlist.length,
    probableExitPoints,
    connectedVictims,
    highPriorityCases: cases.filter((c) => c.priorityScore >= 61).length,
    watchlistActivity: watchlist.filter((w) => w.status === "TRIGGERED").length,
    totalReportedLossUsd: cases.reduce((s, c) => s + c.reportedLossUsd, 0),
    totalTraceableUsd: cases.reduce((s, c) => s + c.traceableUsd, 0),
  }

  const riskDistribution = {
    LOW: cases.filter((c) => c.riskBand === "LOW").length,
    MEDIUM: cases.filter((c) => c.riskBand === "MEDIUM").length,
    HIGH: cases.filter((c) => c.riskBand === "HIGH").length,
    CRITICAL: cases.filter((c) => c.riskBand === "CRITICAL").length,
  }

  return NextResponse.json({
    stats,
    riskDistribution,
    recentCases: cases.slice(0, 6),
    recentAlerts: alerts.slice(0, 6),
  })
}
