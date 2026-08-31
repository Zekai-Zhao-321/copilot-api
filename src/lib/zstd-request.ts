import type { MiddlewareHandler } from "hono"

import { Decompress } from "fzstd"

const ZSTD_CONTENT_ENCODING = "zstd"
const INVALID_BODY_STATUS = 400
const PAYLOAD_TOO_LARGE_STATUS = 413

// Guard against zstd decompression bombs: a few-KB compressed body can expand
// to gigabytes of heap and OOM-kill the process. Both limits are overridable
// via env for operators with unusual payloads, but default to values far above
// any legitimate API request while still bounding a hostile one.
const parsePositiveIntEnv = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const DEFAULT_MAX_COMPRESSED_BYTES = 25 * 1024 * 1024 // 25 MiB on the wire
const DEFAULT_MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024 // 100 MiB expanded

export const getMaxCompressedBytes = (): number =>
  parsePositiveIntEnv(
    process.env.COPILOT_API_MAX_ZSTD_INPUT_BYTES,
    DEFAULT_MAX_COMPRESSED_BYTES,
  )

export const getMaxDecompressedBytes = (): number =>
  parsePositiveIntEnv(
    process.env.COPILOT_API_MAX_ZSTD_OUTPUT_BYTES,
    DEFAULT_MAX_DECOMPRESSED_BYTES,
  )

class ZstdLimitError extends Error {
  kind: "input" | "output"

  constructor(message: string, kind: "input" | "output") {
    super(message)
    this.name = "ZstdLimitError"
    this.kind = kind
  }
}

// Read the request body while enforcing a hard cap on the compressed size,
// aborting as soon as the cap is crossed rather than buffering the whole body.
const readBodyWithLimit = async (
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> => {
  const body = request.body
  if (!body) {
    const buffer = new Uint8Array(await request.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      throw new ZstdLimitError("Compressed body exceeds limit", "input")
    }
    return buffer
  }

  const reader = (body as ReadableStream<Uint8Array>).getReader()
  const chunks: Array<Uint8Array> = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new ZstdLimitError("Compressed body exceeds limit", "input")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

// Decompress with a streaming decoder so we can abort the moment the running
// output total crosses the ceiling, before the oversized buffer is allocated.
// fzstd is pure JS and works identically on every runtime, so a single guarded
// path avoids depending on runtime-specific max-output options.
const decompressWithLimit = (
  input: Uint8Array,
  maxBytes: number,
): Uint8Array => {
  const chunks: Array<Uint8Array> = []
  let total = 0
  const decompressor = new Decompress((chunk) => {
    total += chunk.length
    if (total > maxBytes) {
      throw new ZstdLimitError("Decompressed body exceeds limit", "output")
    }
    chunks.push(chunk)
  })
  decompressor.push(input, true)

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

export const zstdDecompressionMiddleware: MiddlewareHandler = async (
  c,
  next,
) => {
  const contentEncoding = c.req.header("content-encoding")?.trim().toLowerCase()
  if (contentEncoding !== ZSTD_CONTENT_ENCODING) {
    return next()
  }

  let compressedBody: Uint8Array
  try {
    compressedBody = await readBodyWithLimit(c.req.raw, getMaxCompressedBytes())
  } catch (error) {
    if (error instanceof ZstdLimitError) {
      return payloadTooLarge(c)
    }
    return invalidBody(c)
  }

  let decompressedBody: Uint8Array
  try {
    decompressedBody = decompressWithLimit(
      compressedBody,
      getMaxDecompressedBytes(),
    )
  } catch (error) {
    if (error instanceof ZstdLimitError) {
      return payloadTooLarge(c)
    }
    return invalidBody(c)
  }

  const headers = new Headers(c.req.raw.headers)
  headers.delete("content-encoding")
  headers.delete("content-length")

  c.req.raw = new Request(c.req.raw.url, {
    body: decompressedBody,
    headers,
    method: c.req.raw.method,
    signal: c.req.raw.signal,
  })
  c.req.bodyCache = {}

  return next()
}

function invalidBody(c: Parameters<MiddlewareHandler>[0]): Response {
  return c.json(
    {
      error: {
        message: "Failed to decompress zstd request body.",
        type: "invalid_request_error",
      },
    },
    INVALID_BODY_STATUS,
  )
}

function payloadTooLarge(c: Parameters<MiddlewareHandler>[0]): Response {
  return c.json(
    {
      error: {
        message: "Compressed request body exceeds the allowed size limit.",
        type: "invalid_request_error",
      },
    },
    PAYLOAD_TOO_LARGE_STATUS,
  )
}
