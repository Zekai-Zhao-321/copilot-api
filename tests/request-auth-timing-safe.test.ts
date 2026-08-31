import { describe, expect, test } from "bun:test"

import { matchesAnyApiKey } from "~/lib/request-auth"

describe("matchesAnyApiKey (constant-time key comparison)", () => {
  test("matches a configured key", () => {
    expect(matchesAnyApiKey("abc123", ["abc123", "other"])).toBe(true)
  })

  test("rejects an unknown key", () => {
    expect(matchesAnyApiKey("nope", ["abc123", "other"])).toBe(false)
  })

  test("rejects when no keys are configured", () => {
    expect(matchesAnyApiKey("abc123", [])).toBe(false)
  })

  test("rejects a prefix of a valid key (length mismatch handled)", () => {
    expect(matchesAnyApiKey("abc", ["abc123"])).toBe(false)
  })

  test("rejects an empty candidate", () => {
    expect(matchesAnyApiKey("", ["abc123"])).toBe(false)
  })

  test("matches the second key in the list", () => {
    expect(matchesAnyApiKey("second", ["first", "second"])).toBe(true)
  })
})
