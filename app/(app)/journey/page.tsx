"use client"

import * as React from "react"
import { Route, ExternalLink } from "lucide-react"
import { SectionHeading } from "@/components/intel/shared"
import { CaseSelect } from "@/components/intel/case-select"
import { JourneyTimeline } from "@/components/intel/journey-timeline"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LinkButton } from "@/components/ui/link-button"
import { LoadingBlock, EmptyState } from "@/components/ui/feedback"
import { useCases, useCaseDetail } from "@/lib/client/hooks"

export default function JourneyPage() {
  const { data: casesData } = useCases()
  const [caseId, setCaseId] = React.useState("")
  const effectiveId = caseId || casesData?.cases[0]?.id || ""
  const { data, isLoading } = useCaseDetail(effectiveId)
  const journey = data?.investigation?.journey ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeading
        title="Fraud Journey Timeline"
        description="The reconstructed path of the highest-value flow, from the reported wallet to its most probable exit endpoint."
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
        <LoadingBlock label="Reconstructing fraud journey…" />
      ) : journey.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Fund movement</CardTitle>
          </CardHeader>
          <CardContent>
            <JourneyTimeline steps={journey} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={Route}
          title="No journey available"
          description="Run the case investigation to reconstruct the fraud journey from the traced fund flow."
        />
      )}
    </div>
  )
}
