"use client"

import * as React from "react"
import { ArrowLeftRight, ExternalLink } from "lucide-react"
import { SectionHeading } from "@/components/intel/shared"
import { CaseSelect } from "@/components/intel/case-select"
import { CrossChainPanel } from "@/components/intel/intelligence-panels"
import { LinkButton } from "@/components/ui/link-button"
import { LoadingBlock, EmptyState } from "@/components/ui/feedback"
import { useCases, useCaseDetail } from "@/lib/client/hooks"

export default function CrossChainPage() {
  const { data: casesData } = useCases()
  const [caseId, setCaseId] = React.useState("")
  const effectiveId = caseId || casesData?.cases[0]?.id || ""
  const { data, isLoading } = useCaseDetail(effectiveId)
  const inv = data?.investigation ?? null

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeading
        title="CrossChain Radar"
        description="Detects bridge hops that move value between networks and re-links the trail on the destination chain so tracing continues across chains."
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
        <LoadingBlock label="Scanning for cross-chain movement…" />
      ) : inv ? (
        <CrossChainPanel inv={inv} />
      ) : (
        <EmptyState
          icon={ArrowLeftRight}
          title="No cross-chain analysis"
          description="Run the case investigation to detect bridge activity."
        />
      )}
    </div>
  )
}
