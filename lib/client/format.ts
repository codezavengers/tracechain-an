import type { Chain, DataProvenance, RiskBand, CaseStatus, WalletKind } from "@/lib/types"

export function usd(n: number | undefined | null): string {
  const v = Number(n ?? 0)
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// Use this wherever a USD value can be genuinely unknown (no reliable price
// was available) rather than actually zero. `usd()` alone would render a
// null the same as $0, which forensically misrepresents "unpriced" as a
// verified zero-dollar movement.
export function usdOrUnknown(n: number | undefined | null): string {
  if (n === null || n === undefined) return "Unknown"
  return usd(n)
}

export function usdFull(n: number | undefined | null): string {
  return `$${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function pct(n: number | undefined | null): string {
  return `${Math.round(Number(n ?? 0) * 100)}%`
}

export function shortAddr(addr: string, head = 8, tail = 6): string {
  if (!addr) return ""
  if (addr.length <= head + tail + 3) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

export function relTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.round(hr / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export const CHAIN_LABEL: Record<Chain, string> = {
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  polygon: "Polygon",
  bsc: "BNB Chain",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  base: "Base",
  avalanche: "Avalanche",
  solana: "Solana",
  tron: "Tron",
}

export const CHAIN_TICKER: Record<Chain, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  polygon: "MATIC",
  bsc: "BNB",
  arbitrum: "ETH",
  optimism: "ETH",
  base: "ETH",
  avalanche: "AVAX",
  solana: "SOL",
  tron: "TRX",
}

export function riskColorVar(band: RiskBand): string {
  return {
    LOW: "var(--risk-low)",
    MEDIUM: "var(--risk-medium)",
    HIGH: "var(--risk-high)",
    CRITICAL: "var(--risk-critical)",
  }[band]
}

export function riskBandOf(score: number): RiskBand {
  if (score <= 30) return "LOW"
  if (score <= 60) return "MEDIUM"
  if (score <= 80) return "HIGH"
  return "CRITICAL"
}

export const PROVENANCE_LABEL: Record<DataProvenance, string> = {
  LIVE_BLOCKCHAIN_DATA: "Live blockchain",
  DEMO_DATA: "Demo data",
  KNOWN_ATTRIBUTION: "Known attribution",
  PROBABLE_ATTRIBUTION: "Probable attribution",
  HEURISTIC_ANALYSIS: "Heuristic analysis",
  ML_PREDICTION: "ML prediction",
  UNKNOWN: "Unknown",
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  NEW: "New",
  ANALYZING: "Analyzing",
  TRACING: "Tracing",
  VASP_IDENTIFIED: "VASP Identified",
  ACTION_REQUIRED: "Action Required",
  FREEZE_REVIEW: "Freeze Review",
  MONITORING: "Monitoring",
  CLOSED: "Closed",
}

export const WALLET_KIND_LABEL: Record<WalletKind, string> = {
  VICTIM: "Victim",
  SUSPICIOUS: "Suspicious",
  BURNER: "Burner",
  VASP: "VASP",
  EXCHANGE: "Exchange",
  BRIDGE: "Bridge",
  MIXER: "Mixer",
  DEFI: "DeFi",
  FRAUD_CLUSTER: "Fraud cluster",
  UNKNOWN: "Unknown",
}

export function humanize(s: string): string {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

export function titleFromTypology(t: string): string {
  return humanize(t)
}
