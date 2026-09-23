import consola from "consola"
import { spawn } from "node:child_process"
import path from "node:path"

import { getGitHubApiBaseUrl, githubHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

const MAX_CURL_OUTPUT_BYTES = 1024 * 1024
const MAX_CURL_STDERR_BYTES = 16 * 1024

function getWindowsCurlPath(): string {
  const systemRoot = process.env.SystemRoot
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new Error("Cannot locate the Windows system curl executable")
  }
  return path.win32.join(systemRoot, "System32", "curl.exe")
}

function getHeaderBlock(headers: Record<string, string>): string {
  return (
    Object.entries(headers)
      .map(([name, value]) => {
        if (/[\r\n]/u.test(name) || /[\r\n]/u.test(value)) {
          throw new Error("Invalid newline in Copilot token exchange header")
        }
        return `${name}: ${value}`
      })
      .join("\n") + "\n"
  )
}

async function requestWithWindowsCurl(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const headerBlock = getHeaderBlock(headers)
  return await new Promise<Response>((resolve, reject) => {
    const child = spawn(
      getWindowsCurlPath(),
      [
        "--silent",
        "--show-error",
        "--max-time",
        "60",
        "--output",
        "-",
        "--write-out",
        "\n%{http_code}",
        "--header",
        "@-",
        url,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    )
    const stdoutChunks: Array<Buffer> = []
    const stderrChunks: Array<Buffer> = []
    let outputBytes = 0
    let stderrBytes = 0

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_CURL_OUTPUT_BYTES) {
        child.kill()
        reject(new Error("Copilot token exchange response exceeded 1 MiB"))
        return
      }
      stdoutChunks.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_CURL_STDERR_BYTES) {
        child.kill()
        reject(new Error("Windows curl error output exceeded 16 KiB"))
        return
      }
      stderrChunks.push(chunk)
    })
    child.stdin.on("error", reject)
    child.once("error", reject)
    child.once("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim()
        reject(
          new Error(
            `Windows curl token exchange failed with exit code ${code}: ${stderr}`,
          ),
        )
        return
      }

      const output = Buffer.concat(stdoutChunks).toString("utf8")
      const statusMatch = output.match(/\n(\d{3})$/u)
      if (!statusMatch) {
        reject(new Error("Windows curl did not return an HTTP status"))
        return
      }

      resolve(
        new Response(output.slice(0, -statusMatch[0].length), {
          status: Number.parseInt(statusMatch[1], 10),
        }),
      )
    })
    child.stdin.end(headerBlock)
  })
}

export const getCopilotTokenDependencies = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  isWindows: () => process.platform === "win32",
  requestWithWindowsCurl,
}

export const getCopilotToken = async () => {
  const url = `${getGitHubApiBaseUrl()}/copilot_internal/v2/token`
  const headers = githubHeaders(state)
  let response = await getCopilotTokenDependencies.fetch(url, { headers })

  // GitHub's anti-scraping edge can reject Node/Bun's Windows HTTP fingerprint
  // while accepting the same authenticated request through Windows curl.
  if (response.status === 403 && getCopilotTokenDependencies.isWindows()) {
    response = await getCopilotTokenDependencies.requestWithWindowsCurl(
      url,
      headers,
    )
  }

  if (!response.ok) {
    const errorText = await response.clone().text()
    consola.error("Failed to get Copilot token response body", errorText)

    throw new HTTPError("Failed to get Copilot token", response)
  }

  return (await response.json()) as GetCopilotTokenResponse
}

// Trimmed for the sake of simplicity
export interface GetCopilotTokenResponse {
  expires_at: number
  refresh_in: number
  token: string
  // Per-SKU isolated endpoints returned by the token exchange. This is the
  // authoritative routing source for the issued token; `/copilot_internal/user`
  // may advertise a different segmented host (e.g. business vs enterprise).
  endpoints?: {
    api?: string
    proxy?: string
    telemetry?: string
  }
}
