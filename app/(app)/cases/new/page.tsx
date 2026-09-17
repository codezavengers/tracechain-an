"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ScanSearch, Sparkles, Wand2, PlayCircle, Users, Coins, GitBranch } from "lucide-react"
import { SectionHeading, ProvenanceBadge } from "@/components/intel/shared"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input, Textarea, Select, Label } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { Spinner, ErrorState } from "@/components/ui/feedback"
import { fetcher, apiPost, useSession } from "@/lib/client/hooks"
import { PERMISSIONS } from "@/lib/auth"
import { CHAIN_LABEL, usd, titleFromTypology } from "@/lib/client/format"
import type { Chain, InvestigationCase, FraudTypology } from "@/lib/types"

interface ScenarioSummary {
  id: string
  typology: FraudTypology
  name: string
  chain: Chain
  crossChain?: Chain
  complaintRef: string
  complaintText: string
  reportedWallet: string
  reportedLossUsd: number
  connectedVictims: number
  nodeCount: number
  edgeCount: number
  narrative: string
}

export default function CreateInvestigationPage() {
  const router = useRouter()
  const { user } = useSession()
  const canCreate = user ? PERMISSIONS.createCase(user.role) : false
  const { data } = useSWR<{ scenarios: ScenarioSummary[] }>("/api/demo/scenarios", fetcher)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <SectionHeading
        title="Create Investigation"
        description="Open a case from a victim complaint or instantiate a realistic demo scenario for the SIH command-center walkthrough."
      />
      {!canCreate ? (
        <ErrorState message={`Your role (${user?.role}) is read-only for case creation. Sign in as INVESTIGATOR or ADMIN to create cases.`} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <ManualForm disabled={!canCreate} onCreated={(c) => router.push(`/cases/${c.id}`)} />
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <PlayCircle className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Demo Command Center</h2>
            <Badge variant="muted">6 scenarios</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Each scenario seeds a realistic multi-hop graph with burners, VASP endpoints and laundering patterns —
            pre-wired for a 3–5 minute presentation.
          </p>
          <div className="space-y-2">
            {(data?.scenarios ?? []).map((s) => (
              <ScenarioCard
                key={s.id}
                s={s}
                disabled={!canCreate}
                onCreated={(c) => router.push(`/cases/${c.id}`)}
              />
            ))}
            {!data ? <Spinner /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function ManualForm({ disabled, onCreated }: { disabled: boolean; onCreated: (c: InvestigationCase) => void }) {
  const [title, setTitle] = React.useState("")
  const [complaintRef, setComplaintRef] = React.useState("")
  const [complaintText, setComplaintText] = React.useState("")
  const [reportedWallet, setReportedWallet] = React.useState("")
  const [chain, setChain] = React.useState<Chain | "">("")
  const [loss, setLoss] = React.useState("")
  const [extracted, setExtracted] = React.useState<{ address: string; chain: Chain }[]>([])
  const [extracting, setExtracting] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function extract() {
    setExtracting(true)
    setError(null)
    try {
      const res = await apiPost<{ wallets: { address: string; chain: Chain }[] }>("/api/wallet/extract", {
        text: complaintText,
      })
      setExtracted(res.wallets)
      if (res.wallets[0] && !reportedWallet) {
        setReportedWallet(res.wallets[0].address)
        setChain(res.wallets[0].chain)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.")
    } finally {
      setExtracting(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiPost<{ case: InvestigationCase }>("/api/cases", {
        title: title || undefined,
        complaintRef: complaintRef || undefined,
        complaintText: complaintText || undefined,
        reportedWallet: reportedWallet || undefined,
        chain: chain || undefined,
        reportedLossUsd: loss ? Number(loss) : undefined,
      })
      onCreated(res.case)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create case.")
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanSearch className="size-4 text-primary" /> From victim complaint
        </CardTitle>
        <CardDescription>
          Paste complaint text to auto-extract wallet addresses, or enter a reported wallet directly. Addresses are
          validated before a case opens.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Case title</Label>
              <Input id="title" placeholder="e.g. Investment fraud — victim R.K." value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref">Complaint reference</Label>
              <Input id="ref" placeholder="NCRP/2026/…" value={complaintRef} onChange={(e) => setComplaintRef(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="complaint">Complaint text</Label>
              <Button type="button" size="xs" variant="outline" onClick={extract} disabled={!complaintText.trim() || extracting}>
                {extracting ? <Spinner /> : <Wand2 className="size-3" />} Extract wallets
              </Button>
            </div>
            <Textarea
              id="complaint"
              placeholder="Victim states funds were sent to bc1q… after being promised returns via a Telegram group…"
              value={complaintText}
              onChange={(e) => setComplaintText(e.target.value)}
            />
            {extracted.length ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {extracted.map((w) => (
                  <button
                    type="button"
                    key={w.address}
                    onClick={() => {
                      setReportedWallet(w.address)
                      setChain(w.chain)
                    }}
                    className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[11px] text-primary hover:bg-primary/20"
                  >
                    {w.address.slice(0, 16)}… · {CHAIN_LABEL[w.chain]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="wallet">Reported wallet</Label>
              <Input
                id="wallet"
                className="font-mono text-xs"
                placeholder="Wallet address"
                value={reportedWallet}
                onChange={(e) => setReportedWallet(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chain">Chain</Label>
              <Select id="chain" value={chain} onChange={(e) => setChain(e.target.value as Chain)}>
                <option value="">Auto-detect</option>
                {(Object.keys(CHAIN_LABEL) as Chain[]).map((c) => (
                  <option key={c} value={c}>
                    {CHAIN_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loss">Reported loss (USD)</Label>
            <Input id="loss" type="number" min="0" placeholder="0" value={loss} onChange={(e) => setLoss(e.target.value)} />
          </div>

          {error ? <ErrorState message={error} /> : null}

          <Button type="submit" className="w-full" disabled={disabled || submitting}>
            {submitting ? <Spinner className="text-primary-foreground" /> : <Sparkles className="size-4" />}
            Open case
          </Button>
          <p className="text-[11px] text-muted-foreground">
            A new case opens in <span className="text-foreground">NEW</span> status. Run the multi-engine investigation
            from the case workspace to populate intelligence.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

function ScenarioCard({
  s,
  disabled,
  onCreated,
}: {
  s: ScenarioSummary
  disabled: boolean
  onCreated: (c: InvestigationCase) => void
}) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function instantiate() {
    setLoading(true)
    setError(null)
    try {
      const res = await apiPost<{ case: InvestigationCase }>("/api/cases", { demoScenarioId: s.id })
      onCreated(res.case)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.")
      setLoading(false)
    }
  }

  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">{s.name}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="default">{titleFromTypology(s.typology)}</Badge>
              <Badge variant="outline">{CHAIN_LABEL[s.chain]}</Badge>
              {s.crossChain ? <Badge variant="outline">→ {CHAIN_LABEL[s.crossChain]}</Badge> : null}
              <ProvenanceBadge provenance="DEMO_DATA" />
            </div>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground text-pretty">{s.narrative}</p>
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Coins className="size-3" /> {usd(s.reportedLossUsd)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" /> {s.connectedVictims} victims
          </span>
          <span className="inline-flex items-center gap-1">
            <GitBranch className="size-3" /> {s.nodeCount} nodes · {s.edgeCount} edges
          </span>
        </div>
        {error ? <ErrorState message={error} /> : null}
        <Button size="sm" variant="outline" className="w-full" onClick={instantiate} disabled={disabled || loading}>
          {loading ? <Spinner /> : <PlayCircle className="size-3.5" />} Instantiate case
        </Button>
      </CardContent>
    </Card>
  )
}
