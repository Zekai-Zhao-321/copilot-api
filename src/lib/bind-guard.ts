import consola from "consola"

import { getConfiguredApiKeys } from "./request-auth"

// Loopback addresses are only reachable from the same machine. Everything else
// (0.0.0.0, ::, a specific LAN/public IP) exposes the gateway to the network.
export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
  if (normalized === "localhost" || normalized === "::1") return true
  return /^127(?:\.\d{1,3}){3}$/u.test(normalized)
}

// Precedence: explicit --host flag, then HOST env (srvx also reads it), then a
// safe loopback default. Historically this bound all interfaces by default.
export function resolveBindHost(hostOption?: string): string {
  const explicit = hostOption?.trim() || process.env.HOST?.trim()
  return explicit || "127.0.0.1"
}

// Fail closed: refuse to expose an unauthenticated gateway to the network.
// With no API keys configured every functional route is open, so binding a
// non-loopback interface would let anyone on the LAN -- or a web page via the
// gateway -- spend the user's Copilot quota and read their identity. Binding
// loopback is always fine; exposing it requires either an API key or an
// explicit, documented acknowledgement.
export function assertSafeBindPosture(
  host: string,
  allowUnauthenticated: boolean,
): void {
  if (isLoopbackHost(host)) return

  const hasApiKeys = getConfiguredApiKeys().length > 0
  if (hasApiKeys) {
    consola.warn(
      `Binding to ${host} exposes the gateway beyond this machine. `
        + "API key authentication is enabled, so requests must present a key.",
    )
    return
  }

  if (allowUnauthenticated) {
    consola.warn(
      `SECURITY: binding to ${host} with NO API key authentication. Anyone who `
        + "can reach this port can use your Copilot subscription and read your "
        + "identity via /usage. This was explicitly allowed with "
        + "--allow-unauthenticated.",
    )
    return
  }

  throw new Error(
    `Refusing to bind to ${host} without authentication.\n`
      + "  This would expose an unauthenticated gateway to the network.\n"
      + "  Fix one of:\n"
      + "    * Bind to loopback (default): drop --host, or use --host 127.0.0.1\n"
      + "    * Require a key: npx copilot-api auth keys --add <key>\n"
      + "    * Explicitly accept the risk: pass --allow-unauthenticated",
  )
}
