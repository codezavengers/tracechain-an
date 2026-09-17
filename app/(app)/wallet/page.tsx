"use client"

import * as React from "react"
import { Search, Wallet as WalletIcon, Eye, CheckCircle2, XCircle, Info, Coins, GitBranch } from "lucide-react"
import { SectionHeading, ProvenanceBadge, CopyAddress, StatTile, KindBadge } from "@/components/intel/shared"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input, Select, Label } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { Spinner, ErrorState, EmptyState } from "@/components/ui/feedback"
import { TransactionsTable } from "@/components/intel/transactions-table"
import { FundFlowGraph } from "@/components/intel/fund-flow-graph"
import { apiPost, useSession } from "@/lib/client/hooks"
import { PERMISSIONS } from "@/lib/auth"
import { CHAIN_LABEL, usdOrUnknown, dateTime } from "@/lib/client/format"
import { shortAddress } from "@/lib/blockchain/address-utils"
import type { Chain, WalletMetadata, Transaction, AddressValidation, DataProvenance } from "@/lib/types"
import type { TraceGraph } from "@/lib/engines/fund-tracing"

type DataSource = "LIVE" | "INDEXED" | "CACHED" | "MOCK"

interface TokenTransfer {
  hash: string
  chain: Chain
  from: string
  to: string
  tokenSymbol: string
  tokenName: string
  tokenAddress: string
  amount: number
  decimals: number
  timestamp: string | null
  blockHeight: number | null
  direction?: "in" | "out"
}

interface WalletLookup {
  validation: AddressValidation
  mode: "LIVE" | "DEMO"
  dataSource: DataSource
  dataSourceLabel: string
  demo: boolean
  notice: string | null
  provider: string
  fetchedAt: string
  cached: boolean
  metadata: WalletMetadata
  balance: { balance: number; asset: string; usdBalance: number | null }
  transactions: Transaction[]
  tokenTransfers: TokenTransfer[]
  provenance: DataProvenance
  meta: { totalFetched: number; pagesFetched: number; truncated: boolean } | null
  truncated: boolean
}

export default function WalletInvestigationPage() {
  const { user } = useSession()
  const canWatch = user ? PERMISSIONS.runInvestigation(user.role) : false
  const [address, setAddress] = React.useState("")
  const [chain, setChain] = React.useState<Chain | "">("")
  const [mode, setMode] = React.useState<"LIVE" | "DEMO">("LIVE")
  const [data, setData] = React.useState<WalletLookup | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [watchMsg, setWatchMsg] = React.useState<string | null>(null)

  const [traceGraph, setTraceGraph] = React.useState<TraceGraph | null>(null)
  const [traceHops, setTraceHops] = React.useState(2)
  const [traceLoading, setTraceLoading] = React.useState(false)
  const [traceError, setTraceError] = React.useState<string | null>(null)

  async function lookup(e: React.FormEvent) {
    e.preventDefault()
    if (!address.trim()) return
    setLoading(true)
    setError(null)
    setData(null)
    setWatchMsg(null)
    setTraceGraph(null)
    setTraceError(null)
    try {
      const qs = new URLSearchParams({ mode })
      if (chain) qs.set("chain", chain)
      const res = await fetch(`/api/wallet/${encodeURIComponent(address.trim())}?${qs}`, { credentials: "include" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Lookup failed.")
      setData(json as WalletLookup)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.")
    } finally {
      setLoading(false)
    }
  }

  async function runTrace() {
    if (!data) return
    setTraceLoading(true)
    setTraceError(null)
    setTraceGraph(null)
    try {
      const qs = new URLSearchParams({ chain: data.metadata.chain, maxHops: String(traceHops) })
      const res = await fetch(`/api/wallet/${encodeURIComponent(data.metadata.address)}/trace?${qs}`, {
        credentials: "include",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Fund trace failed.")
      setTraceGraph(json.graph as TraceGraph)
    } catch (e) {
      setTraceError(e instanceof Error ? e.message : "Fund trace failed.")
    } finally {
      setTraceLoading(false)
    }
  }

  async function addToWatch() {
    if (!data) return
    setWatchMsg(null)
    try {
      await apiPost("/api/watchlist", {
        address: data.metadata.address,
        chain: data.metadata.chain,
        label: "Watched from wallet investigation",
      })
      setWatchMsg("Added to Watchtower monitoring.")
    } catch (e) {
      setWatchMsg(e instanceof Error ? e.message : "Failed to add to watchlist.")
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SectionHeading
        title="Wallet Investigation"
        description="Validate any address, identify its network, and pull balance, metadata and transaction history from the active provider."
      />

      <Card>
        <CardContent className="p-4">
          <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label htmlFor="addr">Wallet address</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="addr"
                  className="pl-8 font-mono text-xs"
                  placeholder="bc1q… / 0x… / T…"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            </div>
            <div className="w-32 space-y-1.5">
              <Label htmlFor="wmode">Data mode</Label>
              <Select id="wmode" value={mode} onChange={(e) => setMode(e.target.value as "LIVE" | "DEMO")}>
                <option value="LIVE">Live</option>
                <option value="DEMO">Demo</option>
              </Select>
            </div>
            <div className="w-40 space-y-1.5">
              <Label htmlFor="wchain">Chain</Label>
              <Select id="wchain" value={chain} onChange={(e) => setChain(e.target.value as Chain)}>
                <option value="">Auto-detect</option>
                {(Object.keys(CHAIN_LABEL) as Chain[]).map((c) => (
                  <option key={c} value={c}>
                    {CHAIN_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={loading || !address.trim()}>
              {loading ? <Spinner className="text-primary-foreground" /> : <Search className="size-4" />} Investigate
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {!data && !loading && !error ? (
        <EmptyState
          icon={WalletIcon}
          title="Investigate a wallet"
          description="Enter an address to validate its network and retrieve on-chain intelligence."
        />
      ) : null}

      {data ? (
        <div className="space-y-4">
          {data.notice || data.demo ? <DataSourceNotice source={data.dataSource} notice={data.notice} /> : null}

          <Card>
            <CardHeader className="gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  {data.validation.valid ? (
                    <CheckCircle2 className="size-4 text-risk-low" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                  <CopyAddress address={data.metadata.address} full />
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline">{CHAIN_LABEL[data.metadata.chain]}</Badge>
                  <KindBadge kind={data.metadata.kind} />
                  <DataSourceBadge source={data.dataSource} label={data.dataSourceLabel} />
                  <ProvenanceBadge provenance={data.provenance} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{data.validation.reason}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile
                  label="Balance (USD)"
                  value={usdOrUnknown(data.balance.usdBalance)}
                  hint={data.balance.usdBalance === null ? "No reliable USD price was available." : undefined}
                />
                <StatTile
                  label={`Balance (${data.balance.asset})`}
                  value={data.balance.balance.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                />
                <StatTile label="Tx count" value={data.metadata.txCount} />
                <StatTile
                  label="Data source"
                  value={data.dataSourceLabel}
                  accent={data.demo ? "var(--demo)" : "var(--risk-low)"}
                />
              </div>
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <MetaRow label="First seen" value={data.metadata.firstSeen ? dateTime(data.metadata.firstSeen) : "Unknown"} />
                <MetaRow label="Last seen" value={data.metadata.lastSeen ? dateTime(data.metadata.lastSeen) : "Unknown"} />
                <MetaRow label="Provider" value={data.provider} />
                <MetaRow label="Fetched" value={`${dateTime(data.fetchedAt)}${data.cached ? " (cached)" : ""}`} />
                {data.metadata.label ? <MetaRow label="Label" value={data.metadata.label} /> : null}
                {data.metadata.attribution?.vasp ? (
                  <MetaRow
                    label="Attribution"
                    value={`${data.metadata.attribution.vasp.name} (${data.metadata.attribution.category})`}
                  />
                ) : null}
              </div>
              {canWatch ? (
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="outline" onClick={addToWatch}>
                    <Eye className="size-3.5" /> Add to Watchtower
                  </Button>
                  {watchMsg ? <span className="text-xs text-muted-foreground">{watchMsg}</span> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Transaction history
                <Badge variant="outline">{data.transactions.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.truncated ? <TruncationNotice count={data.transactions.length} /> : null}
              <TransactionsTable txs={data.transactions} root={data.metadata.address} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="size-4 text-muted-foreground" />
                Token transfers
                <Badge variant="outline">{data.tokenTransfers.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TokenTransfersTable transfers={data.tokenTransfers} root={data.metadata.address} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <GitBranch className="size-4 text-muted-foreground" />
                  Fund flow tracing
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Select
                    className="w-32"
                    value={String(traceHops)}
                    onChange={(e) => setTraceHops(Number(e.target.value))}
                  >
                    <option value="1">1 hop</option>
                    <option value="2">2 hops</option>
                    <option value="3">3 hops</option>
                  </Select>
                  <Button size="sm" variant="outline" onClick={runTrace} disabled={traceLoading}>
                    {traceLoading ? <Spinner /> : <GitBranch className="size-3.5" />} Trace funds
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Follows this wallet&apos;s outbound and inbound transfers across counterparties, up to 3 hops. Click a
                wallet or a connecting line for details.
              </p>
            </CardHeader>
            <CardContent>
              {traceError ? <ErrorState message={traceError} /> : null}
              {!traceGraph && !traceLoading && !traceError ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Run a trace to map how funds move to and from this wallet.
                </p>
              ) : null}
              {traceGraph ? <FundFlowGraph graph={traceGraph} /> : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

const SOURCE_STYLE: Record<DataSource, string> = {
  LIVE: "border-risk-low/40 text-risk-low",
  INDEXED: "border-primary/40 text-primary",
  CACHED: "border-border text-muted-foreground",
  MOCK: "border-[var(--demo)]/50 text-[var(--demo)]",
}

function DataSourceBadge({ source, label }: { source: DataSource; label: string }) {
  return (
    <Badge variant="outline" className={SOURCE_STYLE[source]}>
      {label}
    </Badge>
  )
}

function DataSourceNotice({ source, notice }: { source: DataSource; notice: string | null }) {
  const isDemo = source === "MOCK"
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs ${
        isDemo ? "border-[var(--demo)]/50 bg-[var(--demo)]/10 text-foreground" : "border-border bg-background/40 text-muted-foreground"
      }`}
    >
      <Info className={`mt-0.5 size-4 shrink-0 ${isDemo ? "text-[var(--demo)]" : "text-muted-foreground"}`} />
      <span>
        {isDemo ? <strong className="font-semibold">DEMO DATA. </strong> : null}
        {notice ?? "This result is deterministic demo data, not live blockchain data."}
      </span>
    </div>
  )
}

function TruncationNotice({ count }: { count: number }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-[var(--demo)]/40 bg-[var(--demo)]/5 px-3 py-2.5 text-xs text-foreground"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-[var(--demo)]" />
      <span>
        <strong className="font-semibold">Partial history. </strong>
        Results were limited to the investigation maximum ({count.toLocaleString()} transactions). Additional matching
        transactions may exist beyond this window — narrow the date range to see older activity.
      </span>
    </div>
  )
}

function TokenTransfersTable({ transfers, root }: { transfers: TokenTransfer[]; root: string }) {
  if (transfers.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No token transfers found for this address.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Token</th>
            <th className="py-2 pr-3 font-medium">Direction</th>
            <th className="py-2 pr-3 font-medium">Amount</th>
            <th className="py-2 pr-3 font-medium">Counterparty</th>
            <th className="py-2 pr-3 font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((t) => {
            const inbound = t.direction === "in" || t.to.toLowerCase() === root.toLowerCase()
            const counterparty = inbound ? t.from : t.to
            return (
              <tr key={`${t.hash}-${t.tokenAddress}-${counterparty}`} className="border-b border-border/50">
                <td className="py-2 pr-3">
                  <span className="font-medium text-foreground">{t.tokenSymbol}</span>{" "}
                  <span className="text-muted-foreground">{t.tokenName}</span>
                </td>
                <td className="py-2 pr-3">
                  <Badge variant="outline" className={inbound ? "text-risk-low" : "text-risk-high"}>
                    {inbound ? "IN" : "OUT"}
                  </Badge>
                </td>
                <td className="py-2 pr-3 font-mono">
                  {t.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </td>
                <td className="py-2 pr-3 font-mono">{shortAddress(counterparty)}</td>
                <td className="py-2 pr-3 text-muted-foreground">{dateTime(t.timestamp)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
