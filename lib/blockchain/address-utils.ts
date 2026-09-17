import { createHash } from "node:crypto"
import type { Chain, AddressValidation, ChainDetectionResult } from "@/lib/types"

// Address pattern matchers per chain. These are structural validators
// (format + length + basic checksum-shape), not full on-chain checks.
const PATTERNS: Record<Chain, RegExp> = {
  // BTC: legacy (1...), P2SH (3...), bech32 (bc1...)
  bitcoin: /\b(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/,
  ethereum: /\b0x[a-fA-F0-9]{40}\b/,
  polygon: /\b0x[a-fA-F0-9]{40}\b/,
  bsc: /\b0x[a-fA-F0-9]{40}\b/,
  arbitrum: /\b0x[a-fA-F0-9]{40}\b/,
  optimism: /\b0x[a-fA-F0-9]{40}\b/,
  base: /\b0x[a-fA-F0-9]{40}\b/,
  avalanche: /\b0x[a-fA-F0-9]{40}\b/,
  solana: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/,
  // TRON base58, starts with T, length 34
  tron: /\bT[a-km-zA-HJ-NP-Z1-9]{33}\b/,
}

const EVM_CHAINS: Chain[] = ["ethereum", "polygon", "bsc", "arbitrum", "optimism", "base", "avalanche"]

// Detect which chains an address could belong to (structural).
export function detectChains(address: string): Chain[] {
  const trimmed = address.trim()
  const matches: Chain[] = []

  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    // EVM address: ambiguous across ETH/Polygon/BSC by design.
    return [...EVM_CHAINS]
  }
  if (/^T[a-km-zA-HJ-NP-Z1-9]{33}$/.test(trimmed)) {
    matches.push("tron")
  }
  if (
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed) &&
    !/^T[a-km-zA-HJ-NP-Z1-9]{33}$/.test(trimmed) &&
    !/^bc1[a-z0-9]{25,62}$/.test(trimmed) &&
    !/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)
  ) {
    matches.push("solana")
  }
  if (
    /^bc1[a-z0-9]{25,62}$/.test(trimmed) ||
    /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)
  ) {
    matches.push("bitcoin")
  }
  return matches
}

export function validateAddress(address: string, preferredChain?: Chain): AddressValidation {
  const trimmed = (address || "").trim()
  if (!trimmed) {
    return {
      address: trimmed,
      valid: false,
      chain: null,
      candidateChains: [],
      reason: "Empty address.",
    }
  }

  const candidates = detectChains(trimmed)
  if (candidates.length === 0) {
    return {
      address: trimmed,
      valid: false,
      chain: null,
      candidateChains: [],
      reason: "Address does not match any supported chain format (BTC / EVM / TRON).",
    }
  }

  let chain: Chain = candidates[0]
  if (preferredChain && candidates.includes(preferredChain)) {
    chain = preferredChain
  }

  const ambiguous = candidates.length > 1
  return {
    address: trimmed,
    valid: true,
    chain,
    candidateChains: candidates,
    reason: ambiguous
      ? `Valid EVM-format address. Network is ambiguous across ${candidates.join(", ")}; defaulting to ${chain}.`
      : `Valid ${chain} address format.`,
  }
}

// Extract candidate wallet addresses from free-form complaint text.
export function extractWalletsFromText(text: string): { address: string; chain: Chain }[] {
  if (!text) return []
  const found = new Map<string, Chain>()

  const scan = (chain: Chain) => {
    const re = new RegExp(PATTERNS[chain].source, "g")
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const candidate = m[0]
      const validation = validateAddress(candidate, chain)
      if (validation.valid && validation.chain) {
        // Prefer non-EVM specific detection; EVM stored once.
        if (!found.has(candidate)) {
          found.set(candidate, validation.chain)
        }
      }
    }
  }

  // Order matters: scan specific formats first.
  scan("bitcoin")
  scan("tron")
  scan("ethereum") // covers all EVM

  return Array.from(found.entries()).map(([address, chain]) => ({ address, chain }))
}

export function shortAddress(address: string, size = 6): string {
  if (!address) return ""
  if (address.length <= size * 2 + 2) return address
  return `${address.slice(0, size)}…${address.slice(-4)}`
}

// ---------------------------------------------------------------------------
// Tron hex <-> base58check address conversion.
//
// TronGrid's raw contract payloads (native TRX TransferContract) return
// owner/to addresses as 0x41-prefixed hex. Everywhere else in the app
// (validation, display, demo data) addresses are base58 ("T..."), so every
// TronProvider read must decode through this helper. No external dependency
// is needed — Tron addresses are standard base58check (double-SHA256
// checksum) over a 0x41 version byte.
// ---------------------------------------------------------------------------
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

function base58EncodeChecked(payload: Buffer): string {
  const hash1 = createHash("sha256").update(payload).digest()
  const hash2 = createHash("sha256").update(hash1).digest()
  const full = Buffer.concat([payload, hash2.subarray(0, 4)])

  let digits = [0]
  for (const byte of full) {
    let carry = byte
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  let leadingZeros = 0
  for (const byte of full) {
    if (byte === 0) leadingZeros++
    else break
  }

  return (
    BASE58_ALPHABET[0].repeat(leadingZeros) +
    digits
      .reverse()
      .map((d) => BASE58_ALPHABET[d])
      .join("")
  )
}

// Converts a TronGrid hex address (41-prefixed, optionally 0x-prefixed) to
// standard base58 ("T..."). Values that are already base58, empty, or
// malformed are returned unchanged so callers never crash on odd input.
export function tronHexToBase58(hexAddress: string | undefined | null): string {
  if (!hexAddress) return ""
  let hex = hexAddress.startsWith("0x") ? `41${hexAddress.slice(2)}` : hexAddress
  if (!/^41[0-9a-fA-F]{40}$/.test(hex)) return hexAddress
  try {
    return base58EncodeChecked(Buffer.from(hex, "hex"))
  } catch {
    return hexAddress
  }
}

// ---------------------------------------------------------------------------
// Phase 8 — chain detection. Structural format alone can never *prove* which
// EVM network a 0x-address lives on, so this returns a confidence-scored
// result the caller must respect: an ambiguous EVM address requires explicit
// user selection rather than a silent guess.
// ---------------------------------------------------------------------------
export function detectBlockchain(address: string): ChainDetectionResult {
  const trimmed = (address || "").trim()
  const candidates = detectChains(trimmed)

  if (candidates.length === 0) {
    return {
      address: trimmed,
      possibleChains: [],
      detectedChain: null,
      confidence: 0,
      method: "FORMAT",
      requiresUserSelection: false,
      reason: "Address does not match any supported chain format (BTC / EVM / TRON).",
    }
  }

  if (candidates.length === 1) {
    return {
      address: trimmed,
      possibleChains: candidates,
      detectedChain: candidates[0],
      confidence: 1,
      method: "FORMAT",
      requiresUserSelection: false,
      reason: `Address format is unique to ${candidates[0]}.`,
    }
  }

  // Ambiguous EVM-shaped address: format alone cannot distinguish
  // Ethereum / Polygon / BSC. Never claim a single chain with certainty here.
  return {
    address: trimmed,
    possibleChains: candidates,
    detectedChain: null,
    confidence: Math.round((1 / candidates.length) * 100) / 100,
    method: "FORMAT",
    requiresUserSelection: true,
    reason: `Address format (0x…) is shared by ${candidates.join(", ")}. Format alone cannot determine the network — select one or use provider probing.`,
  }
}

// Best-effort disambiguation for ambiguous EVM addresses: probes each
// candidate chain's live provider for on-chain activity (a tx or non-zero
// balance). If exactly one candidate shows activity, we can raise confidence
// and select it; otherwise the ambiguity is honestly preserved. `probe` is
// injected by the caller (service layer) to avoid a hard dependency here on
// the provider implementations, and to make this function trivially testable.
export async function detectBlockchainWithProbe(
  address: string,
  probe: (chain: Chain) => Promise<boolean>,
): Promise<ChainDetectionResult> {
  const base = detectBlockchain(address)
  if (!base.requiresUserSelection) return base

  const results = await Promise.all(
    base.possibleChains.map(async (chain) => ({ chain, active: await probe(chain).catch(() => false) })),
  )
  const active = results.filter((r) => r.active)

  if (active.length === 1) {
    return {
      ...base,
      detectedChain: active[0].chain,
      confidence: 0.85,
      method: "PROVIDER_PROBE",
      requiresUserSelection: false,
      reason: `On-chain activity was found on ${active[0].chain} but not on the other candidate chains (${base.possibleChains.filter((c) => c !== active[0].chain).join(", ")}).`,
    }
  }

  if (active.length > 1) {
    return {
      ...base,
      method: "PROVIDER_PROBE",
      reason: `On-chain activity was found on multiple candidate chains (${active.map((r) => r.chain).join(", ")}). Select the intended network.`,
    }
  }

  return {
    ...base,
    method: "PROVIDER_PROBE",
    reason: `No on-chain activity was found on any candidate chain (${base.possibleChains.join(", ")}). Select the intended network.`,
  }
}
