"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ArrowRight, ShieldCheck, Lock } from "lucide-react"
import { BrandMark } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input, Label } from "@/components/ui/field"
import { Spinner, ErrorState } from "@/components/ui/feedback"
import { Badge } from "@/components/ui/badge"
import { fetcher, apiPost, useSession } from "@/lib/client/hooks"
import type { SessionUser } from "@/lib/types"

interface DemoCred {
  email: string
  password: string
  role: string
}

export default function LoginPage() {
  const router = useRouter()
  const { user, mutate } = useSession()
  const { data } = useSWR<{ demoCredentials: DemoCred[] }>("/api/auth/login", fetcher, {
    revalidateOnFocus: false,
  })
  const [email, setEmail] = React.useState("investigator@tracechain.gov")
  const [password, setPassword] = React.useState("Invest@123")
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (user) router.replace("/dashboard")
  }, [user, router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await apiPost<{ user: SessionUser }>("/api/auth/login", { email, password })
      await mutate()
      router.replace("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.")
      setSubmitting(false)
    }
  }

  function useCred(c: DemoCred) {
    setEmail(c.email)
    setPassword(c.password)
    setError(null)
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand / mission panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-sidebar p-10 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--muted-foreground) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
          aria-hidden="true"
        />
        <BrandMark />
        <div className="relative z-10 max-w-md space-y-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">SIH26183</p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-balance">
            Real-time cryptocurrency fraud attribution, investigation & fund-recovery intelligence.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Trace victim-reported wallets across chains, expose burner networks and laundering patterns, attribute
            probable exit points, and assemble investigator-ready action packages — with full data-honesty labelling.
          </p>
          <div className="flex flex-wrap gap-2">
            {["EXITPOINT AI", "FUND DNA", "LAUNDERING RADAR", "RECOVER AI", "CHAIN OF EVIDENCE"].map((m) => (
              <Badge key={m} variant="outline" className="text-muted-foreground">
                {m}
              </Badge>
            ))}
          </div>
        </div>
        <p className="relative z-10 text-lg font-medium tracking-tight text-foreground">
          Follow the money. <span className="text-primary">Find the exit.</span>
        </p>
      </div>

      {/* Sign-in form */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 lg:hidden">
            <BrandMark />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Sign in to the console</h2>
            <p className="text-sm text-muted-foreground">Authenticate to access investigation intelligence.</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? <ErrorState message={error} /> : null}
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting ? <Spinner className="text-primary-foreground" /> : <Lock className="size-4" />}
              {submitting ? "Signing in…" : "Sign in"}
              {!submitting ? <ArrowRight className="size-4" /> : null}
            </Button>
          </form>

          <Card className="bg-card/60">
            <CardContent className="space-y-2 p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ShieldCheck className="size-3" /> Demo credentials (RBAC roles)
              </p>
              <div className="space-y-1">
                {(data?.demoCredentials ?? []).map((c) => (
                  <button
                    key={c.email}
                    type="button"
                    onClick={() => useCred(c)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-left text-xs hover:border-primary/40"
                  >
                    <span className="font-mono text-foreground/80">{c.email}</span>
                    <Badge variant="muted">{c.role}</Badge>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Click a role to auto-fill. Passwords are seeded for this offline demo only.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
