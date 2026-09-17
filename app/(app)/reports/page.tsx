"use client"

import * as React from "react"
import { FileText, Download, ShieldCheck, ShieldAlert } from "lucide-react"
import { SectionHeading, ProvenanceBadge } from "@/components/intel/shared"
import { CaseSelect } from "@/components/intel/case-select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ErrorState, EmptyState, Spinner } from "@/components/ui/feedback"
import { useCases } from "@/lib/client/hooks"
import { usd, dateTime, humanize } from "@/lib/client/format"

// The report payload matches app/api/cases/[id]/report/route.ts
interface ReportPayload {
  generatedAt: string
  generatedBy: string
  disclaimer: string
  caseInformation: Record<string, string>
  reportedWallet: { address: string; chain: string }
  investigationSummary: string
  fraudTypology: { typology: string; indicators: string[] }
  fundFlow: { graphNodes: number; graphEdges: number; journey: { title: string; usdValue: number }[] }
  suspiciousWallets: string[]
  burnerWallets: { address: string; score: number }[]
  launderingAnalysis: { launderingScore: number; patterns: { pattern: string }[] }
  crossChainActivity: { bridged: boolean; chainsInvolved: string[]; relinkedValue: number }
  vaspAttribution: { address: string; category: string; vasp: string | null; inboundUsd: number }[]
  recoveryAnalysis: { recoveryProbability: number; traceableUsd: number; atExchangeUsd: number; dispersedUsd: number }
  risk: { score: number; band: string }
  priorityScore: number
  recommendations: { summary: string; actions: { order: number; action: string; urgency: string }[] }
  evidence: { records: unknown[]; chainIntegrity: { valid: boolean }; latestHash: string | null }
}

export default function ReportsPage() {
  const { data: casesData } = useCases()
  const [caseId, setCaseId] = React.useState("")
  const effectiveId = caseId || casesData?.cases[0]?.id || ""
  const [report, setReport] = React.useState<ReportPayload | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setReport(null)
    setError(null)
  }, [effectiveId])

  async function generate() {
    if (!effectiveId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/cases/${effectiveId}/report`, { credentials: "include" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Report generation failed.")
      setReport(json.report as ReportPayload)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report generation failed.")
    } finally {
      setLoading(false)
    }
  }

  function download() {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${effectiveId}-report.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeading
        title="Reports"
        description="Generate a comprehensive, court-oriented investigation report assembling every intelligence module plus the evidence hash chain."
        right={
          report ? (
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="size-3.5" /> Download JSON
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <CaseSelect value={effectiveId} onChange={setCaseId} />
        <Button onClick={generate} disabled={loading || !effectiveId}>
          {loading ? <Spinner className="text-primary-foreground" /> : <FileText className="size-4" />} Generate report
        </Button>
      </div>

      {error ? <ErrorState message={error} /> : null}

      {!report && !loading && !error ? (
        <EmptyState
          icon={FileText}
          title="No report generated"
          description="Select a case and generate its report. The case must have a completed investigation."
        />
      ) : null}

      {report ? (
        <div className="space-y-3">
          <div className="rounded-md border border-risk-medium/30 bg-risk-medium/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {report.disclaimer}
          </div>

          <Section title="Case information">
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(report.caseInformation).map(([k, v]) => (
                <Row key={k} label={humanize(k)} value={String(v)} />
              ))}
            </div>
          </Section>

          <Section title="Investigation summary">
            <p className="text-sm leading-relaxed text-foreground/85 text-pretty">{report.investigationSummary}</p>
          </Section>

          <div className="grid gap-3 sm:grid-cols-2">
            <Section title="Risk & priority">
              <Row label="Risk" value={`${report.risk.score}/100 (${report.risk.band})`} />
              <Row label="Priority" value={`${report.priorityScore}/100`} />
              <Row label="Typology" value={humanize(report.fraudTypology.typology)} />
            </Section>
            <Section title="Recovery analysis">
              <Row label="Recovery probability" value={`${Math.round(report.recoveryAnalysis.recoveryProbability * 100)}%`} />
              <Row label="Traceable" value={usd(report.recoveryAnalysis.traceableUsd)} />
              <Row label="At exchanges" value={usd(report.recoveryAnalysis.atExchangeUsd)} />
              <Row label="Dispersed" value={usd(report.recoveryAnalysis.dispersedUsd)} />
            </Section>
          </div>

          <Section title="Fund flow & journey">
            <Row label="Graph size" value={`${report.fundFlow.graphNodes} nodes · ${report.fundFlow.graphEdges} edges`} />
            <ol className="mt-2 space-y-1">
              {report.fundFlow.journey.map((j, i) => (
                <li key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {i + 1}. {j.title}
                  </span>
                  <span className="tabular font-medium">{usd(j.usdValue)}</span>
                </li>
              ))}
            </ol>
          </Section>

          <div className="grid gap-3 sm:grid-cols-2">
            <Section title="Laundering analysis">
              <Row label="Laundering score" value={`${report.launderingAnalysis.launderingScore}/100`} />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {report.launderingAnalysis.patterns.map((p, i) => (
                  <Badge key={`${p.pattern}-${i}`} variant="outline">
                    {humanize(p.pattern)}
                  </Badge>
                ))}
              </div>
            </Section>
            <Section title="Cross-chain activity">
              {report.crossChainActivity.bridged ? (
                <>
                  <Row label="Chains" value={report.crossChainActivity.chainsInvolved.map(humanize).join(", ")} />
                  <Row label="Bridged value" value={usd(report.crossChainActivity.relinkedValue)} />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No cross-chain movement detected.</p>
              )}
            </Section>
          </div>

          <Section title="VASP attribution (PROBABLE unless verified)">
            {report.vaspAttribution.length ? (
              <div className="space-y-1.5">
                {report.vaspAttribution.map((v) => (
                  <div key={v.address} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                    <span className="min-w-0 truncate font-mono text-muted-foreground">{v.address}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span>{v.vasp ?? "Unattributed"}</span>
                      <Badge variant="muted">{v.category}</Badge>
                      <span className="tabular font-medium">{usd(v.inboundUsd)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No exit endpoints attributed.</p>
            )}
          </Section>

          <Section title="Suspicious & burner wallets">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Suspicious ({report.suspiciousWallets.length})
                </p>
                <div className="space-y-1">
                  {report.suspiciousWallets.slice(0, 6).map((w) => (
                    <p key={w} className="truncate font-mono text-[11px] text-muted-foreground">
                      {w}
                    </p>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Burners ({report.burnerWallets.length})
                </p>
                <div className="space-y-1">
                  {report.burnerWallets.slice(0, 6).map((b) => (
                    <p key={b.address} className="flex justify-between font-mono text-[11px] text-muted-foreground">
                      <span className="truncate">{b.address}</span>
                      <span className="text-risk-critical">{Math.round(b.score * 100)}%</span>
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Recommendations (DRAFT)">
            <p className="mb-2 text-xs text-muted-foreground">{report.recommendations.summary}</p>
            <ol className="space-y-1">
              {report.recommendations.actions.map((a) => (
                <li key={a.order} className="flex items-center justify-between text-xs">
                  <span>
                    {a.order}. {a.action}
                  </span>
                  <Badge variant="outline">{a.urgency}</Badge>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Evidence integrity">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                style={{
                  color: report.evidence.chainIntegrity.valid ? "var(--risk-low)" : "var(--risk-critical)",
                  borderColor: `color-mix(in oklch, ${report.evidence.chainIntegrity.valid ? "var(--risk-low)" : "var(--risk-critical)"} 40%, transparent)`,
                }}
              >
                {report.evidence.chainIntegrity.valid ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
                {report.evidence.chainIntegrity.valid ? "Verified" : "Broken"}
              </Badge>
              <span className="text-[11px] text-muted-foreground">{report.evidence.records.length} records</span>
              <ProvenanceBadge provenance="HEURISTIC_ANALYSIS" />
            </div>
            {report.evidence.latestHash ? (
              <p className="mt-1.5 break-all font-mono text-[10px] text-muted-foreground">latest: {report.evidence.latestHash}</p>
            ) : null}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Generated {dateTime(report.generatedAt)} by {report.generatedBy}
            </p>
          </Section>
        </div>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  )
}
