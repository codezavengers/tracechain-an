"use client"

import Link from "next/link"
import {
  Briefcase,
  Activity,
  AlertOctagon,
  Eye,
  LogOut as ExitIcon,
  Users,
  Flame,
  Radar,
  FilePlus2,
} from "lucide-react"
import { useDashboard } from "@/lib/client/hooks"
import { StatTile, SectionHeading } from "@/components/intel/shared"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LinkButton } from "@/components/ui/link-button"
import { LoadingBlock, ErrorState, EmptyState } from "@/components/ui/feedback"
import { CaseRow } from "@/components/case-card"
import { AlertItem } from "@/components/alert-item"
import { usd, riskColorVar } from "@/lib/client/format"
import type { RiskBand } from "@/lib/types"

export default function DashboardPage() {
  const { data, error, isLoading } = useDashboard()

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <SectionHeading
        title="Investigation Command Center"
        description="Live posture across all cryptocurrency fraud cases — fund tracing, exit-point attribution and recovery intelligence."
        right={
          <LinkButton href="/cases/new">
            <FilePlus2 className="size-4" /> New Investigation
          </LinkButton>
        }
      />

      {error ? <ErrorState message={error.message} /> : null}
      {isLoading || !data ? (
        <LoadingBlock label="Loading command center…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile label="Total cases" value={data.stats.totalCases} icon={Briefcase} accent="var(--primary)" />
            <StatTile
              label="Active investigations"
              value={data.stats.activeInvestigations}
              icon={Activity}
              accent="var(--demo)"
            />
            <StatTile
              label="Critical alerts"
              value={data.stats.criticalAlerts}
              hint={`${data.stats.unacknowledgedAlerts} unacknowledged`}
              icon={AlertOctagon}
              accent="var(--risk-critical)"
            />
            <StatTile
              label="Tracked wallets"
              value={data.stats.trackedWallets}
              hint={`${data.stats.watchlistActivity} triggered`}
              icon={Eye}
              accent="var(--risk-low)"
            />
            <StatTile
              label="Probable exit points"
              value={data.stats.probableExitPoints}
              icon={ExitIcon}
              accent="var(--risk-medium)"
            />
            <StatTile label="Connected victims" value={data.stats.connectedVictims} icon={Users} accent="var(--chart-2)" />
            <StatTile
              label="High-priority cases"
              value={data.stats.highPriorityCases}
              icon={Flame}
              accent="var(--risk-high)"
            />
            <StatTile
              label="Watchlist activity"
              value={data.stats.watchlistActivity}
              icon={Radar}
              accent="var(--primary)"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Financial exposure</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ExposureRow label="Reported loss (all cases)" value={usd(data.stats.totalReportedLossUsd)} />
                <ExposureRow
                  label="Traceable to endpoints"
                  value={usd(data.stats.totalTraceableUsd)}
                  accent="var(--risk-low)"
                />
                <div className="pt-1">
                  <p className="mb-1 text-[11px] text-muted-foreground">Traceable share of reported loss</p>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-risk-low"
                      style={{
                        width: `${Math.min(
                          100,
                          data.stats.totalReportedLossUsd
                            ? (data.stats.totalTraceableUsd / data.stats.totalReportedLossUsd) * 100
                            : 0,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Risk distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <RiskDistribution dist={data.riskDistribution} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Priority cases</h2>
                <Link href="/cases" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </div>
              {data.recentCases.length ? (
                <div className="space-y-2">
                  {data.recentCases.map((c) => (
                    <CaseRow key={c.id} c={c} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={Briefcase} title="No cases yet" description="Create an investigation to begin." />
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Recent alerts</h2>
                <Link href="/alerts" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </div>
              {data.recentAlerts.length ? (
                <div className="space-y-2">
                  {data.recentAlerts.map((a) => (
                    <AlertItem key={a.id} alert={a} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={AlertOctagon} title="No alerts" />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ExposureRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular" style={{ color: accent ?? "var(--foreground)" }}>
        {value}
      </span>
    </div>
  )
}

function RiskDistribution({ dist }: { dist: Record<RiskBand, number> }) {
  const bands: RiskBand[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
  const total = bands.reduce((s, b) => s + dist[b], 0) || 1
  const max = Math.max(...bands.map((b) => dist[b]), 1)
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {bands.map((b) =>
          dist[b] > 0 ? (
            <div
              key={b}
              style={{ width: `${(dist[b] / total) * 100}%`, background: riskColorVar(b) }}
              title={`${b}: ${dist[b]}`}
            />
          ) : null,
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {bands.map((b) => (
          <div key={b} className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: riskColorVar(b) }} />
              <span className="text-[11px] text-muted-foreground">{b}</span>
            </div>
            <p className="text-lg font-semibold tabular" style={{ color: riskColorVar(b) }}>
              {dist[b]}
            </p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${(dist[b] / max) * 100}%`, background: riskColorVar(b) }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
