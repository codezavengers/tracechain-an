import type { Chain } from "@/lib/types"

// Central, server-only configuration for live providers — RAW-RPC-FIRST
// architecture. API keys/secrets are read from environment variables and
// NEVER shipped to the client or embedded in code.
//
// Deliberately, NO adapter in this codebase ever calls a third-party block
// explorer or indexer API (Etherscan, Blockscout, Routescan, Blockstream,
// mempool.space, etc.). Every live value comes from one of two sources:
//   - RAW_RPC: a direct JSON-RPC call to a chain node (eth_getBalance,
//     eth_getLogs, getrawtransaction, ...).
//   - LIVE_NATIVE_API: a chain's own official network gateway — currently
//     only TronGrid, TRON's own full-node HTTP API (network infrastructure
//     the TRON protocol itself is built on, not a third-party explorer).
//
// What this means per chain:
//   - EVM chains (Ethereum/Polygon/BSC/Arbitrum/Optimism/Base/Avalanche):
//     LIVE by default via free, keyless public JSON-RPC endpoints
//     (publicnode.com). Transaction/token-transfer HISTORY is obtained via a
//     bounded eth_getBlockByNumber / eth_getLogs scan over recent blocks —
//     see providers/evm.ts — never via an indexer. Set a dedicated
//     <CHAIN>_RPC_URL to point at your own node or a paid RPC provider
//     (Alchemy/Infura-style URLs, which are still raw JSON-RPC, work fine).
//   - Bitcoin: requires a REAL Bitcoin Core node's RPC endpoint
//     (BITCOIN_RPC_URL, optionally BITCOIN_RPC_USER/BITCOIN_RPC_PASSWORD, or
//     credentials embedded directly in the URL). There is no free public
//     Bitcoin RPC endpoint, so Bitcoin is genuinely NOT live until an
//     operator points this at a node they run or a hosted node provider.
//   - Solana: LIVE by default via the public, keyless mainnet-beta JSON-RPC
//     — Solana's own native RPC protocol.
//   - TRON: LIVE by default via TronGrid's public, keyless HTTP API.

export const EVM_CHAIN_ID: Partial<Record<Chain, number>> = {
  ethereum: 1,
  polygon: 137,
  bsc: 56,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  avalanche: 43114,
}

export const NATIVE_ASSET: Record<Chain, string> = {
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

// Env var names surfaced (names only, never values) on the Integrations page.
export const ENV_VARS: Record<Chain, { url: string; key: string }> = {
  ethereum: { url: "ETHEREUM_RPC_URL", key: "TRACECHAIN_ETH_API_KEY" },
  polygon: { url: "POLYGON_RPC_URL", key: "TRACECHAIN_POLYGON_API_KEY" },
  bsc: { url: "BSC_RPC_URL", key: "TRACECHAIN_BSC_API_KEY" },
  arbitrum: { url: "ARBITRUM_RPC_URL", key: "TRACECHAIN_ARBITRUM_API_KEY" },
  optimism: { url: "OPTIMISM_RPC_URL", key: "TRACECHAIN_OPTIMISM_API_KEY" },
  base: { url: "BASE_RPC_URL", key: "TRACECHAIN_BASE_API_KEY" },
  avalanche: { url: "AVALANCHE_RPC_URL", key: "TRACECHAIN_AVALANCHE_API_KEY" },
  bitcoin: { url: "BITCOIN_RPC_URL", key: "BITCOIN_RPC_PASSWORD" },
  solana: { url: "SOLANA_RPC_URL", key: "TRACECHAIN_SOLANA_RPC_KEY" },
  tron: { url: "TRON_RPC_URL", key: "TRACECHAIN_TRON_API_KEY" },
}

// Dedicated per-chain RPC URL overrides for EVM chains.
const EVM_RPC_ENV: Partial<Record<Chain, string>> = {
  ethereum: "ETHEREUM_RPC_URL",
  polygon: "POLYGON_RPC_URL",
  bsc: "BSC_RPC_URL",
  arbitrum: "ARBITRUM_RPC_URL",
  optimism: "OPTIMISM_RPC_URL",
  base: "BASE_RPC_URL",
  avalanche: "AVALANCHE_RPC_URL",
}

// Free, keyless, public JSON-RPC endpoints used for every EVM chain by
// default (RAW_RPC — direct node access, no indexer involved).
const PUBLIC_RPC: Partial<Record<Chain, string>> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
  arbitrum: "https://arbitrum-one-rpc.publicnode.com",
  optimism: "https://optimism-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com",
  avalanche: "https://avalanche-c-chain-rpc.publicnode.com",
}

const TRONGRID_BASE = "https://api.trongrid.io"
const SOLANA_RPC_BASE = "https://api.mainnet-beta.solana.com"

export interface ChainConfig {
  chain: Chain
  // Resolved base URL used by the adapter (a JSON-RPC endpoint, or TronGrid's
  // HTTP API base for TRON).
  baseUrl: string
  // Server-side secret (RPC password / API key). May be empty for keyless
  // public endpoints. Never logged or sent to the client.
  apiKey: string
  // Bitcoin RPC basic-auth username, when set separately from the URL.
  rpcUser?: string
  // For EVM chains: the numeric chain id (informational only now — no V2
  // unified-API endpoint is used, but kept for callers that key caches on it).
  chainId?: number
  // Whether a live fetch is possible for this chain right now.
  configured: boolean
  // "rpc" -> direct JSON-RPC to a chain node, "native_api" -> a chain's own
  // official network gateway (TronGrid), "none" -> nothing configured.
  kind: "rpc" | "native_api" | "none"
  // Whether this chain's OWN dedicated override env vars are set — distinct
  // from `configured` (also true for the free public RPC fallback with no
  // env vars set at all). Used only for the Integrations page's "is this
  // specific variable set" display, never for live-capability logic.
  envUrlSet: boolean
  envKeySet: boolean
}

function env(name: string): string {
  return (process.env[name] ?? "").trim()
}

export function getChainConfig(chain: Chain): ChainConfig {
  if (chain === "bitcoin") {
    // No free public Bitcoin RPC endpoint exists — this genuinely requires
    // an operator-run or hosted Bitcoin Core node.
    const url = env("BITCOIN_RPC_URL")
    const user = env("BITCOIN_RPC_USER")
    const pass = env("BITCOIN_RPC_PASSWORD")
    return {
      chain,
      baseUrl: url,
      apiKey: pass,
      rpcUser: user || undefined,
      configured: Boolean(url),
      kind: url ? "rpc" : "none",
      envUrlSet: Boolean(url),
      envKeySet: Boolean(pass),
    }
  }

  const chainId = EVM_CHAIN_ID[chain]
  if (chainId) {
    const dedicatedRpcVar = EVM_RPC_ENV[chain]
    const dedicatedRpc = dedicatedRpcVar ? env(dedicatedRpcVar) : ""
    const rpcUrl = dedicatedRpc || PUBLIC_RPC[chain] || ""
    return {
      chain,
      baseUrl: rpcUrl,
      apiKey: "",
      chainId,
      configured: Boolean(rpcUrl),
      kind: rpcUrl ? "rpc" : "none",
      envUrlSet: Boolean(dedicatedRpc),
      envKeySet: false,
    }
  }

  if (chain === "solana") {
    const url = env("SOLANA_RPC_URL")
    return {
      chain,
      baseUrl: url || SOLANA_RPC_BASE,
      apiKey: "",
      configured: true,
      kind: "rpc",
      envUrlSet: Boolean(url),
      envKeySet: false,
    }
  }

  if (chain === "tron") {
    // TronGrid's public HTTP API is free and keyless — TRON is LIVE by
    // default. TRACECHAIN_TRON_API_KEY is an optional upgrade for a higher
    // rate limit, never a requirement to go live.
    const url = env("TRON_RPC_URL")
    const key = env("TRACECHAIN_TRON_API_KEY")
    return {
      chain,
      baseUrl: url || TRONGRID_BASE,
      apiKey: key,
      configured: true,
      kind: "native_api",
      envUrlSet: Boolean(url),
      envKeySet: Boolean(key),
    }
  }

  return {
    chain,
    baseUrl: "",
    apiKey: "",
    configured: false,
    kind: "none",
    envUrlSet: false,
    envKeySet: false,
  }
}

export function isLiveCapable(chain: Chain): boolean {
  return getChainConfig(chain).configured
}
