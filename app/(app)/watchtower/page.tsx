"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, Plus, Activity } from "lucide-react"
import { SectionHeading, StatTile, CopyAddress } from "@/components/intel/shared"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input, Select, Label } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { LoadingBlock, ErrorState, EmptyState, Spinner } from "@/components/ui/feedback"
import { useWatchlist, apiPost, useSession } from "@/lib/client/hooks"
import { PERMISSIONS } from "@/lib/auth"
import { CHAIN_LABEL, usd, relTime } from "@/lib/client/format"
import type { Chain, WatchedWallet } from "@/lib/types"

const STATUS_COLOR: Record<WatchedWallet["status"], string> = {
  ACTIVE: "var(--risk-low)",
  DORMANT: "var(--muted-foreground)",
  TRIGGERED: "var(--risk-critical)",
}

export default function WatchtowerPage() {
  const { user } = useSession()
  const canAdd = user ? PERMISSIONS.runInvestigation(user.role) : false
  const { data, error, isLoading, mutate } = useWatchlist()
  const list = data?.watchlist ?? []

  const [address, setAddress] = React.useState("")
  const [chain, setChain] = React.useState<Chain | "">("")
  const [label, setLabel] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const triggered = list.filter((w) => w.status === "TRIGGERED").length
  const totalUsd = list.reduce((s, w) => s + w.usdBalance, 0)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!address.trim()) return
    setSubmitting(true)
    setFormError(null)
    try {
      await apiPost("/api/watchlist", { address: address.trim(), chain: chain || undefined, label: label || undefined })
      setAddress("")
      setLabel("")
      setChain("")
      await mutate()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to add wallet.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SectionHeading
        title="Watchtower"
        description="Continuous monitoring of wallets of interest. Triggered wallets indicate new movement that may warrant re-tracing."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Tracked wallets" value={list.length} icon={Eye} accent="var(--primary)" />
        <StatTile label="Triggered" value={triggered} icon={Activity} accent="var(--risk-critical)" />
        <StatTile label="Monitored balance" value={usd(totalUsd)} accent="var(--risk-low)" />
        <StatTile label="Chains" value={new Set(list.map((w) => w.chain)).size} />
      </div>

      {canAdd ? (
        <Card>
          <CardHeader>
            <CardTitle>Add wallet to monitoring</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="w-addr">Address</Label>
                <Input
                  id="w-addr"
                  className="font-mono text-xs"
                  placeholder="bc1q… / 0x… / T…"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div className="w-40 space-y-1.5">
                <Label htmlFor="w-chain">Chain</Label>
                <Select id="w-chain" value={chain} onChange={(e) => setChain(e.target.value as Chain)}>
                  <option value="">Auto-detect</option>
                  {(Object.keys(CHAIN_LABEL) as Chain[]).map((c) => (
                    <option key={c} value={c}>
                      {CHAIN_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="min-w-40 flex-1 space-y-1.5">
                <Label htmlFor="w-label">Label</Label>
                <Input id="w-label" placeholder="e.g. Suspected cash-out endpoint" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <Button type="submit" disabled={submitting || !address.trim()}>
                {submitting ? <Spinner className="text-primary-foreground" /> : <Plus className="size-4" />} Watch
              </Button>
            </form>
            {formError ? (
              <div className="mt-2">
                <ErrorState message={formError} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {error ? <ErrorState message={error.message} /> : null}
      {isLoading ? (
        <LoadingBlock label="Loading watchlist…" />
      ) : list.length ? (
        <div className="overflow-x-auto scrollbar-thin rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Wallet</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Chain</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
                <th className="px-3 py-2 font-medium">Case</th>
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <CopyAddress address={w.address} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{w.label}</td>
                  <td className="px-3 py-2">{CHAIN_LABEL[w.chain]}</td>
                  <td className="px-3 py-2 text-right tabular font-medium">{usd(w.usdBalance)}</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      style={{
                        color: STATUS_COLOR[w.status],
                        borderColor: `color-mix(in oklch, ${STATUS_COLOR[w.status]} 40%, transparent)`,
                      }}
                    >
                      {w.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{relTime(w.lastActivity)}</td>
                  <td className="px-3 py-2">
                    {w.caseId ? (
                      <Link href={`/cases/${w.caseId}`} className="text-primary hover:underline">
                        {w.caseId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Eye} title="No wallets monitored" description="Add a wallet above to begin continuous monitoring." />
      )}
    </div>
  )
}
