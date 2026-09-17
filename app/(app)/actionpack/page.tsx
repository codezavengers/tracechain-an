"use client"

import * as React from "react"
import { ClipboardList, Copy, Check, Download, ExternalLink } from "lucide-react"
import { SectionHeading } from "@/components/intel/shared"
import { CaseSelect } from "@/components/intel/case-select"
import { ActionPackPanel } from "@/components/intel/intelligence-panels"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"
import { LoadingBlock, EmptyState } from "@/components/ui/feedback"
import { useCases, useCaseDetail } from "@/lib/client/hooks"

export default function ActionPackPage() {
  const { data: casesData } = useCases()
  const [caseId, setCaseId] = React.useState("")
  const effectiveId = caseId || casesData?.cases[0]?.id || ""
  const { data, isLoading } = useCaseDetail(effectiveId)
  const inv = data?.investigation ?? null
  const [copied, setCopied] = React.useState(false)

  const draft = inv?.actionPack.result.draftVaspRequest ?? ""

  function copyDraft() {
    navigator.clipboard?.writeText(draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function downloadDraft() {
    const blob = new Blob([draft], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${effectiveId}-vasp-request-DRAFT.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeading
        title="ActionPack"
        description="Investigator-ready DRAFT action package. Every item requires human review; the platform takes no automated legal action and freezes no assets."
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
        <LoadingBlock label="Assembling action package…" />
      ) : inv ? (
        <div className="space-y-3">
          <ActionPackPanel inv={inv} />
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="size-4 text-primary" /> Draft VASP request
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={copyDraft}>
                    {copied ? <Check className="size-3.5 text-risk-low" /> : <Copy className="size-3.5" />} Copy
                  </Button>
                  <Button size="sm" variant="outline" onClick={downloadDraft}>
                    <Download className="size-3.5" /> Download
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto scrollbar-thin whitespace-pre-wrap rounded-md border border-border bg-background/40 p-3 font-mono text-[11px] leading-relaxed text-foreground/85">
                {draft}
              </pre>
            </CardContent>
          </Card>
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No action package"
          description="Run the case investigation to generate a prioritized draft action package."
        />
      )}
    </div>
  )
}
