import { describe, it, expect } from "vitest"
import {
  validateAddress,
  detectChains,
  detectBlockchain,
  detectBlockchainWithProbe,
  tronHexToBase58,
  extractWalletsFromText,
} from "./address-utils"

describe("detectChains / validateAddress", () => {
  it("treats a bare 0x-address as ambiguous across every EVM chain", () => {
    const candidates = detectChains("0x000000000000000000000000000000000000dEaD")
    expect(candidates).toEqual(["ethereum", "polygon", "bsc", "arbitrum", "optimism", "base", "avalanche"])
  })

  it("never silently claims a single EVM chain — validateAddress flags the ambiguity", () => {
    const result = validateAddress("0x000000000000000000000000000000000000dEaD")
    expect(result.valid).toBe(true)
    expect(result.candidateChains.length).toBeGreaterThan(1)
    expect(result.reason).toMatch(/ambiguous/i)
  })

  it("uniquely identifies a Tron address", () => {
    const result = validateAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
    expect(result.chain).toBe("tron")
    expect(result.candidateChains).toEqual(["tron"])
  })

  it("rejects malformed addresses", () => {
    const result = validateAddress("not-a-wallet")
    expect(result.valid).toBe(false)
    expect(result.chain).toBeNull()
  })
})

describe("detectBlockchain", () => {
  it("returns confidence 1 and no user-selection requirement for a unique format", () => {
    const result = detectBlockchain("1BitcoinEaterAddressDontSendf59kuE")
    expect(result.detectedChain).toBe("bitcoin")
    expect(result.confidence).toBe(1)
    expect(result.requiresUserSelection).toBe(false)
    expect(result.method).toBe("FORMAT")
  })

  it("requires user selection for an ambiguous EVM address and never guesses a chain", () => {
    const result = detectBlockchain("0x000000000000000000000000000000000000dEaD")
    expect(result.detectedChain).toBeNull()
    expect(result.requiresUserSelection).toBe(true)
    expect(result.possibleChains).toEqual(["ethereum", "polygon", "bsc", "arbitrum", "optimism", "base", "avalanche"])
  })

  it("returns zero confidence and no possible chains for garbage input", () => {
    const result = detectBlockchain("garbage")
    expect(result.possibleChains).toEqual([])
    expect(result.confidence).toBe(0)
  })
})

describe("detectBlockchainWithProbe", () => {
  it("resolves ambiguity when exactly one candidate chain shows on-chain activity", async () => {
    const result = await detectBlockchainWithProbe("0x000000000000000000000000000000000000dEaD", async (chain) => chain === "polygon")
    expect(result.detectedChain).toBe("polygon")
    expect(result.requiresUserSelection).toBe(false)
    expect(result.method).toBe("PROVIDER_PROBE")
  })

  it("keeps the ambiguity honest when no candidate chain shows activity", async () => {
    const result = await detectBlockchainWithProbe("0x000000000000000000000000000000000000dEaD", async () => false)
    expect(result.detectedChain).toBeNull()
    expect(result.requiresUserSelection).toBe(true)
  })

  it("keeps the ambiguity honest when multiple candidate chains show activity", async () => {
    const result = await detectBlockchainWithProbe("0x000000000000000000000000000000000000dEaD", async () => true)
    expect(result.detectedChain).toBeNull()
    expect(result.requiresUserSelection).toBe(true)
  })
})

describe("tronHexToBase58", () => {
  it("converts a 41-prefixed hex address to the expected base58 form", () => {
    // USDT (TRC-20) contract address, a well-known fixed mapping.
    const hex = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c"
    expect(tronHexToBase58(hex)).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
  })

  it("returns the input unchanged when it is not a recognizable hex address", () => {
    expect(tronHexToBase58("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
    expect(tronHexToBase58("")).toBe("")
    expect(tronHexToBase58(null)).toBe("")
  })
})

describe("extractWalletsFromText", () => {
  it("extracts a mix of chain-specific addresses from free text", () => {
    const text = "Funds moved to 1BitcoinEaterAddressDontSendf59kuE then to TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t."
    const wallets = extractWalletsFromText(text)
    const chains = wallets.map((w) => w.chain).sort()
    expect(chains).toEqual(["bitcoin", "tron"])
  })

  it("returns an empty array for text with no addresses", () => {
    expect(extractWalletsFromText("no wallets here")).toEqual([])
  })
})
