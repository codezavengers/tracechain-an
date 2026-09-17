import type { InvestigationResult } from "@/lib/engines"
import type { Chain } from "@/lib/types"

// A single practical transaction record derived from an investigation result,
// shaped for the `transactions` table. Authoritative normalized fields are
// preserved as top-level columns; anything chain-specific / non-columnar is
// kept verbatim in `data` (JSONB) so nothing is fabricated or lost.
export interface ExtractedTransaction {
  id: string
  investigationId: string
  hash: string | null
  chain: string | null
  fromAddress: string | null
  toAddress: string | null
  amount: number | null
  asset: string | null
  usdValue: number | null
  data: unknown
  createdAt: string
}

// Extract persistent transaction records from an existing InvestigationResult.
//
// The InvestigationResult exposes the traced fund path as `journey` steps.
// Each hop between two consecutive steps is a practical fund movement: the
// previous step's address sent value to the current step's address. We persist
// exactly what the result actually contains — from/to/usdValue/timestamp — and
// leave hash/amount/asset null when the result does not carry them (they live
// in the blockchain provider layer, not in the persisted result). The full
// journey step is preserved in `data` so no chain-specific detail is dropped.
//
// This NEVER fabricates transactions: an empty or single-step journey yields no
// rows, and no synthetic hashes/amounts/assets are invented.
export function extractTransactions(
  investigationId: string,
  result: InvestigationResult | null | undefined,
  chain: Chain | string,
  now: string,
): ExtractedTransaction[] {
  const journey = result?.journey
  if (!journey || journey.length < 2) return []

  const rows: ExtractedTransaction[] = []
  for (let i = 1; i < journey.length; i++) {
    const from = journey[i - 1]
    const to = journey[i]
    rows.push({
      id: `${investigationId}:tx:${i - 1}`,
      investigationId,
      hash: null,
      chain: typeof chain === "string" ? chain : String(chain),
      fromAddress: from.address ?? null,
      toAddress: to.address ?? null,
      amount: null,
      asset: null,
      usdValue: Number.isFinite(to.usdValue) ? to.usdValue : null,
      data: { step: to.step, title: to.title, kind: to.kind, attribution: to.attribution ?? null, timestamp: to.timestamp ?? null },
      createdAt: to.timestamp ?? now,
    })
  }
  return rows
}
