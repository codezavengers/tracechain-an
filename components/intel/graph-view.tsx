"use client"

import * as React from "react"
import { layoutGraph } from "@/lib/graph/graph"
import { WALLET_KIND_LABEL, usd, shortAddr, CHAIN_LABEL } from "@/lib/client/format"
import { CopyAddress, KindBadge } from "@/components/intel/shared"
import { Badge } from "@/components/ui/badge"
import type { TransactionGraph, WalletKind, GraphEdge } from "@/lib/types"

const KIND_COLOR: Record<WalletKind, string> = {
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

const W = 1000
const H = 620

// Deterministic SVG rendering of the transaction graph. Layout comes from the
// shared layered layout in lib/graph so the picture matches the traversal logic.
export function GraphView({ graph }: { graph: TransactionGraph }) {
  const pos = React.useMemo(() => layoutGraph(graph, W, H), [graph])
  const [selected, setSelected] = React.useState<string | null>(graph.rootAddress)

  const nodeMap = React.useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const kindsPresent = React.useMemo(() => {
    const set = new Set<WalletKind>()
    graph.nodes.forEach((n) => set.add(n.kind))
    return Array.from(set)
  }, [graph])

  const selectedNode = selected ? nodeMap.get(selected) : null
  const selectedEdges = selected
    ? graph.edges.filter((e) => e.source === selected || e.target === selected)
    : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        {kindsPresent.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: KIND_COLOR[k] }} />
            {WALLET_KIND_LABEL[k]}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto scrollbar-thin rounded-lg border border-border bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:22px_22px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[720px]"
          role="img"
          aria-label={`Transaction graph for ${graph.rootAddress} with ${graph.nodes.length} nodes`}
        >
          <defs>
            <marker id="tc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--muted-foreground)" />
            </marker>
            <marker id="tc-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--primary)" />
            </marker>
          </defs>

          {graph.edges.map((e) => {
            const a = pos[e.source]
            const b = pos[e.target]
            if (!a || !b) return null
            const active = selected != null && (e.source === selected || e.target === selected)
            return (
              <g key={e.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={active ? "var(--primary)" : "var(--border)"}
                  strokeWidth={active ? 2 : 1.25}
                  strokeOpacity={active ? 0.9 : 0.55}
                  markerEnd={active ? "url(#tc-arrow-active)" : "url(#tc-arrow)"}
                >
                  <title>{`${shortAddr(e.source)} → ${shortAddr(e.target)} · ${usd(e.usdValue)} · ${e.kind.replace(/_/g, " ")}`}</title>
                </line>
              </g>
            )
          })}

          {graph.nodes.map((n) => {
            const p = pos[n.id]
            if (!p) return null
            const isRoot = n.id === graph.rootAddress
            const r = isRoot ? 13 : 9
            const active = n.id === selected
            return (
              <g key={n.id} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" onClick={() => setSelected(n.id)}>
                {active ? <circle r={r + 5} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeOpacity={0.6} /> : null}
                <circle
                  r={r}
                  fill={KIND_COLOR[n.kind]}
                  fillOpacity={0.9}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
                <text
                  y={r + 13}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono"
                  style={{ fontSize: 10 }}
                >
                  {shortAddr(n.id, 6, 4)}
                </text>
                <title>{`${WALLET_KIND_LABEL[n.kind]} · ${n.id}${n.usdValue ? ` · ${usd(n.usdValue)}` : ""}`}</title>
              </g>
            )
          })}
        </svg>
      </div>

      {selectedNode ? (
        <div className="rounded-lg border border-border bg-card/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KindBadge kind={selectedNode.kind} />
              <CopyAddress address={selectedNode.id} full />
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline">{CHAIN_LABEL[selectedNode.chain]}</Badge>
              {typeof selectedNode.depth === "number" ? <Badge variant="muted">Hop {selectedNode.depth}</Badge> : null}
              {selectedNode.usdValue ? <Badge variant="muted">{usd(selectedNode.usdValue)}</Badge> : null}
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Connections ({selectedEdges.length})
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto scrollbar-thin">
              {selectedEdges.length ? (
                selectedEdges.map((e) => <EdgeRow key={e.id} edge={e} focus={selectedNode.id} />)
              ) : (
                <p className="text-xs text-muted-foreground">Terminal node — no onward movement observed.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function EdgeRow({ edge, focus }: { edge: GraphEdge; focus: string }) {
  const outbound = edge.source === focus
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs">
      <span className="flex items-center gap-1.5">
        <span className={outbound ? "text-risk-high" : "text-risk-low"}>{outbound ? "→ out" : "← in"}</span>
        <span className="font-mono text-muted-foreground">{shortAddr(outbound ? edge.target : edge.source, 8, 5)}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="tabular font-medium">{usd(edge.usdValue)}</span>
        <span className="text-[10px] uppercase text-muted-foreground">{edge.kind.replace(/_/g, " ")}</span>
      </span>
    </div>
  )
}
