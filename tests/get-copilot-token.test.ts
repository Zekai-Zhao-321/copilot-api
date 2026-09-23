import { afterEach, expect, mock, test } from "bun:test"

import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import {
  getCopilotToken,
  getCopilotTokenDependencies,
} from "~/services/github/get-copilot-token"

const originalFetch = globalThis.fetch
const originalIsWindows = getCopilotTokenDependencies.isWindows
const originalRequestWithWindowsCurl =
  getCopilotTokenDependencies.requestWithWindowsCurl

afterEach(() => {
  globalThis.fetch = originalFetch
  getCopilotTokenDependencies.isWindows = originalIsWindows
  getCopilotTokenDependencies.requestWithWindowsCurl =
    originalRequestWithWindowsCurl
})

test("returns the token envelope including per-SKU endpoints", async () => {
  state.githubToken = "github-token"

  const fetchMock = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          token: "copilot-token",
          expires_at: 1_800_000_000,
          refresh_in: 1_800,
          sku: "copilot_enterprise_seat_quota",
          endpoints: {
            api: "https://api.enterprise.githubcopilot.com",
            proxy: "proxy.enterprise.githubcopilot.com",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  const result = await getCopilotToken()

  expect(result.token).toBe("copilot-token")
  expect(result.endpoints?.api).toBe("https://api.enterprise.githubcopilot.com")
  expect(result.endpoints?.proxy).toBe("proxy.enterprise.githubcopilot.com")
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.github.com/copilot_internal/v2/token",
    expect.any(Object),
  )
})

test("returns a token envelope without endpoints when absent", async () => {
  state.githubToken = "github-token"

  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          token: "copilot-token",
          expires_at: 1_800_000_000,
          refresh_in: 1_800,
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const result = await getCopilotToken()

  expect(result.token).toBe("copilot-token")
  expect(result.endpoints).toBeUndefined()
})

test("throws HTTPError when the token exchange fails", () => {
  state.githubToken = "github-token"

  globalThis.fetch = mock(() =>
    Promise.resolve(new Response("unauthorized", { status: 401 })),
  ) as unknown as typeof fetch

  expect(getCopilotToken()).rejects.toBeInstanceOf(HTTPError)
})

test("retries a Windows anti-scraping rejection through curl", async () => {
  state.githubToken = "github-token"
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response("forbidden", { status: 403 })),
  ) as unknown as typeof fetch
  getCopilotTokenDependencies.isWindows = () => true
  const curlMock = mock(() =>
    Promise.resolve(
      Response.json({
        token: "copilot-token",
        expires_at: 1_800_000_000,
        refresh_in: 1_800,
      }),
    ),
  )
  getCopilotTokenDependencies.requestWithWindowsCurl = curlMock

  const result = await getCopilotToken()

  expect(result.token).toBe("copilot-token")
  expect(curlMock).toHaveBeenCalledWith(
    "https://api.github.com/copilot_internal/v2/token",
    expect.objectContaining({
      authorization: "token github-token",
    }),
  )
})

test("Windows curl sends headers to a local server and preserves the status", async () => {
  if (process.platform !== "win32") return

  let receivedAuthorization: string | null = null
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      receivedAuthorization = request.headers.get("authorization")
      return new Response("not found", { status: 404 })
    },
  })

  try {
    const response = await getCopilotTokenDependencies.requestWithWindowsCurl(
      `http://127.0.0.1:${server.port}/token`,
      { authorization: "token local-test-only" },
    )
    expect(response.status).toBe(404)
    expect(await response.text()).toBe("not found")
    expect(receivedAuthorization ?? "").toBe("token local-test-only")
  } finally {
    await server.stop(true)
  }
})

async function expectCurlError(
  request: Promise<Response>,
  message: string,
): Promise<void> {
  let thrown: unknown
  try {
    await request
  } catch (error) {
    thrown = error
  }
  if (!(thrown instanceof Error)) {
    throw new Error("Expected Windows curl to reject with an error")
  }
  expect(thrown.message).toContain(message)
}

test("Windows curl rejects oversized responses and invalid header lines", async () => {
  if (process.platform !== "win32") return

  let requestCount = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      requestCount++
      return new Response("x".repeat(1024 * 1024 + 1))
    },
  })

  try {
    const url = `http://127.0.0.1:${server.port}/token`
    await expectCurlError(
      getCopilotTokenDependencies.requestWithWindowsCurl(url, {
        authorization: "token local-test-only\r\nx-injected: value",
      }),
      "Invalid newline",
    )
    expect(requestCount).toBe(0)

    await expectCurlError(
      getCopilotTokenDependencies.requestWithWindowsCurl(url, {
        authorization: "token local-test-only",
      }),
      "exceeded 1 MiB",
    )
    expect(requestCount).toBe(1)
  } finally {
    await server.stop(true)
  }
})

test("Windows curl fails closed when the system directory is unavailable", async () => {
  if (process.platform !== "win32") return

  const systemRoot = process.env.SystemRoot
  try {
    delete process.env.SystemRoot
    await expectCurlError(
      getCopilotTokenDependencies.requestWithWindowsCurl(
        "http://127.0.0.1:1/token",
        { authorization: "token local-test-only" },
      ),
      "Cannot locate the Windows system curl executable",
    )
  } finally {
    process.env.SystemRoot = systemRoot
  }
})

test("Windows curl reports local connection failures", async () => {
  if (process.platform !== "win32") return

  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("unexpected response")
    },
  })
  const port = server.port
  await server.stop(true)

  await expectCurlError(
    getCopilotTokenDependencies.requestWithWindowsCurl(
      `http://127.0.0.1:${port}/token`,
      { authorization: "token local-test-only" },
    ),
    "Windows curl token exchange failed with exit code",
  )
})
