"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface TabItem {
  value: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

export function Tabs({
  items,
  value,
  onValueChange,
  className,
}: {
  items: TabItem[]
  value: string
  onValueChange: (v: string) => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap gap-1 rounded-lg border border-border bg-card/60 p-1", className)} role="tablist">
      {items.map((item) => {
        const active = item.value === value
        const Icon = item.icon
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
