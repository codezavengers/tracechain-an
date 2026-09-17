import type { VaspRecord } from "@/lib/types"

// VASP / exchange knowledge base.
// NOTE: This is a demo reference list of publicly-known service names used for
// ATTRIBUTION HEURISTICS ONLY. It does NOT assert that any specific on-chain
// address is owned or operated by these entities. Real attribution requires
// verified, licensed intelligence feeds.
export const VASP_KNOWLEDGE_BASE: VaspRecord[] = [
  {
    id: "vasp_binance",
    name: "Binance",
    type: "EXCHANGE",
    jurisdiction: "Global / Multiple",
    kycLevel: "HIGH",
    cooperationLevel: "MEDIUM",
    note: "Large global exchange. Demo reference only; no address ownership asserted.",
  },
  {
    id: "vasp_coinbase",
    name: "Coinbase",
    type: "EXCHANGE",
    jurisdiction: "United States",
    kycLevel: "HIGH",
    cooperationLevel: "HIGH",
    note: "US-regulated exchange with established LEA response process (public knowledge).",
  },
  {
    id: "vasp_kraken",
    name: "Kraken",
    type: "EXCHANGE",
    jurisdiction: "United States",
    kycLevel: "HIGH",
    cooperationLevel: "HIGH",
    note: "US-regulated exchange. Demo reference only.",
  },
  {
    id: "vasp_coindcx",
    name: "CoinDCX",
    type: "EXCHANGE",
    jurisdiction: "India",
    kycLevel: "HIGH",
    cooperationLevel: "MEDIUM",
    note: "India-based exchange. Relevant for domestic LEA coordination. Demo reference.",
  },
  {
    id: "vasp_wazirx",
    name: "WazirX",
    type: "EXCHANGE",
    jurisdiction: "India",
    kycLevel: "MEDIUM",
    cooperationLevel: "MEDIUM",
    note: "India-linked exchange. Demo reference only.",
  },
  {
    id: "vasp_kucoin",
    name: "KuCoin",
    type: "EXCHANGE",
    jurisdiction: "Seychelles / Global",
    kycLevel: "MEDIUM",
    cooperationLevel: "LOW",
    note: "Global exchange, historically lower KYC tiers. Demo reference.",
  },
  {
    id: "vasp_okx",
    name: "OKX",
    type: "EXCHANGE",
    jurisdiction: "Seychelles / Global",
    kycLevel: "MEDIUM",
    cooperationLevel: "LOW",
    note: "Global exchange. Demo reference only.",
  },
  {
    id: "vasp_htx",
    name: "HTX",
    type: "EXCHANGE",
    jurisdiction: "Seychelles / Global",
    kycLevel: "LOW",
    cooperationLevel: "LOW",
    note: "Global exchange. Demo reference only.",
  },
  {
    id: "bridge_generic",
    name: "Cross-Chain Bridge (unattributed)",
    type: "BRIDGE",
    jurisdiction: "Decentralized",
    kycLevel: "NONE",
    cooperationLevel: "UNKNOWN",
    note: "Generic bridge contract endpoint. Enables cross-chain movement; no KYC.",
  },
  {
    id: "mixer_generic",
    name: "Mixing Service (unattributed)",
    type: "MIXER",
    jurisdiction: "Decentralized",
    kycLevel: "NONE",
    cooperationLevel: "UNKNOWN",
    note: "Privacy/mixing pattern endpoint. High laundering-risk signal.",
  },
  {
    id: "defi_generic",
    name: "DeFi Protocol (unattributed)",
    type: "DEFI",
    jurisdiction: "Decentralized",
    kycLevel: "NONE",
    cooperationLevel: "UNKNOWN",
    note: "Smart-contract protocol interaction. No KYC.",
  },
]

export function getVaspById(id: string): VaspRecord | undefined {
  return VASP_KNOWLEDGE_BASE.find((v) => v.id === id)
}

export function listExchanges(): VaspRecord[] {
  return VASP_KNOWLEDGE_BASE.filter((v) => v.type === "EXCHANGE")
}
