"use client"

import useSWR from "swr"
import { Settings as SettingsIcon, ShieldCheck, UserCog, Scale, Check, X } from "lucide-react"
import { SectionHeading } from "@/components/intel/shared"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LoadingBlock } from "@/components/ui/feedback"
import { fetcher, useSession } from "@/lib/client/hooks"
import { PERMISSIONS } from "@/lib/auth"
import type { Role } from "@/lib/types"

interface DemoCred {
  email: string
  password: string
  role: string
}

const CAPABILITIES: { label: string; check: (r: Role) => boolean }[] = [
  { label: "View cases & intelligence", check: PERMISSIONS.view },
  { label: "Run multi-engine investigation", check: PERMISSIONS.runInvestigation },
  { label: "Acknowledge alerts", check: PERMISSIONS.acknowledgeAlert },
  { label: "Export reports", check: PERMISSIONS.exportReport },
  { label: "Create & edit cases", check: PERMISSIONS.createCase },
  { label: "Manage users", check: PERMISSIONS.manageUsers },
]

const ROLES: Role[] = ["VIEWER", "ANALYST", "INVESTIGATOR", "ADMIN"]

const LEGAL_NOTES = [
  "TRACECHAIN AI is investigative decision-support. It performs no automated legal action and freezes no assets.",
  "All exchange / VASP attributions are PROBABLE unless independently verified through licensed intelligence.",
  "Entity resolution links on-chain behavior only and never asserts a real-world legal identity without verified evidence.",
  "Fund DNA uses proportional (haircut) flow estimation; cryptocurrency fungibility prevents coin-level identification.",
  "No official NCRP or SAHYOG integration is claimed; connect real credentials before asserting any such integration.",
]

export default function SettingsPage() {
  const { user } = useSession()
  const { data } = useSWR<{ demoCredentials: DemoCred[] }>("/api/auth/login", fetcher, { revalidateOnFocus: false })

  if (!user) return <LoadingBlock label="Loading settings…" />

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeading
        title="Settings"
        description="Your session, role-based access control, seeded accounts, and the platform's legal & data-honesty posture."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="size-4 text-primary" /> Current session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <Row label="Name" value={user.name} />
            <Row label="Email" value={user.email} />
            <Row label="Role" value={<Badge variant="default">{user.role}</Badge>} />
            <Row label="Session" value={<Badge variant="muted">JWT · HS256</Badge>} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" /> Your capabilities
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {CAPABILITIES.map((c) => {
              const allowed = c.check(user.role)
              return (
                <div key={c.label} className="flex items-center justify-between text-xs">
                  <span className={allowed ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
                  {allowed ? (
                    <Check className="size-4 text-risk-low" />
                  ) : (
                    <X className="size-4 text-muted-foreground" />
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="size-4 text-primary" /> RBAC matrix
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Capability</th>
                  {ROLES.map((r) => (
                    <th key={r} className="px-2 py-2 text-center font-medium">
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CAPABILITIES.map((c) => (
                  <tr key={c.label} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-2 text-foreground">{c.label}</td>
                    {ROLES.map((r) => (
                      <td key={r} className="px-2 py-2 text-center">
                        {c.check(r) ? (
                          <Check className="mx-auto size-3.5 text-risk-low" />
                        ) : (
                          <X className="mx-auto size-3.5 text-muted-foreground/50" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seeded accounts (offline demo)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {(data?.demoCredentials ?? []).map((c) => (
            <div key={c.email} className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
              <span className="font-mono text-muted-foreground">{c.email}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-muted-foreground">{c.password}</span>
                <Badge variant="muted">{c.role}</Badge>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Passwords are seeded for the offline demo only and are not production credentials.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="size-4 text-primary" /> Legal & data-honesty posture
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {LEGAL_NOTES.map((n) => (
              <li key={n} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/70" />
                <span className="text-pretty">{n}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}
