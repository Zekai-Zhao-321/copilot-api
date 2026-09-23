FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS builder
WORKDIR /app

COPY ./package.json ./bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY ./src ./src
COPY ./pages ./pages
COPY ./tsconfig.json ./tsdown.config.ts ./
RUN bun run build

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runner
WORKDIR /app

COPY ./package.json ./bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts --no-cache

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/pages ./pages
COPY entrypoint.sh /entrypoint.sh

EXPOSE 4141

# Keep all mutable credentials, config, cache, logs, and usage data under one
# mountable path. The non-root runtime user owns the empty directory so Docker
# named volumes inherit safe write permissions on first use.
RUN mkdir -p /data/copilot-api /data/cache \
  && chown -R bun:bun /data \
  && chmod 0700 /data /data/copilot-api /data/cache \
  && sed -i 's/\r$//' /entrypoint.sh \
  && chmod 0555 /entrypoint.sh

# Published container ports require an internal non-loopback bind. The server
# therefore refuses to start until API-key auth has been configured.
ENV COPILOT_API_HOME=/data/copilot-api \
  HOME=/home/bun \
  HOST=0.0.0.0 \
  XDG_CACHE_HOME=/data/cache

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4141/ || exit 1

USER bun
ENTRYPOINT ["/entrypoint.sh"]
