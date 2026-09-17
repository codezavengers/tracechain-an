"use client"

import { Select, Label } from "@/components/ui/field"
import { useCases } from "@/lib/client/hooks"
import type { InvestigationCase } from "@/lib/types"

// Shared case picker used across the standalone intelligence pages.
export function CaseSelect({
  value,
  onChange,
  label = "Case",
  className,
}: {
  value: string
  onChange: (id: string) => void
  label?: string
  className?: string
}) {
  const { data } = useCases()
  const cases: InvestigationCase[] = data?.cases ?? []
  return (
    <div className={className}>
      <Label htmlFor="case-select">{label}</Label>
      <Select
        id="case-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 min-w-56"
      >
        <option value="">Select a case…</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id} — {c.title}
          </option>
        ))}
      </Select>
    </div>
  )
}
