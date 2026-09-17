"use client"

import * as React from "react"
import { FilePlus2, Search, FolderKanban, Database, HardDrive } from "lucide-react"
import { useCases, usePersistence } from "@/lib/client/hooks"
import { SectionHeading } from "@/components/intel/shared"
import { Badge } from "@/components/ui/badge"
import { LinkButton } from "@/components/ui/link-button"
import { Input, Select } from "@/components/ui/field"
import { LoadingBlock, ErrorState, EmptyState } from "@/components/ui/feedback"
import { CaseRow } from "@/components/case-card"
import { STATUS_LABEL, CHAIN_LABEL } from "@/lib/client/format"
import type { CaseStatus, Chain, RiskBand } from "@/lib/types"

export default function CasesPage() {
  const { data, error, isLoading } = useCases()
  const { data: persistence } = usePersistence()
  const [q, setQ] = React.useState("")
  const [status, setStatus] = React.useState<CaseStatus | "ALL">("ALL")
  const [risk, setRisk] = React.useState<RiskBand | "ALL">("ALL")
  const [chain, setChain] = React.useState<Chain | "ALL">("ALL")
  const [sort, setSort] = React.useState<"priority" | "risk" | "loss" | "recent">("priority")

  const cases = data?.cases ?? []
  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = cases.filter((c) => {
      if (status !== "ALL" && c.status !== status) return false
      if (risk !== "ALL" && c.riskBand !== risk) return false
      if (chain !== "ALL" && c.chain !== chain) return false
      if (
        term &&
        !`${c.id} ${c.title} ${c.reportedWallet} ${c.complaintRef} ${c.typology}`.toLowerCase().includes(term)
      )
        return false
      return true
    })
    const sorters: Record<typeof sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      priority: (a, b) => b.priorityScore - a.priorityScore,
      risk: (a, b) => b.riskScore - a.riskScore,
      loss: (a, b) => b.reportedLossUsd - a.reportedLossUsd,
      recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    }
    return [...list].sort(sorters[sort])
  }, [cases, q, status, risk, chain, sort])

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <SectionHeading
        title="Cases"
        description="All cryptocurrency fraud investigations, triaged by CASE PRIORITY AI."
        right={
          <div className="flex items-center gap-2">
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
            <LinkButton href="/cases/new">
              <FilePlus2 className="size-4" /> New Investigation
            </LinkButton>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search cases, wallets, complaint refs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | "ALL")} className="w-auto">
          <option value="ALL">All statuses</option>
          {(Object.keys(STATUS_LABEL) as CaseStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select value={risk} onChange={(e) => setRisk(e.target.value as RiskBand | "ALL")} className="w-auto">
          <option value="ALL">All risk</option>
          {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as RiskBand[]).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Select value={chain} onChange={(e) => setChain(e.target.value as Chain | "ALL")} className="w-auto">
          <option value="ALL">All chains</option>
          {(Object.keys(CHAIN_LABEL) as Chain[]).map((c) => (
            <option key={c} value={c}>
              {CHAIN_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto">
          <option value="priority">Sort: Priority</option>
          <option value="risk">Sort: Risk</option>
          <option value="loss">Sort: Reported loss</option>
          <option value="recent">Sort: Recently updated</option>
        </Select>
      </div>

      {error ? <ErrorState message={error.message} /> : null}
      {isLoading ? (
        <LoadingBlock label="Loading cases…" />
      ) : filtered.length ? (
        <>
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {cases.length} cases
          </p>
          <div className="space-y-2">
            {filtered.map((c) => (
              <CaseRow key={c.id} c={c} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          icon={FolderKanban}
          title="No matching cases"
          description="Adjust filters or create a new investigation."
        />
      )}
    </div>
  )
}
