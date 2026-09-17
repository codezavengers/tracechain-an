import { describe, it, expect } from "vitest"
import { isVisibleToViewer } from "./types"

describe("isVisibleToViewer (ownership scoping)", () => {
  it("returns all records when no viewer is supplied (internal / demo-shared)", () => {
    expect(isVisibleToViewer(null, undefined)).toBe(true)
    expect(isVisibleToViewer("user-a", undefined)).toBe(true)
    expect(isVisibleToViewer("user-a", null)).toBe(true)
  })

  it("keeps unowned (seeded/shared demo) records visible to every viewer", () => {
    expect(isVisibleToViewer(null, "user-a")).toBe(true)
    expect(isVisibleToViewer(undefined, "user-b")).toBe(true)
  })

  it("shows an owned record only to its owner", () => {
    expect(isVisibleToViewer("user-a", "user-a")).toBe(true)
    expect(isVisibleToViewer("user-a", "user-b")).toBe(false)
  })
})
