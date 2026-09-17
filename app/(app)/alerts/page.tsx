"use client"

import * as React from "react"
import { Bell, CheckCheck } from "lucide-react"
import { SectionHeading, StatTile } from "@/components/intel/shared"
import { AlertItem } from "@/components/alert-item"
import { Tabs } from "@/components/ui/tabs"
import { LoadingBlock, ErrorState, EmptyState } from "@/components/ui/feedback"
import { useAlerts, apiPost, useSession } from "@/lib/client/hooks"
import { PERMISSIONS } from "@/lib/auth"
import type { RiskBand } from "@/lib/types"

export default function AlertsPage() {
  const { user } = useSession()
  const canAck = user ? PERMISSIONS.acknowledgeAlert(user.role) : false
  const { data, error, isLoading, mutate } = useAlerts()
  const [filter, setFilter] = React.useState("all")
  const [acking, setAcking] = React.useState<string | null>(null)

  const alerts = data?.alerts ?? []
  const unack = alerts.filter((a) => !a.acknowledged).length
  const critical = alerts.filter((a) => a.severity === "CRITICAL").length

  const filtered = alerts.filter((a) => {
    if (filter === "unack") return !a.acknowledged
    if (filter === "critical") return a.severity === "CRITICAL" || a.severity === "HIGH"
    return true
  })

  async function ack(id: string) {
    if (!canAck) return
    setAcking(id)
    try {
      await apiPost(`/api/alerts/${id}`, undefined, "PATCH")
      await mutate()
    } finally {
      setAcking(null)
    }
  }

  const bandCount = (b: RiskBand) => alerts.filter((a) => a.severity === b).length

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeading
        title="Alert Center"
        description="Automated alerts raised by the risk, exit-point and watchtower engines. Acknowledge alerts as you action them."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total alerts" value={alerts.length} icon={Bell} accent="var(--primary)" />
        <StatTile label="Unacknowledged" value={unack} icon={CheckCheck} accent="var(--risk-high)" />
        <StatTile label="Critical" value={critical} accent="var(--risk-critical)" />
        <StatTile label="High" value={bandCount("HIGH")} accent="var(--risk-high)" />
      </div>

      <Tabs
        items={[
          { value: "all", label: `All (${alerts.length})` },
          { value: "unack", label: `Unacknowledged (${unack})` },
          { value: "critical", label: "High & Critical" },
        ]}
        value={filter}
        onValueChange={setFilter}
      />

      {error ? <ErrorState message={error.message} /> : null}
      {isLoading ? (
        <LoadingBlock label="Loading alerts…" />
      ) : filtered.length ? (
        <div className="space-y-2">
          {filtered.map((a) => (
            <AlertItem key={a.id} alert={a} onAck={canAck ? ack : undefined} acking={acking === a.id} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Bell} title="No alerts" description="Nothing matches this filter." />
      )}
    </div>
  )
}
