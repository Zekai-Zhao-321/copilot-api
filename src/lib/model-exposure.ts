import { getConfig } from "./config-store"
import { HTTPError } from "./error"
import { stripOneMillionContextSuffix, toClientModelId } from "./models"

export function getExposedModelPatterns(): Array<string> {
  const patterns = getConfig().exposedModels
  if (patterns === undefined) {
    return []
  }
  if (
    !Array.isArray(patterns)
    || patterns.some(
      (pattern) => typeof pattern !== "string" || !pattern.trim(),
    )
  ) {
    throw new Error(
      "Invalid exposedModels config. Expected an array of non-empty model ID patterns.",
    )
  }
  return patterns.map((pattern: string) => pattern.trim())
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern.split("*").map(escapeRegExp).join(".*")
  return new RegExp(`^${source}$`, "i")
}

export function isModelExposed(
  modelId: string,
  patterns: Array<string> = getExposedModelPatterns(),
): boolean {
  if (patterns.length === 0) {
    return true
  }
  const baseId = stripOneMillionContextSuffix(modelId)
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
