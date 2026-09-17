"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  PlayCircle,
  FileText,
  Share2,
  Route,
  Brain,
  ShieldCheck,
  MessageSquare,
  LayoutList,
  Coins,
  Users,
  Wallet,
  Send,
  Save,
  Database,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  GitBranch,
  Clock,
  ClipboardList,
  Plus,
  ShieldAlert,
} from "lucide-react"
import { SectionHeading, StatusBadge, RiskBadge, ProvenanceBadge, CopyAddress, StatTile } from "@/components/intel/shared"
import { PriorityRing } from "@/components/case-card"
import { GraphView } from "@/components/intel/graph-view"
import { JourneyTimeline } from "@/components/intel/journey-timeline"
import { IntelligenceBoard } from "@/components/intel/intelligence-panels"
import { FundFlowGraph } from "@/components/intel/fund-flow-graph"
import { Tabs } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, Textarea, Label, Input } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { LoadingBlock, ErrorState, EmptyState, Spinner } from "@/components/ui/feedback"
import {
  useCaseDetail,
  useEvidence,
  apiPost,
  useSession,
  usePersistence,
  useInvestigationHistory,
  useCaseSummary,
  type EvidenceVerificationResult,
} from "@/lib/client/hooks"
import { PERMISSIONS } from "@/lib/auth"
import { CHAIN_LABEL, usd, usdFull, dateTime, relTime, humanize, STATUS_LABEL, pct } from "@/lib/client/format"
import type { CaseStatus } from "@/lib/types"

const STATUSES: CaseStatus[] = [
  "NEW",
  "ANALYZING",
  "TRACING",
  "VASP_IDENTIFIED",
  "ACTION_REQUIRED",
  "FREEZE_REVIEW",
  "MONITORING",
  "CLOSED",
]

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { user } = useSession()
  const { data, error, isLoading, mutate } = useCaseDetail(id)
  const { data: persistence } = usePersistence()
  const [tab, setTab] = React.useState("overview")
  const [busy, setBusy] = React.useState<null | "investigate" | "status" | "report">(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle")
  const [savedId, setSavedId] = React.useState<string | null>(null)
  const [traceHops, setTraceHops] = React.useState(2)

  const canRun = user ? PERMISSIONS.runInvestigation(user.role) : false
  const canEdit = user ? PERMISSIONS.editCase(user.role) : false
  const canExport = user ? PERMISSIONS.exportReport(user.role) : false

  const c = data?.case
  const inv = data?.investigation ?? null
  const graph = data?.graph ?? null

  async function runInvestigation(options?: { traceMaxHops?: number; focusTab?: string }) {
    if (!id) return
    setBusy("investigate")
    setMsg(null)
    try {
      await apiPost(`/api/cases/${id}/investigate`, { depth: 5, traceMaxHops: options?.traceMaxHops ?? traceHops })
      await mutate()
      setMsg("Investigation complete — intelligence refreshed.")
      setTab(options?.focusTab ?? "intelligence")
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Investigation failed.")
    } finally {
      setBusy(null)
    }
  }

  async function saveInvestigation() {
    if (!id) return
    setSaveState("saving")
    setMsg(null)
    try {
      const res = await apiPost<{ id: string; savedAt: string; persistenceLabel: string }>(
        `/api/cases/${id}/save`,
      )
      setSavedId(res.id)
      setSaveState("saved")
      setMsg(`Investigation ${res.id} saved to ${res.persistenceLabel}.`)
    } catch (e) {
      // Never surface a "saved" state when persistence actually failed.
      setSaveState("error")
      setMsg(e instanceof Error ? e.message : "Save failed.")
    }
  }

  async function changeStatus(status: CaseStatus) {
    if (!id) return
    setBusy("status")
    try {
      await apiPost(`/api/cases/${id}`, { status }, "PATCH")
      await mutate()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Status update failed.")
    } finally {
      setBusy(null)
    }
  }

  async function generateReport() {
    if (!id) return
    setBusy("report")
    setMsg(null)
    try {
      const res = await fetch(`/api/cases/${id}/report`, { credentials: "include" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Report generation failed.")
      const blob = new Blob([JSON.stringify(json.report, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${id}-report.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg("Report generated and downloaded.")
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Report generation failed.")
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <LoadingBlock label="Loading case workspace…" />
  if (error) return <ErrorState message={error.message} />
  if (!c) return <ErrorState message="Case not found." />

  const tabs = [
    { value: "overview", label: "Overview", icon: LayoutList },
    { value: "graph", label: "Transaction Graph", icon: Share2 },
    { value: "fundflow", label: "Fund Flow", icon: GitBranch },
    { value: "journey", label: "Fraud Journey", icon: Route },
    { value: "intelligence", label: "Intelligence", icon: Brain },
    { value: "evidence", label: "Evidence & Activity", icon: ShieldCheck },
    { value: "timeline", label: "Timeline", icon: Clock },
    { value: "notes", label: "Notes", icon: MessageSquare },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All cases
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <PriorityRing score={c.priorityScore} size={52} />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-foreground text-balance">{c.title}</h1>
              <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={c.status} />
              <RiskBadge score={c.riskScore} band={c.riskBand} />
              <Badge variant="outline">{CHAIN_LABEL[c.chain]}</Badge>
              <Badge variant="muted">{humanize(c.typology)}</Badge>
              <ProvenanceBadge provenance={c.provenance} />
            </div>
            <p className="text-xs text-muted-foreground">
              Complaint {c.complaintRef} · assigned to {c.investigator} · updated {relTime(c.updatedAt)}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {persistence ? (
                <Badge
                  variant="outline"
                  title={
                    persistence.persistent
                      ? "Saved investigations survive refresh, navigation and server restart."
                      : "In-memory only — data does NOT survive a server restart."
                  }
                  style={{
                    color: persistence.persistent ? "var(--risk-low)" : "var(--muted-foreground)",
                    borderColor: `color-mix(in oklch, ${persistence.persistent ? "var(--risk-low)" : "var(--muted-foreground)"} 40%, transparent)`,
                  }}
                >
                  {persistence.persistent ? <Database className="size-3" /> : <HardDrive className="size-3" />}
                  {persistence.label}
                </Badge>
              ) : null}
              <span className="font-mono text-[11px] text-muted-foreground">
                Investigation ID: {savedId ?? c.id}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <div className="space-y-1">
              <Label htmlFor="status" className="sr-only">
                Status
              </Label>
              <Select
                id="status"
                value={c.status}
                onChange={(e) => changeStatus(e.target.value as CaseStatus)}
                disabled={busy === "status"}
                className="h-8 w-44 text-xs"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {canRun ? (
            <Button onClick={() => runInvestigation()} disabled={busy === "investigate"}>
              {busy === "investigate" ? <Spinner className="text-primary-foreground" /> : <PlayCircle className="size-4" />}
              {inv ? "Re-run investigation" : "Run investigation"}
            </Button>
          ) : null}
          {canRun ? (
            <Button variant="outline" onClick={saveInvestigation} disabled={saveState === "saving"}>
              {saveState === "saving" ? (
                <Spinner />
              ) : saveState === "saved" ? (
                <CheckCircle2 className="size-4" style={{ color: "var(--risk-low)" }} />
              ) : saveState === "error" ? (
                <AlertCircle className="size-4" style={{ color: "var(--risk-critical)" }} />
              ) : (
                <Save className="size-4" />
              )}
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved"
                  : saveState === "error"
                    ? "Save failed"
                    : "Save investigation"}
            </Button>
          ) : null}
          {canExport ? (
            <Button variant="outline" onClick={generateReport} disabled={busy === "report" || !inv}>
              {busy === "report" ? <Spinner /> : <FileText className="size-4" />} Report
            </Button>
          ) : null}
        </div>
      </div>

      {msg ? <div className="rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">{msg}</div> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Reported loss" value={usd(c.reportedLossUsd)} icon={Coins} accent="var(--risk-high)" />
        <StatTile label="Traceable" value={usd(c.traceableUsd)} icon={Wallet} accent="var(--risk-low)" />
        <StatTile label="Recovery est." value={pct(c.recoveryProbability)} accent="var(--primary)" />
        <StatTile label="Connected victims" value={c.connectedVictims} icon={Users} accent="var(--chart-2)" />
      </div>

      <Tabs items={tabs} value={tab} onValueChange={setTab} />

      {tab === "overview" ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Investigation summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {inv ? (
                <p className="text-sm leading-relaxed text-foreground/85 text-pretty">{inv.summary}</p>
              ) : (
                <EmptyState
                  icon={Brain}
                  title="No investigation yet"
                  description="Run the multi-engine investigation to populate fund tracing, exit-point attribution and recovery intelligence."
                />
              )}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Complaint</p>
                <p className="rounded-md border border-border bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground text-pretty">
                  {c.complaintText || "No complaint narrative recorded."}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reported wallet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <CopyAddress address={c.reportedWallet} full />
              <MetaRow label="Chain" value={CHAIN_LABEL[c.chain]} />
              <MetaRow label="Reported loss" value={usdFull(c.reportedLossUsd)} />
              <MetaRow label="Opened" value={dateTime(c.createdAt)} />
              <MetaRow label="Extracted wallets" value={String(c.extractedWallets.length)} />
              {c.extractedWallets.length > 1 ? (
                <div className="space-y-1 pt-1">
                  {c.extractedWallets.map((w) => (
                    <CopyAddress key={w} address={w} className="block" />
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
          <div className="lg:col-span-3">
            <CaseSummaryCard caseId={c.id} />
          </div>
        </div>
      ) : null}

      {tab === "graph" ? (
        <Card>
          <CardHeader>
            <CardTitle>Transaction graph</CardTitle>
          </CardHeader>
          <CardContent>
            {graph ? (
              <GraphView graph={graph} />
            ) : (
              <EmptyState
                icon={Share2}
                title="No graph available"
                description="This manual case has no pre-built demo graph. Cross-provider graph reconstruction runs during investigation."
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "fundflow" ? (
        <Card>
          <CardHeader className="gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="size-4 text-muted-foreground" />
                Fund Flow
              </CardTitle>
              {canRun ? (
                <div className="flex items-center gap-2">
                  <Label htmlFor="tracehops" className="text-[11px] text-muted-foreground">
                    Hop depth
                  </Label>
                  <Select
                    id="tracehops"
                    className="h-8 w-28 text-xs"
                    value={String(traceHops)}
                    onChange={(e) => setTraceHops(Number(e.target.value))}
                    disabled={busy === "investigate"}
                  >
                    <option value="2">2 (default)</option>
                    <option value="3">3 (max)</option>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runInvestigation({ traceMaxHops: traceHops, focusTab: "fundflow" })}
                    disabled={busy === "investigate"}
                  >
                    {busy === "investigate" ? <Spinner /> : <PlayCircle className="size-3.5" />} Re-run trace
                  </Button>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Changing hop depth re-runs the full multi-engine investigation with the new depth — this refreshes
              every intelligence panel, not just the graph below.
            </p>
          </CardHeader>
          <CardContent>
            {inv?.fundTrace ? (
              <FundFlowGraph graph={inv.fundTrace} />
            ) : (
              <EmptyState
                icon={GitBranch}
                title="No fund flow trace yet"
                description="Run the multi-engine investigation to trace how funds moved from the reported wallet across observed counterparties."
                action={
                  canRun ? (
                    <Button onClick={() => runInvestigation({ focusTab: "fundflow" })} disabled={busy === "investigate"}>
                      <PlayCircle className="size-4" /> Run investigation
                    </Button>
                  ) : undefined
                }
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "journey" ? (
        <Card>
          <CardHeader>
            <CardTitle>Fraud journey timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <JourneyTimeline steps={inv?.journey ?? []} />
          </CardContent>
        </Card>
      ) : null}

      {tab === "intelligence" ? (
        inv ? (
          <IntelligenceBoard inv={inv} />
        ) : (
          <EmptyState
            icon={Brain}
            title="Run the investigation"
            description="The intelligence board populates once the multi-engine investigation has been executed."
            action={
              canRun ? (
                <Button onClick={() => runInvestigation()} disabled={busy === "investigate"}>
                  <PlayCircle className="size-4" /> Run investigation
                </Button>
              ) : undefined
            }
          />
        )
      ) : null}

      {tab === "evidence" ? <EvidenceAndActivity caseId={c.id} activity={c.activity} canAdd={canRun} /> : null}

      {tab === "timeline" ? <InvestigationTimeline caseId={c.id} /> : null}

      {tab === "notes" ? <NotesPanel caseId={c.id} notes={c.notes} canEdit={canEdit} onAdded={() => mutate()} /> : null}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

function EvidenceAndActivity({
  caseId,
  activity,
  canAdd,
}: {
  caseId: string
  activity: { id: string; actor: string; action: string; detail: string; createdAt: string }[]
  canAdd: boolean
}) {
  const { data, mutate } = useEvidence(caseId)
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Chain of evidence</CardTitle>
            {data ? (
              <Badge
                variant="outline"
                style={{
                  color: data.integrity.valid ? "var(--risk-low)" : "var(--risk-critical)",
                  borderColor: `color-mix(in oklch, ${data.integrity.valid ? "var(--risk-low)" : "var(--risk-critical)"} 40%, transparent)`,
                }}
              >
                {data.integrity.valid ? "Integrity verified" : "Integrity broken"}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {canAdd ? <AddEvidenceForm caseId={caseId} onAdded={() => mutate()} /> : null}
          {!data ? (
            <Spinner />
          ) : data.records.length ? (
            data.records.map((r) => <EvidenceRow key={r.id} record={r} />)
          ) : (
            <p className="text-xs text-muted-foreground">No evidence recorded.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Activity history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {activity
            .slice()
            .reverse()
            .map((a) => (
              <div key={a.id} className="flex items-start gap-2 border-b border-border/50 pb-2 last:border-0">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/70" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{humanize(a.action)}</p>
                  <p className="text-[11px] text-muted-foreground text-pretty">{a.detail}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {a.actor} · {relTime(a.createdAt)}
                  </p>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  )
}

function EvidenceRow({
  record,
}: {
  record: {
    id: string
    title: string
    summary: string
    contentHash: string
    createdBy: string
    createdAt: string
    provenance: React.ComponentProps<typeof ProvenanceBadge>["provenance"]
    filename?: string
  }
}) {
  const [state, setState] = React.useState<"idle" | "verifying">("idle")
  const [result, setResult] = React.useState<EvidenceVerificationResult["verification"] | null>(null)

  async function verify() {
    setState("verifying")
    try {
      const res = await apiPost<EvidenceVerificationResult>("/api/evidence/verify", { evidenceId: record.id })
      setResult(res.verification)
    } catch (e) {
      setResult({
        status: "CONTENT_UNAVAILABLE",
        storedHash: record.contentHash,
        recomputedHash: null,
        message: e instanceof Error ? e.message : "Verification request failed.",
      })
    } finally {
      setState("idle")
    }
  }

  const tone =
    result?.status === "VERIFIED"
      ? "var(--risk-low)"
      : result?.status === "INTEGRITY_MISMATCH"
        ? "var(--risk-critical)"
        : "var(--muted-foreground)"

  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{record.title}</span>
        <ProvenanceBadge provenance={record.provenance} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground text-pretty">{record.summary}</p>
      {record.filename ? (
        <p className="mt-1 text-[10px] text-muted-foreground">File: {record.filename}</p>
      ) : null}
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="font-mono">{record.contentHash.slice(0, 24)}…</span>
        <span>
          {record.createdBy} · {relTime(record.createdAt)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={verify} disabled={state === "verifying"}>
          {state === "verifying" ? (
            <Spinner />
          ) : result?.status === "VERIFIED" ? (
            <ShieldCheck className="size-3.5" style={{ color: "var(--risk-low)" }} />
          ) : result?.status === "INTEGRITY_MISMATCH" ? (
            <ShieldAlert className="size-3.5" style={{ color: "var(--risk-critical)" }} />
          ) : (
            <ShieldCheck className="size-3.5" />
          )}
          Verify integrity
        </Button>
        {result ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: tone }}>
            {result.status === "VERIFIED"
              ? "Verified"
              : result.status === "INTEGRITY_MISMATCH"
                ? "Integrity mismatch"
                : "Cannot verify"}
          </span>
        ) : null}
      </div>
      {result ? (
        <p className="mt-1.5 rounded border border-border/60 bg-background/60 p-2 text-[10px] text-muted-foreground text-pretty">
          {result.message}
          {result.recomputedHash ? (
            <span className="mt-1 block font-mono text-[9px]">recomputed {result.recomputedHash.slice(0, 32)}…</span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

function AddEvidenceForm({ caseId, onAdded }: { caseId: string; onAdded: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [summary, setSummary] = React.useState("")
  const [filename, setFilename] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await apiPost("/api/evidence", {
        caseId,
        title: title.trim(),
        summary: summary.trim(),
        content: summary.trim() || title.trim(),
        filename: filename.trim() || undefined,
      })
      setTitle("")
      setSummary("")
      setFilename("")
      setOpen(false)
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add evidence.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="w-full">
        <Plus className="size-3.5" /> Add evidence
      </Button>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-border bg-background/40 p-3">
      <div className="space-y-1">
        <Label htmlFor="ev-title">Title</Label>
        <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Exchange KYC request acknowledgement" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ev-summary">Summary / content</Label>
        <Textarea id="ev-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What this evidence records. This text is hashed into the chain." className="min-h-16" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ev-file">Filename (optional)</Label>
        <Input id="ev-file" value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="report.pdf" />
      </div>
      {error ? <ErrorState message={error} /> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting || !title.trim()}>
          {submitting ? <Spinner className="text-primary-foreground" /> : <ShieldCheck className="size-3.5" />} Add to chain
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function InvestigationTimeline({ caseId }: { caseId: string }) {
  const { data, error, isLoading } = useInvestigationHistory(caseId)
  if (isLoading) return <LoadingBlock label="Loading investigation timeline…" />
  if (error) return <ErrorState message={error.message} />
  const events = data?.events ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" /> Investigation timeline
          </CardTitle>
          <Badge variant="muted">{events.length} event(s)</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Append-only chain of custody: case creation, investigation runs, evidence added and verified, saves and
          report generation — each with actor and timestamp.
        </p>
      </CardHeader>
      <CardContent>
        {events.length ? (
          <ol className="relative space-y-4 border-l border-border pl-4">
            {events.map((ev) => (
              <li key={ev.id} className="relative">
                <span className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-background bg-primary" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">{humanize(ev.action)}</span>
                  <Badge variant="muted" className="text-[10px]">
                    {dateTime(ev.createdAt)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground text-pretty">{ev.detail}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{ev.actor ?? "System"}</p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="No timeline events yet"
            description="Timeline events accrue as the investigation is run, saved, evidence is added or verified, and reports are generated."
          />
        )}
      </CardContent>
    </Card>
  )
}

function CaseSummaryCard({ caseId }: { caseId: string }) {
  const { data, isLoading } = useCaseSummary(caseId)
  const summary = data?.summary
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-4 text-muted-foreground" /> Case summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {isLoading || !summary ? (
          <Spinner />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetaRow label="Investigation ID" value={summary.investigationId} />
              <MetaRow label="Status" value={humanize(summary.status)} />
              <MetaRow label="Risk" value={`${summary.riskScore}/100 (${summary.riskBand})`} />
              <MetaRow label="Evidence records" value={String(summary.evidenceCount)} />
              <MetaRow label="Complaint" value={summary.complaint.reference || "—"} />
              <MetaRow label="Chain" value={CHAIN_LABEL[summary.chain as keyof typeof CHAIN_LABEL] ?? summary.chain} />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Target wallet</p>
              <CopyAddress address={summary.targetWallet} full />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Detected patterns
              </p>
              {summary.patterns.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {summary.patterns.map((p) => (
                    <Badge key={p} variant="muted">
                      {p}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No high-risk patterns detected in the analyzed activity.</p>
              )}
            </div>
            {summary.findings.length ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Findings</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {summary.findings.slice(0, 5).map((f, i) => (
                    <li key={i} className="text-pretty">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Trace summary
              </p>
              <p className="text-muted-foreground text-pretty">{summary.traceSummary}</p>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                VASP attribution
              </p>
              {summary.vaspAttribution.length ? (
                <div className="space-y-1">
                  {summary.vaspAttribution.map((v) => (
                    <div key={v.address} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-muted-foreground">{v.address.slice(0, 14)}…</span>
                      <span className="text-foreground">
                        {v.vasp ?? "Unattributed"} · {v.category}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No probable exit endpoint identified in the current trace.</p>
              )}
            </div>
            {!summary.hasInvestigation ? (
              <p className="rounded border border-border/60 bg-background/60 p-2 text-[11px] text-muted-foreground">
                Run the investigation to populate patterns, findings, tracing and VASP attribution.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function NotesPanel({
  caseId,
  notes,
  canEdit,
  onAdded,
}: {
  caseId: string
  notes: { id: string; author: string; createdAt: string; body: string }[]
  canEdit: boolean
  onAdded: () => void
}) {
  const [body, setBody] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await apiPost(`/api/cases/${caseId}/notes`, { body })
      setBody("")
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add note.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Case notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {notes.length ? (
            notes
              .slice()
              .reverse()
              .map((n) => (
                <div key={n.id} className="rounded-md border border-border bg-background/40 p-3">
                  <p className="text-xs leading-relaxed text-foreground/85 text-pretty">{n.body}</p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {n.author} · {relTime(n.createdAt)}
                  </p>
                </div>
              ))
          ) : (
            <p className="text-xs text-muted-foreground">No notes yet.</p>
          )}
        </CardContent>
      </Card>
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Add note</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="space-y-2">
              <Textarea
                placeholder="Record an observation, action taken, or coordination step…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="font-sans text-sm"
              />
              {error ? <ErrorState message={error} /> : null}
              <Button type="submit" disabled={submitting || !body.trim()}>
                {submitting ? <Spinner className="text-primary-foreground" /> : <Send className="size-4" />} Add note
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
