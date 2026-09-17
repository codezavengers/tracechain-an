"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  FolderKanban,
  FilePlus2,
  Wallet,
  Share2,
  Route,
  Network,
  ArrowLeftRight,
  Eye,
  Bell,
  ShieldCheck,
  FileText,
  ClipboardList,
  Bot,
  Settings,
  Plug,
  Menu,
  X,
  LogOut,
} from "lucide-react"
import useSWR from "swr"
import { BrandMark } from "@/components/brand"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/feedback"
import { useSession, useAlerts, apiPost, fetcher } from "@/lib/client/hooks"
import { cn } from "@/lib/utils"

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Investigations",
    items: [
      { href: "/cases", label: "Cases", icon: FolderKanban },
      { href: "/cases/new", label: "Create Investigation", icon: FilePlus2 },
      { href: "/wallet", label: "Wallet Investigation", icon: Wallet },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/graph", label: "Transaction Graph", icon: Share2 },
      { href: "/journey", label: "Fraud Journey", icon: Route },
      { href: "/network", label: "Network Intelligence", icon: Network },
      { href: "/crosschain", label: "CrossChain Radar", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { href: "/watchtower", label: "Watchtower", icon: Eye },
      { href: "/alerts", label: "Alert Center", icon: Bell },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/evidence", label: "Evidence Center", icon: ShieldCheck },
      { href: "/reports", label: "Reports", icon: FileText },
      { href: "/actionpack", label: "ActionPack", icon: ClipboardList },
    ],
  },
  { label: "Copilot", items: [{ href: "/assistant", label: "TRACE Assistant", icon: Bot }] },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/integrations", label: "API Integrations", icon: Plug },
    ],
  },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    if (!isLoading && !user) router.replace("/login")
  }, [isLoading, user, router])

  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Authenticating…
      </div>
    )
  }
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Redirecting to sign in…
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      {open ? (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
      ) : null}
      <Sidebar className={cn("lg:flex", open ? "flex" : "hidden")} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setOpen(true)} userName={user.name} userRole={user.role} />
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}

function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname()
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 w-64 shrink-0 flex-col overflow-y-auto scrollbar-thin border-r border-sidebar-border bg-sidebar lg:sticky lg:top-0 lg:h-screen",
        className,
      )}
    >
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <Link href="/dashboard">
          <BrandMark />
        </Link>
      </div>
      <nav className="flex-1 space-y-5 p-3">
        {NAV.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              {group.label}
            </p>
            {group.items.map((item) => {
              const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-4", active ? "text-primary" : "")} />
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <p className="px-1 text-[10px] leading-relaxed text-muted-foreground/70">
          Investigative decision-support. Attributions are probable unless independently verified. No automated legal
          action or asset freezing.
        </p>
      </div>
    </aside>
  )
}

function Topbar({
  onMenu,
  userName,
  userRole,
}: {
  onMenu: () => void
  userName: string
  userRole: string
}) {
  const router = useRouter()
  const { data } = useAlerts()
  const unack = data?.alerts.filter((a) => !a.acknowledged).length ?? 0
  const [signingOut, setSigningOut] = React.useState(false)

  const { data: integrations } = useSWR<{ chains: { chain: string }[]; liveConfiguredCount: number }>(
    "/api/integrations",
    fetcher,
    { revalidateOnFocus: false },
  )
  const liveCount = integrations?.liveConfiguredCount ?? 0
  const chainCount = integrations?.chains.length ?? 0
  const anyLive = liveCount > 0
  const statusLabel = !integrations
    ? "Checking provider status…"
    : anyLive
      ? `Live intelligence — ${liveCount}/${chainCount} chains connected`
      : "Demo mode — offline intelligence engines active"

  async function signOut() {
    setSigningOut(true)
    try {
      await apiPost("/api/auth/logout")
    } catch {
      /* ignore */
    }
    router.replace("/login")
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
      <button
        onClick={onMenu}
        className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </button>
      <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
        <span
          className="size-1.5 rounded-full"
          style={{ background: anyLive ? "var(--risk-low)" : "var(--demo)" }}
          aria-hidden="true"
        />
        {statusLabel}
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/alerts"
          className="relative flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
          aria-label={`Alerts (${unack} unacknowledged)`}
        >
          <Bell className="size-4" />
          {unack > 0 ? (
            <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unack}
            </span>
          ) : null}
        </Link>
        <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
          <div className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
            {userName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </div>
          <div className="hidden leading-tight sm:block">
            <p className="text-xs font-medium text-foreground">{userName}</p>
            <p className="text-[10px] text-muted-foreground">{userRole}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-destructive"
          aria-label="Sign out"
        >
          {signingOut ? <Spinner /> : <LogOut className="size-4" />}
        </button>
      </div>
    </header>
  )
}

export { X }
