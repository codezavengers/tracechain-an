"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldCheck, ShieldAlert, Link2 } from "lucide-react"
import { SectionHeading, StatTile, ProvenanceBadge } from "@/components/intel/shared"
import { CaseSelect } from "@/components/intel/case-select"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LoadingBlock, ErrorState, EmptyState, Spinner } from "@/components/ui/feedback"
import { useEvidence, apiPost, type EvidenceVerificationResult } from "@/lib/client/hooks"
import { relTime, humanize } from "@/lib/client/format"

export default function EvidencePage() {
  const [caseId, setCaseId] = React.useState("")
  const { data, error, isLoading } = useEvidence(caseId || undefined)
  const records = data?.records ?? []
  const integrity = data?.integrity

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeading
        title="Evidence Center"
        description="Tamper-evident chain of evidence. Each record is SHA-256 hashed and linked to the previous record; any modification breaks the chain."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <CaseSelect value={caseId} onChange={setCaseId} label="Filter by case (all cases if unset)" />
        {integrity ? (
          <Badge
            variant="outline"
            className="h-8 px-3"
            style={{
              color: integrity.valid ? "var(--risk-low)" : "var(--risk-critical)",
              borderColor: `color-mix(in oklch, ${integrity.valid ? "var(--risk-low)" : "var(--risk-critical)"} 40%, transparent)`,
            }}
          >
            {integrity.valid ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
            {integrity.valid ? "Chain integrity verified" : `Integrity broken at ${integrity.brokenAt ?? "unknown"}`}
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Evidence records" value={records.length} icon={ShieldCheck} accent="var(--primary)" />
        <StatTile label="Cases covered" value={new Set(records.map((r) => r.caseId)).size} />
        <StatTile
          label="Chain status"
          value={integrity ? (integrity.valid ? "Valid" : "Broken") : "—"}
          accent={integrity?.valid ? "var(--risk-low)" : "var(--risk-critical)"}
        />
      </div>

      {error ? <ErrorState message={error.message} /> : null}
      {isLoading ? (
        <LoadingBlock label="Loading evidence chain…" />
      ) : records.length ? (
        <div className="space-y-2">
          {records.map((r, i) => (
            <EvidenceCard key={r.id} record={r} index={i} />
          ))}
        </div>
      ) : (
        <EmptyState icon={ShieldCheck} title="No evidence records" description="Evidence accrues as cases are created and investigated." />
      )}
    </div>
  )
}

function EvidenceCard({
  record,
  index,
}: {
  record: {
    id: string
    caseId: string
    type: string
    title: string
    summary: string
    contentHash: string
    prevHash: string
    createdBy: string
    createdAt: string
    provenance: React.ComponentProps<typeof ProvenanceBadge>["provenance"]
    filename?: string
  }
  index: number
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
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular">
              {index + 1}
            </span>
            <span className="text-sm font-medium text-foreground">{record.title}</span>
            <Badge variant="muted">{humanize(record.type)}</Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <ProvenanceBadge provenance={record.provenance} />
            <Link href={`/cases/${record.caseId}`} className="text-[11px] text-primary hover:underline">
              {record.caseId}
            </Link>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground text-pretty">{record.summary}</p>
        {record.filename ? <p className="mt-1 text-[10px] text-muted-foreground">File: {record.filename}</p> : null}
        <div className="mt-2 grid gap-1 rounded-md border border-border bg-background/40 p-2 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3 text-risk-low" /> hash {record.contentHash}
          </span>
          <span className="flex items-center gap-1.5">
            <Link2 className="size-3" /> prev {record.prevHash}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">
            {record.createdBy} · {relTime(record.createdAt)}
          </p>
          <div className="flex items-center gap-2">
            {result ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: tone }}>
                {result.status === "VERIFIED"
                  ? "Verified"
                  : result.status === "INTEGRITY_MISMATCH"
                    ? "Integrity mismatch"
                    : "Cannot verify"}
              </span>
            ) : null}
            <Button size="sm" variant="outline" onClick={verify} disabled={state === "verifying"}>
              {state === "verifying" ? (
                <Spinner />
              ) : result?.status === "INTEGRITY_MISMATCH" ? (
                <ShieldAlert className="size-3.5" style={{ color: "var(--risk-critical)" }} />
              ) : (
                <ShieldCheck className="size-3.5" style={{ color: result?.status === "VERIFIED" ? "var(--risk-low)" : undefined }} />
              )}
              Verify integrity
            </Button>
          </div>
        </div>
        {result ? (
          <p className="mt-1.5 rounded border border-border/60 bg-background/60 p-2 text-[10px] text-muted-foreground text-pretty">
            {result.message}
            {result.recomputedHash ? (
              <span className="mt-1 block font-mono text-[9px]">recomputed {result.recomputedHash}</span>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
