"use client"

import * as React from "react"
import { Info, Route, ArrowRight } from "lucide-react"
import { CopyAddress, AttributionBadge, ProvenanceBadge } from "@/components/intel/shared"
import { Badge } from "@/components/ui/badge"
import { usdOrUnknown, dateTime, shortAddr, CHAIN_LABEL } from "@/lib/client/format"
import type { TraceGraph, TraceNode, TraceEdge, TraceNodeType, TracePath } from "@/lib/engines/fund-tracing"

const TYPE_COLOR: Record<TraceNodeType, string> = {
  TARGET: "var(--primary)",
  COUNTERPARTY: "var(--chart-2)",
  INTERMEDIATE: "var(--muted-foreground)",
  VASP: "var(--risk-low)",
}

const TYPE_LABEL: Record<TraceNodeType, string> = {
  TARGET: "Target wallet",
  COUNTERPARTY: "Direct counterparty",
  INTERMEDIATE: "Intermediate hop",
  VASP: "Possible VASP",
}

const NODE_RADIUS = 9
const COL_WIDTH = 190
const ROW_HEIGHT = 56
const PADDING = 40

interface Positioned extends TraceNode {
  x: number
  y: number
}

function layout(nodes: TraceNode[]): Map<string, Positioned> {
  const byHop = new Map<number, TraceNode[]>()
  for (const n of nodes) {
    const list = byHop.get(n.hop) ?? []
    list.push(n)
    byHop.set(n.hop, list)
  }
  const positioned = new Map<string, Positioned>()
  const maxHop = Math.max(0, ...Array.from(byHop.keys()))
  for (let hop = 0; hop <= maxHop; hop++) {
    const col = byHop.get(hop) ?? []
    col.forEach((n, i) => {
      positioned.set(n.id, {
        ...n,
        x: PADDING + hop * COL_WIDTH,
        y: PADDING + i * ROW_HEIGHT,
      })
    })
  }
  return positioned
}

export function FundFlowGraph({ graph }: { graph: TraceGraph }) {
  const positions = React.useMemo(() => layout(graph.nodes), [graph.nodes])
  const [selectedNode, setSelectedNode] = React.useState<string | null>(graph.targetWallet)
  const [selectedEdge, setSelectedEdge] = React.useState<string | null>(null)

  const maxHop = Math.max(0, ...graph.nodes.map((n) => n.hop))
  const rowsPerHop = Math.max(
    1,
    ...Array.from(new Set(graph.nodes.map((n) => n.hop))).map(
      (hop) => graph.nodes.filter((n) => n.hop === hop).length,
    ),
  )
  const width = PADDING * 2 + maxHop * COL_WIDTH + 20
  const height = PADDING * 2 + Math.max(0, rowsPerHop - 1) * ROW_HEIGHT + 20

  const node = selectedNode ? positions.get(selectedNode) : null
  const edge = selectedEdge ? graph.edges.find((e) => e.id === selectedEdge) : null
  const nodeEdges = node ? graph.edges.filter((e) => e.from === node.id || e.to === node.id) : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {(Object.keys(TYPE_LABEL) as TraceNodeType[]).map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: TYPE_COLOR[t] }} />
              {TYPE_LABEL[t]}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="tabular">
            {graph.hopsReached} of {graph.maxHops} hop{graph.maxHops === 1 ? "" : "s"} traced
          </Badge>
          <ProvenanceBadge provenance={graph.provenance} />
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin rounded-lg border border-border bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:22px_22px]">
        <svg width={Math.max(width, 360)} height={Math.max(height, 140)} className="block">
          {graph.edges.map((e) => {
            const a = positions.get(e.from)
            const b = positions.get(e.to)
            if (!a || !b) return null
            const active = selectedEdge === e.id
            return (
              <line
                key={e.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? "var(--primary)" : "var(--border)"}
                strokeWidth={active ? 2.5 : 1.5}
                className="cursor-pointer"
                onClick={() => {
                  setSelectedEdge(e.id)
                  setSelectedNode(null)
                }}
              >
                <title>
                  {shortAddr(e.from)} → {shortAddr(e.to)} · {usdOrUnknown(e.usdValue)} · {e.txHash.slice(0, 14)}…
                </title>
              </line>
            )
          })}
          {Array.from(positions.values()).map((n) => {
            const active = selectedNode === n.id
            return (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                className="cursor-pointer"
                onClick={() => {
                  setSelectedNode(n.id)
                  setSelectedEdge(null)
                }}
              >
                {active ? (
                  <circle r={NODE_RADIUS + 5} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeOpacity={0.6} />
                ) : null}
                <circle r={NODE_RADIUS} fill={TYPE_COLOR[n.type]} stroke="var(--background)" strokeWidth={2} />
                <text x={0} y={NODE_RADIUS + 14} textAnchor="middle" className="fill-muted-foreground text-[10px] font-mono">
                  {shortAddr(n.id)}
                </text>
                <title>
                  {n.id} · {TYPE_LABEL[n.type]} · hop {n.hop}
                  {n.vasp ? ` · ${n.vasp.name} (${n.attribution})` : ""}
                </title>
              </g>
            )
          })}
        </svg>
      </div>

      {graph.truncated ? (
        <div className="flex items-start gap-2 rounded-md border border-[var(--demo)]/40 bg-[var(--demo)]/5 px-3 py-2.5 text-xs text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--demo)]" />
          <span>
            <strong className="font-semibold">Partial trace. </strong>
            {graph.truncationReasons.join(" ")}
          </span>
        </div>
      ) : null}

      {node ? (
        <div className="rounded-md border border-border bg-background/40 p-3 text-xs">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <CopyAddress address={node.id} full />
            <Badge variant="outline" className="font-mono">
              {shortAddr(node.id)}
            </Badge>
            <Badge variant="outline" style={{ color: TYPE_COLOR[node.type], borderColor: `color-mix(in oklch, ${TYPE_COLOR[node.type]} 40%, transparent)` }}>
              {TYPE_LABEL[node.type]}
            </Badge>
            {node.attribution ? <AttributionBadge category={node.attribution} /> : null}
            {node.vasp ? <span className="text-muted-foreground">{node.vasp.name}</span> : null}
          </div>
          <div className="mb-3 grid gap-1.5 sm:grid-cols-2">
            <DetailRow label="Chain" value={CHAIN_LABEL[node.chain]} />
            <DetailRow label="Hop" value={String(node.hop)} />
            <DetailRow label="Node type" value={TYPE_LABEL[node.type]} />
            <DetailRow label="Attribution" value={node.attribution ?? "None"} />
          </div>
          <div className="mb-3 flex items-center justify-between rounded-sm border border-border/50 px-2 py-1.5">
            <span className="text-muted-foreground">Provenance</span>
            <ProvenanceBadge provenance={node.provenance} />
          </div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Transfers involving this wallet ({nodeEdges.length})
          </p>
          <div className="space-y-1">
            {nodeEdges.slice(0, 8).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setSelectedEdge(e.id)
                  setSelectedNode(null)
                }}
                className="flex w-full items-center justify-between gap-2 rounded-sm border border-border/50 px-2 py-1.5 text-left hover:border-primary/50"
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  {shortAddr(e.from)} → {shortAddr(e.to)}
                </span>
                <span className="tabular font-medium text-foreground">{usdOrUnknown(e.usdValue)}</span>
              </button>
            ))}
            {nodeEdges.length === 0 ? <p className="text-muted-foreground">No transfers recorded for this wallet.</p> : null}
          </div>
        </div>
      ) : null}

      {edge ? (
        <div className="rounded-md border border-border bg-background/40 p-3 text-xs">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Route className="size-3.5" /> Transaction detail
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <DetailRow label="Hash" value={edge.txHash} mono />
            <DetailRow label="Amount" value={`${edge.amount} ${edge.asset}`} />
            <DetailRow label="USD value" value={usdOrUnknown(edge.usdValue)} />
            <DetailRow label="Time" value={edge.timestamp ? dateTime(edge.timestamp) : "Unknown"} />
            <DetailRow label="From" value={edge.from} mono />
            <DetailRow label="To" value={edge.to} mono />
            <DetailRow label="Direction" value={edge.direction === "outbound" ? "Outbound" : "Inbound"} />
            <DetailRow label="Hop" value={String(edge.hop)} />
          </div>
          <div className="mt-2 flex items-center justify-between rounded-sm border border-border/50 px-2 py-1.5">
            <span className="text-muted-foreground">Provenance</span>
            <ProvenanceBadge provenance={edge.provenance} />
          </div>
        </div>
      ) : null}

      {graph.paths.length > 0 ? <PathSummary paths={graph.paths} nodes={graph.nodes} edges={graph.edges} /> : null}

      {graph.truncated ? (
        <p className="text-[11px] text-muted-foreground text-pretty">
          {graph.hopsReached} of {graph.maxHops} requested hop{graph.maxHops === 1 ? "" : "s"} traced. Partial trace —
          not the full fund flow.
        </p>
      ) : null}

      <p className="text-[11px] text-muted-foreground text-pretty">{graph.summary}</p>
    </div>
  )
}

// Neutral, investigative-language walk of representative fund-flow paths.
// Never implies criminality merely because a wallet appears in a path.
function PathSummary({ paths, edges }: { paths: TracePath[]; nodes: TraceNode[]; edges: TraceEdge[] }) {
  const edgeById = new Map(edges.map((e) => [e.id, e]))
  const endLabel: Record<TraceNodeType, string> = {
    TARGET: "No further movement observed",
    COUNTERPARTY: "Direct counterparty endpoint",
    INTERMEDIATE: "Intermediate wallet endpoint",
    VASP: "Known VASP endpoint",
  }
  const shown = paths.slice(0, 6)

  return (
    <div className="rounded-md border border-border bg-background/40 p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Route className="size-3.5" /> Observed transfer paths ({paths.length})
      </div>
      <div className="space-y-2">
        {shown.map((p, i) => {
          const totalUsd = p.edgeIds.reduce((sum, id) => sum + (edgeById.get(id)?.usdValue ?? 0), 0)
          return (
            <div key={i} className="rounded-sm border border-border/50 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted-foreground">
                {p.addresses.map((addr, idx) => (
                  <React.Fragment key={`${addr}-${idx}`}>
                    {idx > 0 ? <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" /> : null}
                    <span className={idx === 0 ? "text-foreground" : undefined}>{shortAddr(addr)}</span>
                  </React.Fragment>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {p.addresses.length - 1} hop{p.addresses.length - 1 === 1 ? "" : "s"} · {endLabel[p.endType]} ·
                potential fund flow of {usdOrUnknown(totalUsd || null)}
              </p>
            </div>
          )
        })}
      </div>
      {paths.length > shown.length ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {paths.length - shown.length} additional path(s) not shown.
        </p>
      ) : null}
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-foreground" : "font-medium text-foreground"}>{value}</span>
    </div>
  )
}
