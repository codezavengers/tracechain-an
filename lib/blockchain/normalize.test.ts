import { describe, it, expect } from "vitest"
import {
  normalizeNative,
  normalizeToken,
  baseUnitsToDecimal,
  directionOf,
  applyInvestigationFilters,
  parseDateBounds,
  parseDateBoundary,
  parseBlockHeight,
  classifyTimestamp,
} from "./normalize"
import type { Transaction } from "@/lib/types"

describe("baseUnitsToDecimal", () => {
  it("converts wei-style base units to a decimal amount", () => {
    expect(baseUnitsToDecimal("1000000000000000000", 18)).toBeCloseTo(1, 6)
  })
  it("handles zero/undefined input without throwing", () => {
    expect(baseUnitsToDecimal(undefined, 18)).toBe(0)
    expect(baseUnitsToDecimal("", 6)).toBe(0)
  })
  it("supports hex-prefixed input (EVM RPC values)", () => {
    expect(baseUnitsToDecimal("0xde0b6b3a7640000", 18)).toBeCloseTo(1, 6)
  })
})

describe("directionOf", () => {
  it("returns in when the reference address is the recipient", () => {
    expect(directionOf("0xabc", "0xdef", "0xABC")).toBe("in")
  })
  it("returns out when the reference address is the sender", () => {
    expect(directionOf("0xabc", "0xABC", "0xdef")).toBe("out")
  })
  it("returns undefined without a reference address", () => {
    expect(directionOf(undefined, "0xabc", "0xdef")).toBeUndefined()
  })
})

describe("normalizeNative / normalizeToken", () => {
  it("marks native transfers with transferType NATIVE and null tokenAddress", () => {
    const tx = normalizeNative({
      hash: "0x1",
      chain: "ethereum",
      from: "0xa",
      to: "0xb",
      amount: 1,
      asset: "ETH",
      timestamp: "2024-01-01T00:00:00.000Z",
      blockHeight: 100,
    })
    expect(tx.transferType).toBe("NATIVE")
    expect(tx.tokenAddress).toBeNull()
    expect(tx.usdValue).toBeNull()
    expect(tx.priceDataSource).toBe("UNAVAILABLE")
  })

  it("marks token transfers with transferType TOKEN and the contract address", () => {
    const tx = normalizeToken({
      hash: "0x2",
      chain: "ethereum",
      from: "0xa",
      to: "0xb",
      amount: 5,
      asset: "USDT",
      tokenAddress: "0xdac17f958d2ee523a2206206994597c13d831ec",
      timestamp: "2024-01-01T00:00:00.000Z",
      blockHeight: 101,
    })
    expect(tx.transferType).toBe("TOKEN")
    expect(tx.tokenAddress).toBe("0xdac17f958d2ee523a2206206994597c13d831ec")
  })

  it("never fabricates a timestamp — passes null through untouched", () => {
    const tx = normalizeNative({
      hash: "0x3",
      chain: "ethereum",
      from: "0xa",
      to: "0xb",
      amount: 1,
      asset: "ETH",
      timestamp: null,
      blockHeight: 102,
    })
    expect(tx.timestamp).toBeNull()
  })
})

describe("applyInvestigationFilters", () => {
  const baseTx: Transaction = {
    hash: "h",
    chain: "ethereum",
    from: "a",
    to: "b",
    amount: 1,
    asset: "ETH",
    usdValue: null,
    timestamp: "2024-06-01T00:00:00.000Z",
    blockHeight: 1,
    provenance: "LIVE_BLOCKCHAIN_DATA",
  }

  it("truncates to the investigation cap and reports truncated=true", () => {
    const txs = Array.from({ length: 10 }, (_, i) => ({ ...baseTx, hash: `h${i}` }))
    const { transactions, truncated } = applyInvestigationFilters(txs, { maxTransactions: 5 })
    expect(transactions).toHaveLength(5)
    expect(truncated).toBe(true)
  })

  it("keeps rows with a null timestamp rather than dropping them", () => {
    const txs = [{ ...baseTx, timestamp: null }]
    const { transactions } = applyInvestigationFilters(txs, { startDate: "2024-01-01", endDate: "2024-12-31" })
    expect(transactions).toHaveLength(1)
  })

  it("filters by date range when timestamps are present", () => {
    const txs = [
      { ...baseTx, hash: "old", timestamp: "2023-01-01T00:00:00.000Z" },
      { ...baseTx, hash: "new", timestamp: "2024-06-01T00:00:00.000Z" },
    ]
    const { transactions } = applyInvestigationFilters(txs, { startDate: "2024-01-01" })
    expect(transactions.map((t) => t.hash)).toEqual(["new"])
  })
})

describe("parseDateBounds", () => {
  it("expands a date-only start to the beginning of that day and end to the end of that day", () => {
    const b = parseDateBounds({ startDate: "2024-01-01", endDate: "2024-12-31" })
    expect(b.start).toBe(Date.parse("2024-01-01T00:00:00.000Z"))
    expect(b.end).toBe(Date.parse("2024-12-31T23:59:59.999Z"))
  })
  it("ignores absent bounds", () => {
    expect(parseDateBounds({})).toEqual({ start: undefined, end: undefined })
  })
  it("treats an unparseable date as no bound rather than excluding everything", () => {
    const b = parseDateBounds({ startDate: "not-a-date" })
    expect(b.start).toBeUndefined()
  })
})

describe("parseDateBoundary — date-only vs full-timestamp semantics", () => {
  it("date-only start means the very start of that day (00:00:00.000)", () => {
    expect(parseDateBoundary("2026-09-01", "start")).toBe(Date.parse("2026-09-01T00:00:00.000Z"))
  })
  it("date-only end includes the ENTIRE day through 23:59:59.999", () => {
    expect(parseDateBoundary("2026-09-06", "end")).toBe(Date.parse("2026-09-06T23:59:59.999Z"))
  })
  it("a full timestamp start is used exactly, with no day expansion", () => {
    expect(parseDateBoundary("2026-09-06T14:30:00Z", "start")).toBe(Date.parse("2026-09-06T14:30:00Z"))
  })
  it("a full timestamp end is used exactly, with no day expansion", () => {
    expect(parseDateBoundary("2026-09-06T14:30:00Z", "end")).toBe(Date.parse("2026-09-06T14:30:00Z"))
  })
  it("a same-day date-only range covers the whole calendar day", () => {
    const { start, end } = parseDateBounds({ startDate: "2026-09-06", endDate: "2026-09-06" })
    expect(start).toBe(Date.parse("2026-09-06T00:00:00.000Z"))
    expect(end).toBe(Date.parse("2026-09-06T23:59:59.999Z"))
    // A transaction late in the day must fall inside the window.
    expect(classifyTimestamp("2026-09-06T23:45:00Z", { start, end })).toBe("in")
  })
  it("invalid dates become 'no bound' (undefined)", () => {
    expect(parseDateBoundary("not-a-date", "start")).toBeUndefined()
    expect(parseDateBoundary("2026-13-40", "end")).toBeUndefined()
    expect(parseDateBoundary(undefined, "start")).toBeUndefined()
  })
  it("a date-only endDate keeps a same-day transaction that a naive midnight bound would drop", () => {
    // Regression: endDate "2024-06-01" must include 2024-06-01T18:00:00Z.
    const { transactions } = applyInvestigationFilters(
      [
        {
          hash: "sameday",
          chain: "ethereum",
          from: "a",
          to: "b",
          amount: 1,
          asset: "ETH",
          usdValue: null,
          timestamp: "2024-06-01T18:00:00.000Z",
          blockHeight: 1,
          provenance: "LIVE_BLOCKCHAIN_DATA",
        },
      ],
      { endDate: "2024-06-01" },
    )
    expect(transactions.map((t) => t.hash)).toEqual(["sameday"])
  })
})

describe("parseBlockHeight", () => {
  it("parses a decimal string block number", () => {
    expect(parseBlockHeight("123456")).toBe(123456)
  })
  it("parses a hex-prefixed block number (EVM RPC)", () => {
    expect(parseBlockHeight("0x64")).toBe(100)
  })
  it("keeps a genuine block 0", () => {
    expect(parseBlockHeight("0")).toBe(0)
    expect(parseBlockHeight(0)).toBe(0)
  })
  it("returns null (never NaN/0) for missing or malformed block numbers", () => {
    expect(parseBlockHeight(undefined)).toBeNull()
    expect(parseBlockHeight(null)).toBeNull()
    expect(parseBlockHeight("")).toBeNull()
    expect(parseBlockHeight("not-a-number")).toBeNull()
    expect(parseBlockHeight("12.5")).toBeNull()
    expect(parseBlockHeight(Number.NaN)).toBeNull()
  })
})

describe("classifyTimestamp", () => {
  const bounds = parseDateBounds({ startDate: "2024-01-01T00:00:00.000Z", endDate: "2024-12-31T23:59:59.000Z" })

  it("classifies an in-range timestamp as 'in' (bounds inclusive)", () => {
    expect(classifyTimestamp("2024-01-01T00:00:00.000Z", bounds)).toBe("in")
    expect(classifyTimestamp("2024-06-01T00:00:00.000Z", bounds)).toBe("in")
  })
  it("classifies a too-new timestamp as 'after'", () => {
    expect(classifyTimestamp("2025-01-01T00:00:00.000Z", bounds)).toBe("after")
  })
  it("classifies a too-old timestamp as 'before'", () => {
    expect(classifyTimestamp("2023-12-31T00:00:00.000Z", bounds)).toBe("before")
  })
  it("keeps null / unparseable timestamps ('in') rather than dropping them", () => {
    expect(classifyTimestamp(null, bounds)).toBe("in")
    expect(classifyTimestamp("garbage", bounds)).toBe("in")
  })
})
