"use client"

import {
  LogOut,
  Dna,
  Ghost,
  Radar,
  Coins,
  Network,
  Fingerprint,
  ArrowLeftRight,
  ShieldAlert,
  Gauge,
  ClipboardList,
  Users2,
  BrainCircuit,
} from "lucide-react"
import { IntelResultCard, ConfidenceBar, AttributionBadge, CopyAddress } from "@/components/intel/shared"
import { Badge } from "@/components/ui/badge"
import { usd, pct, humanize, shortAddr, CHAIN_LABEL, riskColorVar } from "@/lib/client/format"
import { riskBandOf } from "@/lib/client/format"
import type { InvestigationResult } from "@/lib/engines"

// Small labeled meter used across panels.
function Meter({ label, value, max = 100, color }: { label: string; value: number; max?: number; color?: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular font-medium text-foreground">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: color ?? "var(--primary)" }} />
      </div>
    </div>
  )
}

function StatPair({ items }: { items: { label: string; value: string; accent?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-md border border-border bg-background/40 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">{it.label}</p>
          <p className="mt-0.5 text-sm font-semibold tabular" style={{ color: it.accent ?? "var(--foreground)" }}>
            {it.value}
          </p>
        </div>
      ))}
    </div>
  )
}

export function RiskPanel({ inv }: { inv: InvestigationResult }) {
  const r = inv.risk
  return (
    <IntelResultCard title="Risk Engine" icon={Gauge} result={r}>
      <div className="flex items-center gap-3">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-bold tabular"
          style={{
            color: riskColorVar(r.result.band),
            background: `color-mix(in oklch, ${riskColorVar(r.result.band)} 15%, transparent)`,
          }}
        >
          {r.result.score}
        </div>
        <div className="space-y-1">
          <Badge
            style={{
              color: riskColorVar(r.result.band),
              borderColor: `color-mix(in oklch, ${riskColorVar(r.result.band)} 40%, transparent)`,
            }}
          >
            {r.result.band} RISK
          </Badge>
          <p className="text-[11px] text-muted-foreground">Priority score {inv.priorityScore}/100</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {r.result.factors.map((f) => (
          <div key={f.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{f.label}</span>
            <span className={`tabular font-medium ${f.points < 0 ? "text-risk-low" : "text-foreground"}`}>
              {f.points >= 0 ? "+" : ""}
              {f.points}
            </span>
          </div>
        ))}
      </div>
    </IntelResultCard>
  )
}

export function ExitPointPanel({ inv }: { inv: InvestigationResult }) {
  const e = inv.exitPoint
  return (
    <IntelResultCard title="ExitPoint AI" icon={LogOut} result={e}>
      <StatPair
        items={[
          { label: "Exit endpoints", value: String(e.result.exitPoints.length) },
          { label: "Probable VASPs", value: String(e.result.probableVaspCount), accent: "var(--risk-medium)" },
          { label: "Value to exits", value: usd(e.result.totalToExits), accent: "var(--risk-low)" },
        ]}
      />
      <div className="space-y-1.5">
        {e.result.exitPoints.slice(0, 5).map((x) => (
          <div key={x.address} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
            <div className="min-w-0">
              <CopyAddress address={x.address} />
              <p className="text-[11px] text-muted-foreground">{x.attribution.vasp?.name ?? "Unattributed endpoint"}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="tabular text-xs font-medium">{usd(x.inboundValue)}</span>
              <AttributionBadge category={x.attribution.category} />
            </div>
          </div>
        ))}
      </div>
    </IntelResultCard>
  )
}

export function FundDnaPanel({ inv }: { inv: InvestigationResult }) {
  const d = inv.fundDna
  const total = d.result.tracedUsd + d.result.dispersedUsd || 1
  return (
    <IntelResultCard title="Fund DNA" icon={Dna} result={d}>
      <div className="rounded-md border border-border bg-background/40 p-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Traced to endpoints {usd(d.result.tracedUsd)}</span>
          <span>Dispersed {usd(d.result.dispersedUsd)}</span>
        </div>
        <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-risk-low" style={{ width: `${(d.result.tracedUsd / total) * 100}%` }} />
          <div className="h-full bg-risk-high" style={{ width: `${(d.result.dispersedUsd / total) * 100}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{d.result.note}</p>
      </div>
      <div className="space-y-1.5">
        {d.result.traces.slice(0, 6).map((t, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono text-muted-foreground">
                → {t.endKind} {shortAddr(t.endsAt, 6, 4)}
              </span>
              <span className="tabular font-medium">
                {pct(t.proportion)} · {usd(t.usdValue)}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, t.proportion * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </IntelResultCard>
  )
}

export function GhostWalletPanel({ inv }: { inv: InvestigationResult }) {
  const g = inv.ghostWallet
  return (
    <IntelResultCard title="Ghost Wallet Detector" icon={Ghost} result={g}>
      <p className="text-xs text-muted-foreground">
        {g.result.suspectedBurnerCount} suspected burner / pass-through wallet(s).
      </p>
      <div className="space-y-2">
        {g.result.burners.slice(0, 5).map((b) => (
          <div key={b.address} className="rounded-md border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <CopyAddress address={b.address} />
              <span className="tabular text-xs font-semibold text-risk-critical">{pct(b.score)}</span>
            </div>
            <div className="mt-1.5">
              <Meter label="Burner likelihood" value={Math.round(b.score * 100)} color="var(--risk-critical)" />
            </div>
            <ul className="mt-2 space-y-0.5">
              {b.signals.slice(0, 2).map((s, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] text-muted-foreground">
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-risk-critical/70" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </IntelResultCard>
  )
}

export function LaunderingPanel({ inv }: { inv: InvestigationResult }) {
  const l = inv.laundering
  return (
    <IntelResultCard title="Laundering Radar" icon={Radar} result={l}>
      <Meter
        label="Laundering score"
        value={l.result.launderingScore}
        color={riskColorVar(riskBandOf(l.result.launderingScore))}
      />
      <div className="flex flex-wrap gap-1.5">
        {l.result.patterns.length ? (
          l.result.patterns.map((p, i) => (
            <Badge key={`${p.pattern}-${i}`} variant="outline" title={p.detail}>
              {humanize(p.pattern)} · {pct(p.confidence)}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No structured laundering pattern detected.</span>
        )}
      </div>
      <div className="space-y-1">
        {l.result.patterns.slice(0, 4).map((p, i) => (
          <p key={`${p.pattern}-${i}`} className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{humanize(p.pattern)}:</span> {p.detail}
          </p>
        ))}
      </div>
    </IntelResultCard>
  )
}

export function RecoverPanel({ inv }: { inv: InvestigationResult }) {
  const r = inv.recover
  return (
    <IntelResultCard title="Recover AI" icon={Coins} result={r}>
      <div className="flex items-center gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-risk-low/15 text-lg font-bold tabular text-risk-low">
          {Math.round(r.result.recoveryProbability * 100)}%
        </div>
        <p className="text-xs text-muted-foreground">Estimated recovery probability — a prioritization estimate, not a guarantee.</p>
      </div>
      <StatPair
        items={[
          { label: "Traceable", value: usd(r.result.traceableUsd) },
          { label: "At exchanges", value: usd(r.result.atExchangeUsd), accent: "var(--risk-low)" },
          { label: "Dispersed", value: usd(r.result.dispersedUsd), accent: "var(--risk-high)" },
        ]}
      />
      <div className="space-y-1">
        {r.result.factors.map((f) => (
          <div key={f.label} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">{f.label}</span>
            <span className={`tabular font-medium ${f.impact < 0 ? "text-risk-high" : "text-risk-low"}`}>
              {f.impact >= 0 ? "+" : ""}
              {Math.round(f.impact * 100)}%
            </span>
          </div>
        ))}
      </div>
    </IntelResultCard>
  )
}

export function CrossChainPanel({ inv }: { inv: InvestigationResult }) {
  const c = inv.crossChain
  return (
    <IntelResultCard title="CrossChain Radar" icon={ArrowLeftRight} result={c}>
      {c.result.bridged ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {c.result.chainsInvolved.map((ch) => (
              <Badge key={ch} variant="outline">
                {CHAIN_LABEL[ch]}
              </Badge>
            ))}
            <Badge variant="muted">{usd(c.result.relinkedValue)} bridged</Badge>
          </div>
          <div className="space-y-1.5">
            {c.result.hops.map((h, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                <span className="flex items-center gap-1.5">
                  {CHAIN_LABEL[h.fromChain]} <ArrowLeftRight className="size-3 text-muted-foreground" /> {CHAIN_LABEL[h.toChain]}
                </span>
                <span className="tabular font-medium">{usd(h.usdValue)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No cross-chain bridge activity detected in this trace.</p>
      )}
    </IntelResultCard>
  )
}

export function NetworkPanel({ inv }: { inv: InvestigationResult }) {
  const n = inv.network
  return (
    <IntelResultCard title="Fraud Network Discovery" icon={Network} result={n}>
      <StatPair
        items={[
          { label: "Connected victims", value: String(n.result.connectedVictims) },
          { label: "Shared hubs", value: String(n.result.sharedInfrastructure.length) },
          { label: "Clusters", value: String(n.result.clusters.length) },
        ]}
      />
      {n.result.clusters.map((cl) => (
        <div key={cl.id} className="rounded-md border border-border bg-background/40 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-foreground">{cl.id}</span>
            <Badge variant="muted">{cl.size} members</Badge>
          </div>
          <div className="mt-2">
            <Meter label="Cohesion" value={Math.round(cl.cohesion * 100)} />
          </div>
        </div>
      ))}
    </IntelResultCard>
  )
}

export function EntityPanel({ inv }: { inv: InvestigationResult }) {
  const e = inv.entity
  return (
    <IntelResultCard title="Entity Resolution" icon={Users2} result={e}>
      <div className="rounded-md border border-risk-medium/30 bg-risk-medium/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {e.result.note}
      </div>
      {e.result.entities.length ? (
        <div className="space-y-1.5">
          {e.result.entities.map((ent) => (
            <div key={ent.entityId} className="rounded-md border border-border bg-background/40 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs">{ent.entityId}</span>
                <Badge variant="muted">Identity claim: {ent.identityClaim}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {ent.addresses.length} addresses linked · {pct(ent.confidence)} behavioral confidence
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Insufficient behavioral overlap to cluster addresses.</p>
      )}
    </IntelResultCard>
  )
}

export function FraudprintPanel({ inv }: { inv: InvestigationResult }) {
  const f = inv.fraudprint
  return (
    <IntelResultCard title="Fraudprint AI" icon={Fingerprint} result={f}>
      <div className="flex items-center gap-2">
        <Badge variant="default">{humanize(f.result.typology)}</Badge>
        <span className="text-[11px] text-muted-foreground">working typology</span>
      </div>
      <div className="space-y-1">
        {f.result.scores.map((s) => (
          <div key={s.typology} className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{humanize(s.typology)}</span>
              <span className="tabular">{s.score.toFixed(2)}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, s.score * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </IntelResultCard>
  )
}

export function ConfidencePanel({ inv }: { inv: InvestigationResult }) {
  const c = inv.confidence
  return (
    <IntelResultCard title="Trace Confidence Engine" icon={ShieldAlert} result={c}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Meter label="Overall" value={Math.round(c.result.overall * 100)} />
        <Meter label="Data quality" value={Math.round(c.result.dataQuality * 100)} />
        <Meter label="Graph completeness" value={Math.round(c.result.graphCompleteness * 100)} />
        <Meter label="Attribution strength" value={Math.round(c.result.attributionStrength * 100)} />
      </div>
    </IntelResultCard>
  )
}

export function ActionPackPanel({ inv }: { inv: InvestigationResult }) {
  const a = inv.actionPack
  return (
    <IntelResultCard title="ActionPack AI" icon={ClipboardList} result={a}>
      <div className="rounded-md border border-risk-high/30 bg-risk-high/5 px-3 py-2 text-[11px] font-medium leading-relaxed text-risk-high">
        {a.result.disclaimer}
      </div>
      <div className="space-y-1.5">
        {a.result.actions.map((act) => (
          <div key={act.order} className="flex items-start gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular">
              {act.order}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <p className="text-xs font-medium text-foreground">{act.action}</p>
                <Badge variant="outline">{act.urgency}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{act.target}</p>
            </div>
          </div>
        ))}
      </div>
    </IntelResultCard>
  )
}

// INVESTIGATION INTELLIGENCE — an explainable, transaction-level risk read
// that summarizes the wallet's behavior into a score, detected patterns, the
// factors behind the score, and concrete next steps.
export function InvestigationIntelligencePanel({ inv }: { inv: InvestigationResult }) {
  const intel = inv.intelligence
  const r = intel.result
  const color = riskColorVar(r.riskLevel)
  return (
    <IntelResultCard title="Investigation Intelligence" icon={BrainCircuit} result={intel}>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex size-16 shrink-0 items-center justify-center rounded-full text-xl font-bold tabular"
          style={{ color, background: `color-mix(in oklch, ${color} 15%, transparent)` }}
        >
          {r.overallRiskScore}
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge style={{ color, borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}>
              {r.riskLevel} RISK
            </Badge>
            <Badge variant="muted">Confidence: {r.confidence}</Badge>
            <Badge variant="outline">{r.analyzedTransactionCount} tx analyzed</Badge>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground text-pretty">{r.summary}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Detected patterns</p>
        {r.detectedPatterns.length ? (
          <div className="space-y-1.5">
            {r.detectedPatterns.map((p) => (
              <div key={p.type} className="rounded-md border border-border bg-background/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{p.title}</span>
                  <Badge variant="outline">{pct(p.confidence)}</Badge>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground text-pretty">{p.description}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {p.supportingTransactions.length} supporting transaction(s)
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No high-risk transaction patterns detected.</p>
        )}
      </div>

      {r.riskFactors.length ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Why this wallet is risky
          </p>
          {r.riskFactors.map((f) => (
            <div key={f.label} className="flex items-start justify-between gap-3 text-xs">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{f.label}</span>
                <p className="text-[11px] leading-relaxed text-muted-foreground text-pretty">{f.explanation}</p>
              </div>
              <span className="tabular font-semibold" style={{ color }}>
                +{f.points}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {r.recommendations.length ? (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recommended next steps
          </p>
          <ul className="ml-1 space-y-1">
            {r.recommendations.map((rec, i) => (
              <li key={i} className="flex gap-2 text-xs text-foreground/80">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/70" />
                <span className="leading-relaxed">{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </IntelResultCard>
  )
}

// Full intelligence board used on the case workspace.
export function IntelligenceBoard({ inv }: { inv: InvestigationResult }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {inv.intelligence ? (
        <div className="lg:col-span-2">
          <InvestigationIntelligencePanel inv={inv} />
        </div>
      ) : null}
      <RiskPanel inv={inv} />
      <FraudprintPanel inv={inv} />
      <ExitPointPanel inv={inv} />
      <FundDnaPanel inv={inv} />
      <GhostWalletPanel inv={inv} />
      <LaunderingPanel inv={inv} />
      <RecoverPanel inv={inv} />
      <CrossChainPanel inv={inv} />
      <NetworkPanel inv={inv} />
      <EntityPanel inv={inv} />
      <ConfidencePanel inv={inv} />
      <ActionPackPanel inv={inv} />
    </div>
  )
}
