FROM oven/bun:1.3.14-slim AS deps

WORKDIR /app

RUN apt-get update && \
    apt-get install --no-install-recommends --yes python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Next.js standalone output is meant to run on Node.js. Running it with
# `bun server.js` crashes on Linux (NAPI FATAL ERROR from better-sqlite3),
# so the runtime stage uses the official Node.js image instead.
FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8001 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

RUN mkdir -p /app/.codebuddy_data /app/.codebuddy_creds && \
    chown -R node:node /app

USER node

EXPOSE 8001

CMD ["node", "server.js"]
