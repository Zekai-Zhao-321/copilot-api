import { afterEach, describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { zstdCompressSync } from "node:zlib"
import { Hono } from "hono"

import { zstdDecompressionMiddleware } from "~/lib/zstd-request"

const ENV_INPUT = "COPILOT_API_MAX_ZSTD_INPUT_BYTES"
const ENV_OUTPUT = "COPILOT_API_MAX_ZSTD_OUTPUT_BYTES"

function createApp() {
  const app = new Hono()
  app.use(zstdDecompressionMiddleware)
  app.post("/echo", async (c) => {
    const text = await c.req.text()
    return c.json({ length: text.length })
  })
  return app
}

afterEach(() => {
  delete process.env[ENV_INPUT]
  delete process.env[ENV_OUTPUT]
})

describe("zstd decompression limits", () => {
  test("passes through a normal zstd-compressed body", async () => {
    const app = createApp()
    const payload = "hello world ".repeat(100)
    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-encoding": "zstd" },
      body: zstdCompressSync(Buffer.from(payload)),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ length: payload.length })
  })

  test("ignores requests without the zstd content-encoding", async () => {
    const app = createApp()
    const res = await app.request("/echo", {
      method: "POST",
      body: "plain body",
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ length: "plain body".length })
  })

  test("rejects a decompression bomb instead of expanding it (413)", async () => {
    // ~50 MiB of zeros compresses to a few KB but must never be expanded.
    process.env[ENV_OUTPUT] = String(1024 * 1024) // 1 MiB output ceiling
    const app = createApp()
    const bomb = zstdCompressSync(Buffer.alloc(50 * 1024 * 1024, 0))
    expect(bomb.length).toBeLessThan(1024 * 1024)

    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-encoding": "zstd" },
      body: bomb,
    })
    expect(res.status).toBe(413)
  })

  test("rejects an oversized compressed body before decompressing (413)", async () => {
    process.env[ENV_INPUT] = String(1024) // 1 KiB input ceiling
    const app = createApp()
    // Incompressible random data so the compressed body itself exceeds the cap.
    const body = zstdCompressSync(randomBytes(64 * 1024))
    expect(body.length).toBeGreaterThan(1024)

    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-encoding": "zstd" },
      body,
    })
    expect(res.status).toBe(413)
  })

  test("returns 400 for a body that is not valid zstd", async () => {
    const app = createApp()
    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-encoding": "zstd" },
      body: Buffer.from("not zstd at all"),
    })
    expect(res.status).toBe(400)
  })
})
