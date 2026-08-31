import type { Context, MiddlewareHandler } from "hono"

import consola from "consola"
import { timingSafeEqual } from "node:crypto"

import { getConfig } from "./config"

interface AuthMiddlewareOptions {
  getApiKeys?: () => Array<string>
  allowUnauthenticatedPaths?: Array<string>
  allowOptionsBypass?: boolean
  allowWhenNoApiKeys?: boolean
  shouldSkipPath?: (path: string) => boolean
}

export function normalizeApiKeys(apiKeys: unknown): Array<string> {
  if (!Array.isArray(apiKeys)) {
    if (apiKeys !== undefined) {
      consola.warn("Invalid auth.apiKeys config. Expected an array of strings.")
    }
    return []
  }

  const normalizedKeys = apiKeys
    .filter((key): key is string => typeof key === "string")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)

  if (normalizedKeys.length !== apiKeys.length) {
    consola.warn(
      "Invalid auth.apiKeys entries found. Only non-empty strings are allowed.",
    )
  }

  return [...new Set(normalizedKeys)]
}

export function getConfiguredApiKeys(): Array<string> {
  const config = getConfig()
  return normalizeApiKeys(config.auth?.apiKeys)
}

export function getMissingApiKeysMessage(): string | null {
  const apiKeys = getConfiguredApiKeys()
  if (apiKeys.length > 0) {
    return null
  }

  return [
    "Requests currently bypass authentication.",
    "Run `npx copilot-api auth keys --add <key>` to enable API key auth.",
  ].join(" ")
}

function normalizeApiKey(apiKey: unknown): string | null {
  if (typeof apiKey !== "string") {
    return null
  }

  const normalizedApiKey = apiKey.trim()
  return normalizedApiKey || null
}

export function getConfiguredAdminApiKeys(): Array<string> {
  const config = getConfig()
  const adminApiKey = normalizeApiKey(config.auth?.adminApiKey)
  return adminApiKey ? [adminApiKey] : []
}

export function extractRequestApiKey(c: Context): string | null {
  const xApiKey = c.req.header("x-api-key")?.trim()
  if (xApiKey) {
    return xApiKey
  }

  const authorization = c.req.header("authorization")
  if (!authorization) {
    return null
  }

  const [scheme, ...rest] = authorization.trim().split(/\s+/)
  if (scheme.toLowerCase() !== "bearer") {
    return null
  }

  const bearerToken = rest.join(" ").trim()
  return bearerToken || null
}

// Compare in constant time so the key check does not leak how many leading
// bytes matched via response timing. `timingSafeEqual` requires equal-length
// buffers, so the length check is unavoidable and is not itself sensitive.
export function matchesAnyApiKey(
  candidate: string,
  apiKeys: Array<string>,
): boolean {
  const candidateBuffer = Buffer.from(candidate)
  let matched = false
  for (const key of apiKeys) {
    const keyBuffer = Buffer.from(key)
    if (
      keyBuffer.length === candidateBuffer.length
      && timingSafeEqual(keyBuffer, candidateBuffer)
    ) {
      matched = true
    }
  }
  return matched
}

function createUnauthorizedResponse(c: Context): Response {
  c.header("WWW-Authenticate", 'Bearer realm="copilot-api"')
  return c.json(
    {
      error: {
        message: "Unauthorized",
        type: "authentication_error",
      },
    },
    401,
  )
}

export function createAuthMiddleware(
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler {
  const getApiKeys = options.getApiKeys ?? getConfiguredApiKeys
  const allowUnauthenticatedPaths = options.allowUnauthenticatedPaths ?? ["/"]
  const allowOptionsBypass = options.allowOptionsBypass ?? true
  const allowWhenNoApiKeys = options.allowWhenNoApiKeys ?? true
  const shouldSkipPath = options.shouldSkipPath ?? (() => false)

  return async (c, next) => {
    if (allowOptionsBypass && c.req.method === "OPTIONS") {
      return next()
    }

    if (shouldSkipPath(c.req.path)) {
      return next()
    }

    if (allowUnauthenticatedPaths.includes(c.req.path)) {
      return next()
    }

    const apiKeys = getApiKeys()
    if (apiKeys.length === 0) {
      return allowWhenNoApiKeys ? next() : createUnauthorizedResponse(c)
    }

    const requestApiKey = extractRequestApiKey(c)
    if (!requestApiKey || !matchesAnyApiKey(requestApiKey, apiKeys)) {
      return createUnauthorizedResponse(c)
    }

    return next()
  }
}
