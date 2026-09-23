import { afterEach, beforeEach, expect, test } from "bun:test"

import type { Model } from "~/lib/types/models"

import { getLatestModelForFamily } from "~/lib/models"
import { state } from "~/lib/state"

const makeModels = (
  ids: Array<string>,
): { data: Array<Model>; object: string } => ({
  object: "list",
  data: ids.map(
    (id) =>
      ({
        id,
        name: id,
        object: "model",
        preview: false,
        vendor: "anthropic",
        version: id,
        model_picker_enabled: true,
        capabilities: {
          family: id,
          object: "model_capabilities",
          tokenizer: "o200k_base",
          type: "chat",
          limits: {},
          supports: {},
        },
      }) as Model,
  ),
})

const previousModels = state.models

beforeEach(() => {
  state.models = undefined
})

afterEach(() => {
  state.models = previousModels
})

test("returns the highest version model for a family", () => {
  state.models = makeModels([
    "claude-opus-4.5",
    "claude-opus-4.8",
    "claude-sonnet-4.6",
    "claude-sonnet-5",
    "claude-haiku-4.5",
    "claude-fable-5",
  ])

  expect(getLatestModelForFamily("opus")?.id).toBe("claude-opus-4.8")
  expect(getLatestModelForFamily("sonnet")?.id).toBe("claude-sonnet-5")
  expect(getLatestModelForFamily("haiku")?.id).toBe("claude-haiku-4.5")
  expect(getLatestModelForFamily("fable")?.id).toBe("claude-fable-5")
})

test("compares major before minor version", () => {
  state.models = makeModels([
    "claude-sonnet-3.7",
    "claude-sonnet-4.1",
    "claude-3-5-sonnet",
  ])

  expect(getLatestModelForFamily("sonnet")?.id).toBe("claude-sonnet-4.1")
})

test("handles mixed model ID formats", () => {
  state.models = makeModels([
    "claude-3-opus-20240229",
    "claude-opus-4-5-20251101",
  ])

  expect(getLatestModelForFamily("opus")?.id).toBe("claude-opus-4-5-20251101")
})

test("returns undefined when the family is unavailable", () => {
  state.models = makeModels(["claude-sonnet-4.6", "gpt-5-mini"])

  expect(getLatestModelForFamily("opus")).toBeUndefined()
})

test("returns undefined when no models are cached", () => {
  state.models = undefined

  expect(getLatestModelForFamily("sonnet")).toBeUndefined()
})

test("resolves 1M Claude model variants to their upstream model", () => {
  const script = `
    const { state } = await import("./src/lib/state")
    const { findEndpointModel, stripOneMillionContextSuffix } = await import("./src/lib/models")
    state.models = {
      object: "list",
      data: ["claude-opus-5.5", "claude-haiku-4.5"].map((id) => ({
        id,
        capabilities: { family: "claude", limits: {}, supports: {}, object: "model_capabilities", tokenizer: "o200k_base", type: "chat" },
      })),
    }
    console.log(JSON.stringify({
      extended: findEndpointModel("claude-opus-5-5[1m]")?.id,
      dotted: findEndpointModel("claude-opus-5.5[1m]")?.id,
      standard: findEndpointModel("claude-opus-5-5")?.id,
      haiku: findEndpointModel("claude-haiku-4-5")?.id,
      missing: findEndpointModel("unknown[1m]")?.id ?? null,
      stripped: stripOneMillionContextSuffix("claude-opus-5-5[1m]"),
      unchanged: stripOneMillionContextSuffix("claude-opus-5-5"),
    }))
  `
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    cwd: process.cwd(),
  })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr))
  }
  expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({
    extended: "claude-opus-5.5",
    dotted: "claude-opus-5.5",
    standard: "claude-opus-5.5",
    haiku: "claude-haiku-4.5",
    missing: null,
    stripped: "claude-opus-5-5",
    unchanged: "claude-opus-5-5",
  })
}, 15_000)
