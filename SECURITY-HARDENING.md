# Security Hardening

This fork applies a set of defensive changes to make the gateway safe to run
by default, especially on a corporate network. It also documents the residual
risks that are **not** code bugs but deliberate design choices you should
understand before pointing a work Copilot seat at it.

The changes came out of a multi-angle source audit of `v2.3.10`
(network exposure, egress/data-flow, credential lifecycle, supply chain,
injection/SSRF, and client-impersonation/policy). Everything below is verified
against the code; the DoS and CORS items were reproduced end-to-end.

---

## What changed in this branch

### Network exposure (the big one)

- **Binds loopback (`127.0.0.1`) by default.** Previously the server passed no
  hostname to `srvx`, which binds `0.0.0.0` (all interfaces). Anyone on the
  same LAN could reach `:4141` and spend your Copilot quota unauthenticated.
- **New `--host` flag** (also reads the `HOST` env var). Use `--host 0.0.0.0`
  to expose it on purpose.
- **Fail-closed guard.** The server now refuses to bind a non-loopback
  interface while authentication is disabled (no API keys configured). Fix by
  binding loopback, adding an API key (`copilot-api auth keys --add <key>`), or
  explicitly accepting the risk with `--allow-unauthenticated`.
- **CORS is locked down.** `cors()` previously returned
  `Access-Control-Allow-Origin: *`, so any web page you visited could call the
  gateway and read the response (this API authenticates with a header, not a
  cookie, so `*` really is readable). It now allows only loopback origins by
  default, extendable via `COPILOT_API_ALLOWED_ORIGINS` (comma-separated; `*`
  is honored only if you set it explicitly).
- **Constant-time API-key comparison** (`timingSafeEqual`) replaces
  `Array.includes`.

### Denial of service

- **zstd decompression-bomb guard.** The zstd request middleware decompressed
  bodies with no size ceiling — a ~6 KB request expanded to 200 MB of heap
  (32,000×), a trivial unauthenticated OOM. It now caps the compressed input
  (`COPILOT_API_MAX_ZSTD_INPUT_BYTES`, default 25 MiB) and aborts decompression
  once the output crosses a ceiling (`COPILOT_API_MAX_ZSTD_OUTPUT_BYTES`,
  default 100 MiB), returning `413` instead of allocating.

### Credential & secret handling

- **Credential files are written atomically at mode `0600`.** The previous
  `writeFile`-then-`chmod` left the token/credential file world-readable for a
  brief window (and wrote *through* a symlink planted at the path). Writes now
  go through the atomic writer, which creates the temp file `0600` before the
  rename.
- **`COPILOT_API_ENTERPRISE_URL` is validated as a bare host.** A value like
  `github.com@evil.example` previously normalized so that the GitHub OAuth
  token was sent to `evil.example` while reading like `github.com`. Userinfo,
  paths, and credentials in the value are now rejected.
- **Secrets kept out of logs.** The GitHub device-flow access token and
  device code, and the Codex token payloads in OAuth error messages, are no
  longer serialized into log lines / exceptions — only field names are logged.
- **Log level pinned to `--verbose`.** Previously `DEBUG` or `CONSOLA_LEVEL`
  in the environment could silently promote the file-backed logger to debug and
  write full request/response payloads to disk *without* `--verbose`. The
  handler logger now ignores the ambient level.
- **Log directory/files are `0700`/`0600`** (were world-readable `0755`/`0644`,
  and can contain full prompts under `--verbose`).

### Data egress

- **`count_tokens` no longer honors an ambient `ANTHROPIC_API_KEY`.** It used
  to forward the entire conversation payload (system prompt, history, tool
  schemas) to `api.anthropic.com` whenever that env var happened to be set —
  which it is in many developer shells. To enable exact Anthropic token
  counting now, set `anthropicApiKey` in `config.json` (stored `0600`)
  explicitly; otherwise it falls back to local estimation.

### Usage-viewer page

- **DOM XSS fixed.** Two `toLocaleString()` interpolations rendered fetched
  JSON unescaped, so a malicious `?endpoint=` could inject script into the
  gateway origin and steal the stored API key from `localStorage`. Both sinks
  are now escaped.
- **CSP + `nosniff` headers** are sent with the page.

### Docker

- The container sets `HOST=0.0.0.0` (published ports need a non-loopback bind),
  which means it now **requires an API key** to start — configure
  `auth.apiKeys` or pass `--allow-unauthenticated`. This is intentional:
  a container exposing the port should be authenticated.
- The GitHub token is read from the `GH_TOKEN` env var instead of being passed
  as `-g <token>` on the command line (argv is world-readable via
  `/proc/<pid>/cmdline`).

---

## Recommended way to run it (corporate seat)

```bash
# 1. Authenticate (stores the token 0600 under ~/.local/share/copilot-api/)
npx copilot-api auth login

# 2. Add an API key so the gateway is not open even on loopback
npx copilot-api auth keys --add "$(openssl rand -hex 32)"

# 3. Start it — loopback-only by default, no extra flags needed
npx copilot-api start
```

Point your harness (Codex, Claude Code, …) at `http://127.0.0.1:4141` and send
the API key as a bearer token / `x-api-key`.

Do **not** use `--verbose` or `--show-token` for routine operation (both write
or print sensitive material). Do not set `COPILOT_API_ENTERPRISE_URL` unless it
is genuinely your GitHub Enterprise host.

**Egress allowlist** for normal operation: `github.com`, `api.github.com`,
`api.githubcopilot.com` (and `api.business.githubcopilot.com` /
`api.enterprise.githubcopilot.com`, plus any host GitHub returns in
`endpoints.api`). Add `auth.openai.com` + `chatgpt.com` only if you use Codex;
add each configured third-party provider host only if you use providers.

---

## Residual risks NOT changed in code (your informed choice)

These are inherent to what the tool does. They are intentionally left as-is
because "fixing" them would either break the tool or is a policy decision only
you can make.

1. **The tool impersonates the VS Code Copilot Chat client.** It sends GitHub's
   own Copilot OAuth client ID and spoofs `user-agent`, `editor-version`,
   `editor-plugin-version`, `x-interaction-type`, and a machine ID derived from
   your MAC address. `NOTICE.md` acknowledges this can trip GitHub's
   abuse detection and lead to suspension. On a corporate seat, all usage is
   attributable to your GitHub identity and cannot be detached from it.
2. **Premium-request metering is shaped downward.** The code reshapes requests
   (folding `text` into `tool_result`, forcing a small model on tool-less
   warmups) specifically "to avoid consuming premium requests." On an
   employer-owned seat this makes the admin dashboard under-count real usage.
   This was **left intact on purpose** — removing it would *increase* what your
   seat consumes, which is your call, not a change to make silently. If you want
   honest metering, that is the code to change.
3. **No request throttling.** Agentic harnesses burst dozens of requests/minute
   with no human pacing — the pattern `NOTICE.md` warns about. Mitigate at the
   harness (lower concurrency, avoid unattended loops), not here.
4. **Supply chain: pin the version.** The upstream package publishes ~1.8
   releases/day and every documented install path uses `@latest`, including the
   Claude plugin's `.mcp.json`. The published package has clean provenance
   (OIDC trusted publishing + SLSA), so pin an exact version and verify:
   ```bash
   npm install --save-exact --ignore-scripts @jeffreycao/copilot-api@<version>
   npm audit signatures   # needs registry.npmjs.org + tuf-repo-cdn.sigstore.dev
   ```
   Replace `@latest` with the pinned version in any `.mcp.json` you use.
5. **Third-party CDN assets in the usage-viewer.** The dashboard still pulls
   Tailwind/Lucide from CDNs without SRI (now constrained by CSP). Only relevant
   if you open `/usage-viewer` in a browser; it also won't load on an
   air-gapped network.
6. **Desktop app** (`desktop/`) is a separate build with its own gaps (unsigned
   installers, token via argv, inherits the bind default). This branch hardens
   the CLI/server; if you need the desktop app, review it separately.

---

## New configuration surface

| Flag / env var | Default | Purpose |
| --- | --- | --- |
| `--host` / `HOST` | `127.0.0.1` | Interface to bind. |
| `--allow-unauthenticated` | off | Permit non-loopback bind with no API keys. |
| `COPILOT_API_ALLOWED_ORIGINS` | (loopback only) | Extra CORS origins, comma-separated. |
| `COPILOT_API_MAX_ZSTD_INPUT_BYTES` | 26214400 | Max compressed request body. |
| `COPILOT_API_MAX_ZSTD_OUTPUT_BYTES` | 104857600 | Max decompressed body. |
| `GH_TOKEN` | — | GitHub token source for `start` (keeps it out of argv). |
