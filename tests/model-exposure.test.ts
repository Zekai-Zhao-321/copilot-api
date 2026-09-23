import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { isModelExposed } from "~/lib/model-exposure"

const cwd = fileURLToPath(new URL("../", import.meta.url))
const decoder = new TextDecoder()
const tempDirs: Array<string> = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

function runWithConfig(config: unknown, script: string): unknown {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "copilot-api-model-exposure-"),
  )
  tempDirs.push(tempDir)
  fs.writeFileSync(path.join(tempDir, "config.json"), JSON.stringify(config))

  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    cwd,
    env: {
      ...process.env,
      COPILOT_API_HOME: tempDir,
      COPILOT_API_OAUTH_APP: "",
      COPILOT_API_ENTERPRISE_URL: "",
    },
  })
  const stdout = decoder.decode(result.stdout)
  if (result.exitCode !== 0) {
    throw new Error(
      `script failed (${result.exitCode}):\n${stdout}\n${decoder.decode(result.stderr)}`,
    )
  }
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "null")
}

describe("isModelExposed", () => {
  test("exposes every model when no patterns are configured", () => {
    expect(isModelExposed("gpt-5-mini", [])).toBe(true)
  })

  test("matches wildcard patterns case-insensitively", () => {
    const patterns = ["claude-*"]
    expect(isModelExposed("claude-opus-4-6", patterns)).toBe(true)
    expect(isModelExposed("Claude-Sonnet-4-6", patterns)).toBe(true)
    expect(isModelExposed("gpt-5-mini", patterns)).toBe(false)
    expect(isModelExposed("gemini-3-pro", patterns)).toBe(false)
  })

  test("ignores the [1m] context suffix", () => {
    expect(isModelExposed("claude-opus-4-6[1m]", ["claude-opus-4-6"])).toBe(
      true,
    )
  })

  test("matches the upstream dotted id against a hyphenated pattern", () => {
    expect(isModelExposed("claude-sonnet-4.6", ["claude-sonnet-4-6"])).toBe(
      true,
    )
  })

  test("treats regex metacharacters in patterns literally", () => {
    expect(isModelExposed("claude-haiku-4.5", ["claude-haiku-4.5"])).toBe(true)
    expect(isModelExposed("claude-haiku-4x5", ["claude-haiku-4.5"])).toBe(false)
  })

  test("supports provider-prefixed patterns", () => {
    const patterns = ["openrouter/anthropic/*"]
    expect(isModelExposed("openrouter/anthropic/claude-opus-4", patterns)).toBe(
      true,
    )
    expect(isModelExposed("openrouter/openai/gpt-5", patterns)).toBe(false)
  })
})

describe("exposedModels config", () => {
  test("reads trimmed, non-empty string patterns from config", () => {
    const patterns = runWithConfig(
      { exposedModels: [" claude-* ", "", 42, "gpt-5-mini"] },
      'const m = await import("./src/lib/model-exposure"); console.log(JSON.stringify(m.getExposedModelPatterns()))',
    )
    expect(patterns).toEqual(["claude-*", "gpt-5-mini"])
  })

  test("returns no patterns when exposedModels is not an array", () => {
    const patterns = runWithConfig(
      { exposedModels: "claude-*" },
      'const m = await import("./src/lib/model-exposure"); console.log(JSON.stringify(m.getExposedModelPatterns()))',
    )
    expect(patterns).toEqual([])
  })

  test("assertModelExposed rejects unlisted models with a 404", () => {
    const outcome = runWithConfig(
      { exposedModels: ["claude-*"] },
      `const m = await import("./src/lib/model-exposure")
m.assertModelExposed("claude-opus-4-6")
try {
  m.assertModelExposed("gpt-5-mini")
  console.log(JSON.stringify({ threw: false }))
} catch (error) {
  console.log(JSON.stringify({ threw: true, status: error.response.status, body: await error.response.text() }))
}`,
    )
    expect(outcome).toEqual({
      threw: true,
      status: 404,
      body: 'Model "gpt-5-mini" is not exposed by this gateway.',
    })
  })
})
