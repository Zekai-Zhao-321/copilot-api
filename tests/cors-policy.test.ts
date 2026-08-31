import { describe, expect, test } from "bun:test"

import {
  getConfiguredAllowedOrigins,
  isLoopbackOrigin,
  resolveCorsOrigin,
} from "~/lib/cors"

describe("isLoopbackOrigin", () => {
  test("accepts localhost, 127.0.0.0/8 and ::1", () => {
    expect(isLoopbackOrigin("http://localhost:4141")).toBe(true)
    expect(isLoopbackOrigin("http://127.0.0.1:4141")).toBe(true)
    expect(isLoopbackOrigin("http://127.5.6.7")).toBe(true)
    expect(isLoopbackOrigin("http://[::1]:4141")).toBe(true)
  })

  test("rejects non-loopback and malformed origins", () => {
    expect(isLoopbackOrigin("https://evil.example")).toBe(false)
    expect(isLoopbackOrigin("http://192.168.1.10:4141")).toBe(false)
    expect(isLoopbackOrigin("http://127evil.example")).toBe(false)
    expect(isLoopbackOrigin("not a url")).toBe(false)
    expect(isLoopbackOrigin("")).toBe(false)
  })
})

describe("resolveCorsOrigin", () => {
  test("echoes loopback origins", () => {
    expect(resolveCorsOrigin("http://localhost:4141", [])).toBe(
      "http://localhost:4141",
    )
  })

  test("denies a foreign origin (never returns '*')", () => {
    expect(resolveCorsOrigin("https://evil.example", [])).toBeNull()
  })

  test("denies requests with no Origin header", () => {
    expect(resolveCorsOrigin("", [])).toBeNull()
  })

  test("honors an explicit allowlist entry", () => {
    expect(
      resolveCorsOrigin("https://ui.corp.example", ["https://ui.corp.example"]),
    ).toBe("https://ui.corp.example")
    expect(
      resolveCorsOrigin("https://other.example", ["https://ui.corp.example"]),
    ).toBeNull()
  })

  test("supports an explicit wildcard opt-in", () => {
    expect(resolveCorsOrigin("https://anything.example", ["*"])).toBe(
      "https://anything.example",
    )
  })
})

describe("getConfiguredAllowedOrigins", () => {
  test("parses a comma-separated env var", () => {
    const prev = process.env.COPILOT_API_ALLOWED_ORIGINS
    process.env.COPILOT_API_ALLOWED_ORIGINS =
      "https://a.example, https://b.example ,"
    try {
      expect(getConfiguredAllowedOrigins()).toEqual([
        "https://a.example",
        "https://b.example",
      ])
    } finally {
      if (prev === undefined) delete process.env.COPILOT_API_ALLOWED_ORIGINS
      else process.env.COPILOT_API_ALLOWED_ORIGINS = prev
    }
  })

  test("returns an empty list when unset", () => {
    const prev = process.env.COPILOT_API_ALLOWED_ORIGINS
    delete process.env.COPILOT_API_ALLOWED_ORIGINS
    try {
      expect(getConfiguredAllowedOrigins()).toEqual([])
    } finally {
      if (prev !== undefined) process.env.COPILOT_API_ALLOWED_ORIGINS = prev
    }
  })
})
