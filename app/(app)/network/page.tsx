"use client"

import * as React from "react"
import { Network, ExternalLink } from "lucide-react"
import { SectionHeading } from "@/components/intel/shared"
import { CaseSelect } from "@/components/intel/case-select"
import { NetworkPanel, EntityPanel } from "@/components/intel/intelligence-panels"
import { LinkButton } from "@/components/ui/link-button"
import { LoadingBlock, EmptyState } from "@/components/ui/feedback"
import { useCases, useCaseDetail } from "@/lib/client/hooks"

export default function NetworkPage() {
  const { data: casesData } = useCases()
  const [caseId, setCaseId] = React.useState("")
  const effectiveId = caseId || casesData?.cases[0]?.id || ""
  const { data, isLoading } = useCaseDetail(effectiveId)
  const inv = data?.investigation ?? null

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SectionHeading
        title="Network Intelligence"
        description="Clusters, shared intermediary infrastructure and behavioral entity resolution that reveal coordinated operations behind a case."
        right={
          effectiveId ? (
            <LinkButton href={`/cases/${effectiveId}`} variant="outline" size="sm">
              Open case <ExternalLink className="size-3.5" />
            </LinkButton>
          ) : undefined
        }
      />

      <CaseSelect value={effectiveId} onChange={setCaseId} />

      {isLoading ? (
        <LoadingBlock label="Discovering fraud network…" />
      ) : inv ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <NetworkPanel inv={inv} />
          <EntityPanel inv={inv} />
        </div>
      ) : (
        <EmptyState
          icon={Network}
          title="No network intelligence"
          description="Run the case investigation to surface clusters and shared infrastructure."
        />
      )}
    </div>
  )
}
