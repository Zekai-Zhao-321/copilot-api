FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY ./src ./src
COPY ./pages ./pages
COPY ./tsconfig.json ./tsdown.config.ts ./
RUN bun run build

FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS runner
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts --no-cache

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/pages ./pages
COPY entrypoint.sh /entrypoint.sh

RUN mkdir -p /data/copilot-api /data/cache \
  && chown -R bun:bun /data \
  && chmod 0700 /data /data/copilot-api /data/cache \
  && sed -i 's/\r$//' /entrypoint.sh \
  && chmod 0555 /entrypoint.sh

ENV NODE_ENV=production \
  NODE_USE_SYSTEM_CA=1 \
  COPILOT_API_HOME=/data/copilot-api \
  HOME=/home/bun \
  HOST=0.0.0.0 \
  XDG_CACHE_HOME=/data/cache

USER bun
VOLUME ["/data"]
EXPOSE 4141

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD ["wget", "--spider", "-q", "-T", "4", "-Y", "off", "http://127.0.0.1:4141/"]

ENTRYPOINT ["/entrypoint.sh"]
