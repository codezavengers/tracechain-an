"use client"

import { ArrowDownLeft, ArrowUpRight } from "lucide-react"
import { CopyAddress, SourceTypeBadge } from "@/components/intel/shared"
import { usdOrUnknown, dateTime, CHAIN_TICKER } from "@/lib/client/format"
import type { Transaction } from "@/lib/types"

export function TransactionsTable({ txs, root }: { txs: Transaction[]; root?: string }) {
  if (!txs.length) {
    return <p className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">No transactions available.</p>
  }
  return (
    <div className="overflow-x-auto scrollbar-thin rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Dir</th>
            <th className="px-3 py-2 font-medium">Tx hash</th>
            <th className="px-3 py-2 font-medium">From → To</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-right font-medium">USD</th>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {txs.map((t) => {
            const out = root ? t.from === root : t.direction === "out"
            return (
              <tr key={t.hash} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2">
                  {out ? (
                    <span className="inline-flex items-center gap-1 text-risk-high">
                      <ArrowUpRight className="size-3" /> Out
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-risk-low">
                      <ArrowDownLeft className="size-3" /> In
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <CopyAddress address={t.hash} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-0.5">
                    <CopyAddress address={t.from} />
                    <CopyAddress address={t.to} className="text-muted-foreground" />
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular">
                  {t.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
                  <span className="text-muted-foreground">{t.asset || CHAIN_TICKER[t.chain]}</span>
                </td>
                <td className="px-3 py-2 text-right tabular font-medium">
                  {t.usdValue === null || t.usdValue === undefined ? (
                    <span className="text-muted-foreground" title="No reliable price was available for this movement.">
                      {usdOrUnknown(t.usdValue)}
                    </span>
                  ) : (
                    usdOrUnknown(t.usdValue)
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{dateTime(t.timestamp)}</td>
                <td className="px-3 py-2">
                  <SourceTypeBadge sourceType={t.sourceType} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
