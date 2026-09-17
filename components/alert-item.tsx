"use client"

import Link from "next/link"
import { AlertTriangle, Check } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CopyAddress } from "@/components/intel/shared"
import { riskColorVar, relTime, humanize } from "@/lib/client/format"
import type { Alert } from "@/lib/types"

export function AlertItem({
  alert,
  onAck,
  acking,
}: {
  alert: Alert
  onAck?: (id: string) => void
  acking?: boolean
}) {
  const color = riskColorVar(alert.severity)
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-card/60 p-3">
      <div
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md"
        style={{ background: `color-mix(in oklch, ${color} 16%, transparent)`, color }}
      >
        <AlertTriangle className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" style={{ color, borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}>
            {alert.severity}
          </Badge>
          <span className="text-xs font-medium text-foreground">{humanize(alert.type)}</span>
          {alert.acknowledged ? <Badge variant="muted">Acknowledged</Badge> : null}
        </div>
        <p className="text-xs leading-relaxed text-foreground/80">{alert.message}</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <CopyAddress address={alert.walletAddress} />
          <span>· {relTime(alert.createdAt)}</span>
          {alert.caseId ? (
            <Link href={`/cases/${alert.caseId}`} className="text-primary hover:underline">
              {alert.caseId}
            </Link>
          ) : null}
        </div>
      </div>
      {onAck && !alert.acknowledged ? (
        <Button size="xs" variant="outline" onClick={() => onAck(alert.id)} disabled={acking}>
          <Check className="size-3" /> Ack
        </Button>
      ) : null}
    </div>
  )
}
