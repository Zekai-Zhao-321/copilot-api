import { afterEach, describe, expect, mock, test } from "bun:test"

// Mock the config-backed API-key lookup so the guard can be tested in isolation.
let mockApiKeys: Array<string> = []
await mock.module("~/lib/request-auth", () => ({
  getConfiguredApiKeys: () => mockApiKeys,
}))

const { assertSafeBindPosture, isLoopbackHost, resolveBindHost } = await import(
  "~/lib/bind-guard"
)

afterEach(() => {
  mockApiKeys = []
  delete process.env.HOST
})

describe("isLoopbackHost", () => {
  test("recognizes loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true)
    expect(isLoopbackHost("localhost")).toBe(true)
    expect(isLoopbackHost("::1")).toBe(true)
    expect(isLoopbackHost("[::1]")).toBe(true)
    expect(isLoopbackHost("127.9.9.9")).toBe(true)
  })

  test("recognizes exposed hosts", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false)
    expect(isLoopbackHost("::")).toBe(false)
    expect(isLoopbackHost("192.168.1.5")).toBe(false)
  })
})

describe("resolveBindHost", () => {
  test("defaults to loopback", () => {
    delete process.env.HOST
    expect(resolveBindHost(undefined)).toBe("127.0.0.1")
  })

  test("prefers the explicit flag over HOST env", () => {
    process.env.HOST = "0.0.0.0"
    expect(resolveBindHost("127.0.0.1")).toBe("127.0.0.1")
  })

  test("falls back to HOST env when no flag is given", () => {
    process.env.HOST = "0.0.0.0"
    expect(resolveBindHost(undefined)).toBe("0.0.0.0")
  })
})

describe("assertSafeBindPosture", () => {
  test("allows loopback with no keys", () => {
    mockApiKeys = []
    expect(() => assertSafeBindPosture("127.0.0.1", false)).not.toThrow()
  })

  test("throws when exposing a non-loopback host with no keys", () => {
    mockApiKeys = []
    expect(() => assertSafeBindPosture("0.0.0.0", false)).toThrow(
      /Refusing to bind/u,
    )
  })

  test("allows a non-loopback host when API keys are configured", () => {
    mockApiKeys = ["secret-key"]
    expect(() => assertSafeBindPosture("0.0.0.0", false)).not.toThrow()
  })

  test("allows a non-loopback host with the explicit override", () => {
    mockApiKeys = []
    expect(() => assertSafeBindPosture("0.0.0.0", true)).not.toThrow()
  })
})
