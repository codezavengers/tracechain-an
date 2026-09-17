import { cn } from "@/lib/utils"

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7", className)}
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--primary)" fillOpacity="0.12" />
      <rect x="1" y="1" width="30" height="30" rx="8" stroke="var(--primary)" strokeOpacity="0.4" />
      <circle cx="9" cy="10" r="2.6" fill="var(--primary)" />
      <circle cx="23" cy="10" r="2.2" fill="var(--foreground)" fillOpacity="0.65" />
      <circle cx="16" cy="22" r="2.6" stroke="var(--primary)" strokeWidth="1.6" />
      <path d="M11 11.5 14.2 20M20.8 11.2 17.8 20M11.4 10h9.2" stroke="var(--primary)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      {!compact ? (
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-foreground">
            TRACECHAIN <span className="text-primary">AI</span>
          </p>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Follow the money
          </p>
        </div>
      ) : null}
    </div>
  )
}
