import * as React from "react"
import { cn } from "@/lib/utils"

type Variant = "default" | "outline" | "solid" | "muted"

export function Badge({
  className,
  variant = "outline",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  const variants: Record<Variant, string> = {
    default: "border-transparent bg-primary/15 text-primary",
    solid: "border-transparent bg-primary text-primary-foreground",
    outline: "border-border bg-transparent text-foreground",
    muted: "border-transparent bg-muted text-muted-foreground",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}
