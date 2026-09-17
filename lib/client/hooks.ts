"use client"

import useSWR from "swr"
import type {
  InvestigationCase,
  Alert,
  WatchedWallet,
  EvidenceRecord,
  SessionUser,
  TransactionGraph,
} from "@/lib/types"
import type { InvestigationResult } from "@/lib/engines"

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

export async function apiPost<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

export function useSession() {
  const { data, error, isLoading, mutate } = useSWR<{ user: SessionUser | null }>(
    "/api/auth/me",
    fetcher,
    { revalidateOnFocus: false },
  )
  return { user: data?.user ?? null, isLoading, error, mutate }
}

export interface DashboardData {
  stats: {
    totalCases: number
    activeInvestigations: number
    criticalAlerts: number
    unacknowledgedAlerts: number
    trackedWallets: number
    probableExitPoints: number
    connectedVictims: number
    highPriorityCases: number
    watchlistActivity: number
    totalReportedLossUsd: number
    totalTraceableUsd: number
  }
  riskDistribution: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number>
  recentCases: InvestigationCase[]
  recentAlerts: Alert[]
}

export function useDashboard() {
  return useSWR<DashboardData>("/api/dashboard", fetcher)
}

export function useCases() {
  return useSWR<{ cases: InvestigationCase[] }>("/api/cases", fetcher)
}

export function useAlerts() {
  return useSWR<{ alerts: Alert[] }>("/api/alerts", fetcher, { refreshInterval: 15000 })
}

export function useWatchlist() {
  return useSWR<{ watchlist: WatchedWallet[] }>("/api/watchlist", fetcher)
}

export function useEvidence(caseId?: string) {
  const key = caseId ? `/api/evidence?caseId=${encodeURIComponent(caseId)}` : "/api/evidence"
  return useSWR<{ records: EvidenceRecord[]; integrity: { valid: boolean; brokenAt?: string } }>(
    key,
    fetcher,
  )
}

export interface CaseDetailData {
  case: InvestigationCase
  investigation: InvestigationResult | null
  graph: TransactionGraph | null
}

export function useCaseDetail(id?: string) {
  return useSWR<CaseDetailData>(id ? `/api/cases/${encodeURIComponent(id)}` : null, fetcher)
}

export interface PersistenceInfo {
  mode: "IN_MEMORY" | "POSTGRES"
  label: string
  persistent: boolean
}

export function usePersistence() {
  return useSWR<PersistenceInfo>("/api/persistence", fetcher, { revalidateOnFocus: false })
}

export interface InvestigationEvent {
  id: string
  investigationId: string
  actor: string | null
  action: string
  detail: string
  metadata?: Record<string, unknown> | null
  createdAt: string
}

// Append-only investigation timeline / chain of custody (InvestigationEvent).
export function useInvestigationHistory(id?: string) {
  return useSWR<{ events: InvestigationEvent[]; persistenceMode: "IN_MEMORY" | "POSTGRES" }>(
    id ? `/api/investigations/${encodeURIComponent(id)}/history` : null,
    fetcher,
  )
}

export interface CaseSummaryData {
  investigationId: string
  complaint: { reference: string; text: string }
  targetWallet: string
  chain: string
  riskScore: number
  riskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  patterns: string[]
  findings: string[]
  evidenceCount: number
  traceSummary: string
  vaspAttribution: { address: string; category: string; vasp: string | null; inboundUsd: number }[]
  status: string
  hasInvestigation: boolean
  generatedAt: string
}

export function useCaseSummary(id?: string) {
  return useSWR<{ summary: CaseSummaryData }>(
    id ? `/api/cases/${encodeURIComponent(id)}/summary` : null,
    fetcher,
  )
}

export interface EvidenceVerificationResult {
  evidenceId: string
  caseId: string
  verification: {
    status: "VERIFIED" | "INTEGRITY_MISMATCH" | "CONTENT_UNAVAILABLE"
    storedHash: string
    recomputedHash: string | null
    message: string
  }
}
