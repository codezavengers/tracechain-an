"use client"

import { CopyAddress, KindBadge, AttributionBadge } from "@/components/intel/shared"
import { usd, dateTime } from "@/lib/client/format"
import type { JourneyStep } from "@/lib/types"

// Vertical fraud-journey timeline built from the highest-value path.
export function JourneyTimeline({ steps }: { steps: JourneyStep[] }) {
  if (!steps.length) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        No journey reconstructed. Run the investigation to trace fund movement.
      </p>
    )
  }
  return (
    <ol className="relative space-y-4 pl-6">
      <span className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden="true" />
      {steps.map((s, i) => (
        <li key={s.step} className="relative">
          <span
            className="absolute -left-6 top-1 flex size-3.5 items-center justify-center rounded-full border-2 border-background"
            style={{ background: i === steps.length - 1 ? "var(--risk-low)" : "var(--primary)" }}
            aria-hidden="true"
          />
          <div className="rounded-lg border border-border bg-card/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold tabular text-muted-foreground">
                  {String(s.step).padStart(2, "0")}
                </span>
                <p className="text-sm font-medium text-foreground">{s.title}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <KindBadge kind={s.kind} />
                {s.attribution ? <AttributionBadge category={s.attribution} /> : null}
              </div>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground text-pretty">{s.description}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <CopyAddress address={s.address} />
              <span className="flex items-center gap-3">
                <span className="tabular font-medium text-foreground">{usd(s.usdValue)}</span>
                <span>{dateTime(s.timestamp)}</span>
              </span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
