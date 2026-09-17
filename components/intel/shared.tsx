"use client"

import * as React from "react"
import { Check, Copy, Info, Lightbulb, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type {
  DataProvenance,
  RiskBand,
  CaseStatus,
  IntelResult,
  AttributionCategory,
  WalletKind,
} from "@/lib/types"
import {
  PROVENANCE_LABEL,
  STATUS_LABEL,
  WALLET_KIND_LABEL,
  riskColorVar,
  shortAddr,
  pct,
} from "@/lib/client/format"

export function ProvenanceBadge({ provenance }: { provenance: DataProvenance }) {
  const live = provenance === "LIVE_BLOCKCHAIN_DATA"
  const known = provenance === "KNOWN_ATTRIBUTION"
  const color = live || known ? "var(--live)" : provenance === "DEMO_DATA" ? "var(--demo)" : "var(--muted-foreground)"
  return (
    <Badge
      variant="outline"
      className="tabular"
      style={{ color, borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}
      title="Data honesty label — how this result was derived"
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {PROVENANCE_LABEL[provenance]}
    </Badge>
  )
}

const SOURCE_TYPE_LABEL: Record<"RAW_RPC" | "LIVE_NATIVE_API", string> = {
  RAW_RPC: "Raw RPC",
  LIVE_NATIVE_API: "Native API",
}

const SOURCE_TYPE_HINT: Record<"RAW_RPC" | "LIVE_NATIVE_API", string> = {
  RAW_RPC: "Fetched directly from a native chain node via JSON-RPC — no third-party indexer involved.",
  LIVE_NATIVE_API: "Fetched from the chain's own official full-node HTTP API — not a third-party indexer/explorer.",
}

// How this specific movement was actually retrieved, distinct from
// ProvenanceBadge (which says whether the movement is real or demo at all).
export function SourceTypeBadge({ sourceType }: { sourceType?: "RAW_RPC" | "LIVE_NATIVE_API" | null }) {
  if (!sourceType) return null
  return (
    <span
      className="inline-flex items-center rounded-sm border border-border/70 px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
      title={SOURCE_TYPE_HINT[sourceType]}
    >
      {SOURCE_TYPE_LABEL[sourceType]}
    </span>
  )
}

export function RiskBadge({ score, band }: { score: number; band: RiskBand }) {
  const color = riskColorVar(band)
  return (
    <Badge
      className="tabular font-semibold"
      style={{
        color,
        background: `color-mix(in oklch, ${color} 16%, transparent)`,
        borderColor: `color-mix(in oklch, ${color} 40%, transparent)`,
      }}
    >
      {band} · {score}
    </Badge>
  )
}

const STATUS_COLOR: Record<CaseStatus, string> = {
  NEW: "var(--muted-foreground)",
  ANALYZING: "var(--demo)",
  TRACING: "var(--demo)",
  VASP_IDENTIFIED: "var(--risk-medium)",
  ACTION_REQUIRED: "var(--risk-high)",
  FREEZE_REVIEW: "var(--risk-critical)",
  MONITORING: "var(--risk-low)",
  CLOSED: "var(--muted-foreground)",
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const color = STATUS_COLOR[status]
  return (
    <Badge
      variant="outline"
      style={{ color, borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}
    >
      {STATUS_LABEL[status]}
    </Badge>
  )
}

const KIND_COLOR: Partial<Record<WalletKind, string>> = {
  VICTIM: "var(--demo)",
  SUSPICIOUS: "var(--risk-high)",
  BURNER: "var(--risk-critical)",
  MIXER: "var(--risk-critical)",
  BRIDGE: "var(--chart-2)",
  EXCHANGE: "var(--risk-low)",
  VASP: "var(--risk-low)",
  DEFI: "var(--chart-2)",
  FRAUD_CLUSTER: "var(--risk-high)",
  UNKNOWN: "var(--muted-foreground)",
}

export function KindBadge({ kind }: { kind: WalletKind }) {
  const color = KIND_COLOR[kind] ?? "var(--muted-foreground)"
  return (
    <Badge variant="outline" style={{ color, borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}>
      {WALLET_KIND_LABEL[kind]}
    </Badge>
  )
}

export function AttributionBadge({ category }: { category: AttributionCategory }) {
  const color =
    category === "KNOWN" ? "var(--risk-low)" : category === "PROBABLE" ? "var(--risk-medium)" : "var(--muted-foreground)"
  return (
    <Badge variant="outline" style={{ color, borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}>
      {category}
    </Badge>
  )
}

export function ConfidenceBar({ value, label = "Confidence" }: { value: number; label?: string }) {
  const w = Math.max(0, Math.min(100, value * 100))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular font-medium text-foreground">{pct(value)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

export function CopyAddress({
  address,
  className,
  full = false,
}: {
  address: string
  className?: string
  full?: boolean
}) {
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(address)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className={cn(
        "group inline-flex items-center gap-1.5 font-mono text-xs text-foreground/90 hover:text-primary transition-colors",
        className,
      )}
      title={address}
    >
      <span className="tabular">{full ? address : shortAddr(address)}</span>
      {copied ? (
        <Check className="size-3 text-risk-low" />
      ) : (
        <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
      )}
    </button>
  )
}

// Standard envelope card for any engine's IntelResult.
export function IntelResultCard({
  title,
  icon: Icon,
  result,
  children,
}: {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  result: Pick<IntelResult, "confidence" | "explanation" | "evidence" | "recommendation" | "analysisType" | "provenance">
  children?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            {Icon ? <Icon className="size-4 text-primary" /> : null}
            {title}
          </CardTitle>
          <ProvenanceBadge provenance={result.provenance} />
        </div>
        <div className="max-w-xl">
          <ConfidenceBar value={result.confidence} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
          <ExplainRow icon={Info} label="Explanation" tone="muted">
            {result.explanation}
          </ExplainRow>
          {result.evidence?.length ? (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ShieldCheck className="size-3" /> Evidence
              </p>
              <ul className="ml-1 space-y-1">
                {result.evidence.map((e, i) => (
                  <li key={i} className="flex gap-2 text-xs text-foreground/80">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/70" />
                    <span className="leading-relaxed">{e}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ExplainRow icon={Lightbulb} label="Recommendation" tone="primary">
            {result.recommendation}
          </ExplainRow>
          <div className="flex items-center gap-2 pt-1">
            <Badge variant="muted" className="uppercase">
              {result.analysisType}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ExplainRow({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone: "muted" | "primary"
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <p
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide",
          tone === "primary" ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon className="size-3" /> {label}
      </p>
      <p className="text-xs leading-relaxed text-foreground/85 text-pretty">{children}</p>
    </div>
  )
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  accent?: string
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {Icon ? <Icon className="size-4" style={{ color: accent ?? "var(--muted-foreground)" }} /> : null}
        </div>
        <p className="mt-2 text-2xl font-semibold tabular tracking-tight text-foreground">{value}</p>
        {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

export function SectionHeading({
  title,
  description,
  right,
}: {
  title: string
  description?: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground text-balance">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{description}</p> : null}
      </div>
      {right}
    </div>
  )
}
