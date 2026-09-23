import { getConfig } from "./config-store"
import { HTTPError } from "./error"
import { toClientModelId } from "./models"

// `exposedModels` restricts which models the gateway lists and accepts, e.g.
// ["claude-*"] to serve only Claude models. Patterns are case-insensitive and
// support `*` as a wildcard. Unset or empty means every model is exposed.
export function getExposedModelPatterns(): Array<string> {
  const patterns = getConfig().exposedModels
  if (!Array.isArray(patterns)) {
    return []
  }
  return patterns
    .filter((pattern): pattern is string => typeof pattern === "string")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern.split("*").map(escapeRegExp).join(".*")
  return new RegExp(`^${source}$`, "i")
}

// Claude Code appends `[1m]` to opt into the 1M context window; the suffix is
// not part of the model identity.
function stripContextSuffix(modelId: string): string {
  return modelId.replace(/\[1m\]$/i, "")
}

export function isModelExposed(
  modelId: string,
  patterns: Array<string> = getExposedModelPatterns(),
): boolean {
  if (patterns.length === 0) {
    return true
  }
  const baseId = stripContextSuffix(modelId)
  const candidates = new Set([baseId, toClientModelId(baseId)])
  const matchers = patterns.map(patternToRegExp)
  return [...candidates].some((candidate) =>
    matchers.some((matcher) => matcher.test(candidate)),
  )
}

export function assertModelExposed(modelId: string): void {
  if (isModelExposed(modelId)) {
    return
  }
  const message = `Model ${JSON.stringify(modelId)} is not exposed by this gateway.`
  throw new HTTPError(message, new Response(message, { status: 404 }))
}
