"use client"

import * as React from "react"
import Link from "next/link"
import { Share2, ExternalLink } from "lucide-react"
import { SectionHeading, ProvenanceBadge, StatTile } from "@/components/intel/shared"
import { CaseSelect } from "@/components/intel/case-select"
import { GraphView } from "@/components/intel/graph-view"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LinkButton } from "@/components/ui/link-button"
import { LoadingBlock, EmptyState } from "@/components/ui/feedback"
import { useCases, useCaseDetail } from "@/lib/client/hooks"
import { usd } from "@/lib/client/format"

export default function GraphPage() {
  const { data: casesData } = useCases()
  const [caseId, setCaseId] = React.useState("")
  const effectiveId = caseId || casesData?.cases[0]?.id || ""
  const { data, isLoading } = useCaseDetail(effectiveId)
  const graph = data?.graph ?? null

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <SectionHeading
        title="Transaction Graph"
        description="Interactive fund-flow graph. Nodes are wallets and service endpoints; edges are value transfers. Click any node to inspect its connections."
        right={
          effectiveId ? (
            <LinkButton href={`/cases/${effectiveId}`} variant="outline" size="sm">
              Open case <ExternalLink className="size-3.5" />
            </LinkButton>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <CaseSelect value={effectiveId} onChange={setCaseId} />
        {graph ? <ProvenanceBadge provenance={graph.provenance} /> : null}
      </div>

      {isLoading ? (
        <LoadingBlock label="Building transaction graph…" />
      ) : graph ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Nodes" value={graph.nodes.length} />
            <StatTile label="Edges" value={graph.edges.length} />
            <StatTile label="Trace depth" value={graph.depth} />
            <StatTile
              label="Total flow"
              value={usd(graph.edges.reduce((s, e) => s + e.usdValue, 0))}
              accent="var(--primary)"
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Fund-flow network</CardTitle>
            </CardHeader>
            <CardContent>
              <GraphView graph={graph} />
            </CardContent>
          </Card>
        </>
      ) : (
        <EmptyState
          icon={Share2}
          title="No graph for this case"
          description="Demo scenarios ship with a full multi-hop graph. Select a demo case, or open a case and run its investigation."
          action={
            <Link href="/cases/new" className="text-xs text-primary hover:underline">
              Instantiate a demo scenario
            </Link>
          }
        />
      )}
    </div>
  )
}
