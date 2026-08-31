import fs from "node:fs/promises"
import path from "node:path"

import type { CodexCredentials } from "~/lib/oauth/codex"

import { writeFileAtomically } from "./atomic-file"
import { PATHS } from "./paths"

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

async function writeProtectedFile(
  filePath: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  // Write through the atomic writer instead of writeFile + chmod. It creates
  // the temp file with mode 0o600 up front, so the secret is never on disk
  // world-readable, and the rename replaces a symlink planted at filePath
  // rather than writing the credential through it.
  writeFileAtomically(filePath, content)
}

function normalizeCodexCredentials(
  credentials: unknown,
): CodexCredentials | null {
  if (!credentials || typeof credentials !== "object") {
    return null
  }

  const candidate = credentials as Partial<CodexCredentials>
  if (
    typeof candidate.accessToken !== "string"
    || typeof candidate.refreshToken !== "string"
    || typeof candidate.expiresAt !== "number"
    || typeof candidate.accountId !== "string"
  ) {
    return null
  }

  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    expiresAt: candidate.expiresAt,
    accountId: candidate.accountId,
  }
}

export async function readGitHubToken(): Promise<string | null> {
  const token = await readOptionalFile(PATHS.GITHUB_TOKEN_PATH)
  const normalizedToken = token?.trim()
  return normalizedToken || null
}

export async function writeGitHubToken(token: string): Promise<void> {
  await writeProtectedFile(PATHS.GITHUB_TOKEN_PATH, token.trim())
}

export async function readCodexCredentials(): Promise<CodexCredentials | null> {
  const raw = await readOptionalFile(PATHS.CODEX_CREDENTIAL_PATH)
  if (!raw?.trim()) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(
      `Codex credentials file is not valid JSON: ${PATHS.CODEX_CREDENTIAL_PATH}`,
      {
        cause: error,
      },
    )
  }

  const credentials = normalizeCodexCredentials(parsed)
  if (!credentials) {
    throw new Error(
      `Codex credentials file is missing required fields: ${PATHS.CODEX_CREDENTIAL_PATH}`,
    )
  }

  return credentials
}

export async function writeCodexCredentials(
  credentials: CodexCredentials,
): Promise<void> {
  await writeProtectedFile(
    PATHS.CODEX_CREDENTIAL_PATH,
    `${JSON.stringify(credentials, null, 2)}\n`,
  )
}

export async function clearCodexCredentials(): Promise<void> {
  await writeProtectedFile(PATHS.CODEX_CREDENTIAL_PATH, "")
}

export async function hasCodexCredentials(): Promise<boolean> {
  return (await readCodexCredentials()) !== null
}
