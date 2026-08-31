// CORS origin policy for the local gateway.
//
// The gateway's real clients (Codex, Claude Code, curl, native apps) are not
// browsers and send no Origin header, so they are unaffected by CORS. The only
// thing a permissive `Access-Control-Allow-Origin: *` buys is letting an
// arbitrary web page the user happens to visit read gateway responses -- which,
// because this API authenticates with a header rather than a cookie, is a real
// cross-origin data-exfiltration and quota-abuse vector. So we allow only
// loopback origins by default (covering the locally served usage-viewer,
// including one gateway's viewer pointed at another local gateway), plus any
// origins the operator explicitly opts into via COPILOT_API_ALLOWED_ORIGINS.

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

export const isLoopbackOrigin = (origin: string): boolean => {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  const hostname = url.hostname
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true
  // 127.0.0.0/8 is entirely loopback.
  return /^127(?:\.\d{1,3}){3}$/u.test(hostname)
}

export const getConfiguredAllowedOrigins = (): Array<string> => {
  const raw = process.env.COPILOT_API_ALLOWED_ORIGINS
  if (!raw) return []
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

// Returns the value to echo in Access-Control-Allow-Origin, or null to deny
// (no ACAO header, so the browser blocks the cross-origin read). Never returns
// "*", so a foreign origin can never read authenticated responses.
export const resolveCorsOrigin = (
  origin: string,
  allowedOrigins: Array<string> = getConfiguredAllowedOrigins(),
): string | null => {
  if (!origin) return null
  if (allowedOrigins.includes("*")) return origin
  if (isLoopbackOrigin(origin)) return origin
  if (allowedOrigins.includes(origin)) return origin
  return null
}
