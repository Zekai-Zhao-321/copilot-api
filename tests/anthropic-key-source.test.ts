import { afterEach, describe, expect, mock, test } from "bun:test"

// Isolate getAnthropicApiKey from the on-disk config.
let mockConfig: { anthropicApiKey?: string } = {}
await mock.module("~/lib/config", () => ({
  getConfig: () => mockConfig,
}))

const { getAnthropicApiKey } = await import("~/lib/config-store")

const ENV = "ANTHROPIC_API_KEY"
const original = process.env[ENV]

afterEach(() => {
  mockConfig = {}
  if (original === undefined) delete process.env[ENV]
  else process.env[ENV] = original
})

describe("getAnthropicApiKey", () => {
  test("returns the key from config", () => {
    mockConfig = { anthropicApiKey: "from-config" }
    expect(getAnthropicApiKey()).toBe("from-config")
  })

  test("does NOT fall back to the ambient ANTHROPIC_API_KEY env var", () => {
    mockConfig = {}
    process.env[ENV] = "from-ambient-env"
    // The whole point: an ambient env var must not silently enable forwarding
    // full prompt payloads to api.anthropic.com for token counting.
    expect(getAnthropicApiKey()).toBeUndefined()
  })

  test("returns undefined when neither is set", () => {
    mockConfig = {}
    delete process.env[ENV]
    expect(getAnthropicApiKey()).toBeUndefined()
  })
})
