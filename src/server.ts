import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { readFileSync } from "node:fs"

import { resolveCorsOrigin } from "./lib/cors"
import {
  createAuthMiddleware,
  getConfiguredAdminApiKeys,
} from "./lib/request-auth"
import { traceIdMiddleware } from "./lib/trace"
import { zstdDecompressionMiddleware } from "./lib/zstd-request"
import { alphaSearchRoutes } from "./routes/alpha-search/route"
import { completionRoutes } from "./routes/chat-completions/route"
import { configRoutes } from "./routes/admin/config/route"
import { embeddingRoutes } from "./routes/embeddings/route"
import { imageRoutes } from "./routes/images/route"
import { messageRoutes } from "./routes/messages/route"
import { modelRoutes } from "./routes/models/route"
import { providerAlphaSearchRoutes } from "./routes/provider/alpha-search/route"
import { providerImageRoutes } from "./routes/provider/images/route"
import { providerMessageRoutes } from "./routes/provider/messages/route"
import { providerModelRoutes } from "./routes/provider/models/route"
import { providerResponsesRoutes } from "./routes/provider/responses/route"
import { responsesRoutes } from "./routes/responses/route"
import { tokenUsageRoute } from "./routes/token-usage/route"
import { usageRoute } from "./routes/usage/route"

export const server = new Hono()

server.use(traceIdMiddleware)
server.use(logger())
server.use(
  cors({
    // Loopback-only by default; never reflects "*" for a foreign origin.
    // Extend with COPILOT_API_ALLOWED_ORIGINS if you front this with a UI.
    origin: (origin) => resolveCorsOrigin(origin),
    allowHeaders: [
      "content-type",
      "authorization",
      "x-api-key",
      "anthropic-version",
      "anthropic-beta",
    ],
  }),
)
server.use(
  "*",
  createAuthMiddleware({
    allowUnauthenticatedPaths: ["/", "/usage-viewer", "/usage-viewer/"],
    shouldSkipPath: (path) => path.startsWith("/admin/"),
  }),
)
server.use(
  "/admin/*",
  createAuthMiddleware({
    getApiKeys: getConfiguredAdminApiKeys,
    allowUnauthenticatedPaths: [],
    allowWhenNoApiKeys: false,
  }),
)
server.use(zstdDecompressionMiddleware)

server.get("/", (c) => c.text("Server running"))
server.get("/usage-viewer", (c) => {
  const usageViewerFileUrl = new URL("../pages/index.html", import.meta.url)
  // Constrain what the page can execute/connect to. The page currently pulls
  // Tailwind/Lucide from CDNs and fetches a user-supplied `?endpoint=`, so we
  // can't use a strict `default-src 'self'` without breaking it, but scoping
  // script sources to the known CDNs and blocking framing/base-hijacking still
  // meaningfully limits the impact of any injection on the gateway origin.
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.tailwindcss.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src *",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join("; "),
  )
  c.header("X-Content-Type-Options", "nosniff")
  return c.html(readFileSync(usageViewerFileUrl, "utf8"))
})
server.get("/usage-viewer/", (c) => c.redirect("/usage-viewer", 301))

server.route("/chat/completions", completionRoutes)
server.route("/admin/config", configRoutes)
server.route("/models", modelRoutes)
server.route("/embeddings", embeddingRoutes)
server.route("/usage", usageRoute)
server.route("/token-usage", tokenUsageRoute)
server.route("/responses", responsesRoutes)
server.route("/alpha/search", alphaSearchRoutes)
server.route("/images", imageRoutes)

// Compatibility with tools that expect v1/ prefix
server.route("/v1/chat/completions", completionRoutes)
server.route("/v1/models", modelRoutes)
server.route("/v1/embeddings", embeddingRoutes)
server.route("/v1/responses", responsesRoutes)
server.route("/v1/alpha/search", alphaSearchRoutes)
server.route("/v1/images", imageRoutes)

// Anthropic compatible endpoints
server.route("/v1/messages", messageRoutes)

// Provider scoped endpoints
server.route("/:provider/v1/messages", providerMessageRoutes)
server.route("/:provider/v1/models", providerModelRoutes)
server.route("/:provider/v1/responses", providerResponsesRoutes)
server.route("/:provider/v1/alpha/search", providerAlphaSearchRoutes)
server.route("/:provider/v1/images", providerImageRoutes)

server.route("/:provider/models", providerModelRoutes)
server.route("/:provider/responses", providerResponsesRoutes)
server.route("/:provider/alpha/search", providerAlphaSearchRoutes)
server.route("/:provider/images", providerImageRoutes)
