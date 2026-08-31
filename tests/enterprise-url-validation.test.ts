import { afterEach, describe, expect, test } from "bun:test"

import {
  getEnterpriseDomain,
  getGitHubApiBaseUrl,
  getGitHubBaseUrl,
} from "~/lib/api-config"

const ENV = "COPILOT_API_ENTERPRISE_URL"
const original = process.env[ENV]

afterEach(() => {
  if (original === undefined) delete process.env[ENV]
  else process.env[ENV] = original
})

describe("getEnterpriseDomain validation", () => {
  test("returns null when unset", () => {
    delete process.env[ENV]
    expect(getEnterpriseDomain()).toBeNull()
  })

  test("accepts a bare host", () => {
    process.env[ENV] = "github.corp.example"
    expect(getEnterpriseDomain()).toBe("github.corp.example")
  })

  test("accepts a host with a scheme and trailing slash", () => {
    process.env[ENV] = "https://github.corp.example/"
    expect(getEnterpriseDomain()).toBe("github.corp.example")
  })

  test("accepts a host:port", () => {
    process.env[ENV] = "github.corp.example:8443"
    expect(getEnterpriseDomain()).toBe("github.corp.example:8443")
  })

  test("rejects a userinfo-smuggled host (the token-exfil vector)", () => {
    process.env[ENV] = "github.com@evil.example"
    expect(() => getEnterpriseDomain()).toThrow(
      /Invalid COPILOT_API_ENTERPRISE_URL/u,
    )
  })

  test("rejects a userinfo-smuggled host with a scheme", () => {
    process.env[ENV] = "https://github.com@evil.example"
    expect(() => getEnterpriseDomain()).toThrow(
      /Invalid COPILOT_API_ENTERPRISE_URL/u,
    )
  })

  test("rejects a value with a path", () => {
    process.env[ENV] = "evil.example/github.com"
    expect(() => getEnterpriseDomain()).toThrow(
      /Invalid COPILOT_API_ENTERPRISE_URL/u,
    )
  })

  test("base URLs stay on the legitimate host, not the smuggled one", () => {
    process.env[ENV] = "github.corp.example"
    expect(getGitHubBaseUrl()).toBe("https://github.corp.example")
    expect(getGitHubApiBaseUrl()).toBe("https://api.github.corp.example")
  })
})
