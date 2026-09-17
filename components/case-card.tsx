import Link from "next/link"
import { ChevronRight, Users, Coins } from "lucide-react"
import { Card } from "@/components/ui/card"
import { RiskBadge, StatusBadge, ProvenanceBadge } from "@/components/intel/shared"
import { CHAIN_LABEL, usd, relTime, titleFromTypology } from "@/lib/client/format"
import type { InvestigationCase } from "@/lib/types"
import { cn } from "@/lib/utils"

export function CaseRow({ c }: { c: InvestigationCase }) {
  return (
    <Link href={`/cases/${c.id}`} className="block">
      <Card className="group transition-colors hover:border-primary/40">
        <div className="flex items-center gap-4 p-4">
          <div className="flex w-14 shrink-0 flex-col items-center">
            <PriorityRing score={c.priorityScore} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">{c.title}</p>
              <span className="font-mono text-[11px] text-muted-foreground">{c.id}</span>
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground">{c.reportedWallet}</p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <StatusBadge status={c.status} />
              <RiskBadge score={c.riskScore} band={c.riskBand} />
              <span className="text-[11px] text-muted-foreground">{CHAIN_LABEL[c.chain]}</span>
              <span className="text-[11px] text-muted-foreground">· {titleFromTypology(c.typology)}</span>
            </div>
          </div>
          <div className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Coins className="size-3" /> {usd(c.reportedLossUsd)} loss
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="size-3" /> {c.connectedVictims} victims
            </span>
            <span className="text-[11px] text-muted-foreground">{relTime(c.updatedAt)}</span>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </Card>
    </Link>
  )
}

export function PriorityRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const color =
    score >= 81 ? "var(--risk-critical)" : score >= 61 ? "var(--risk-high)" : score >= 31 ? "var(--risk-medium)" : "var(--risk-low)"
  return (
    <div className="relative" style={{ width: size, height: size }} title={`Priority ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (circ * Math.min(100, score)) / 100}
        />
      </svg>
      <span
        className={cn("absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular")}
        style={{ color }}
      >
        {score}
      </span>
    </div>
  )
}

export { ProvenanceBadge }
