# syntax=docker/dockerfile:1.7
#
# fiscode docs — multi-stage Docker build for Dokploy.
#
#   stage 1 (deps):    bun install of the monorepo workspaces
#   stage 2 (build):   vite build (TanStack Start + Nitro node-server preset)
#                      → apps/fumadocs/.output
#   stage 3 (runtime): node:slim runs `node .output/server/index.mjs`
#                      Static prerendered HTML + /api/search live in .output.
#
# Build context MUST be the repo root. Dokploy: set "Build context" to the
# repo root and "Dockerfile" to apps/fumadocs/Dockerfile.

# ----- deps ----------------------------------------------------------------
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /repo

COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/fumadocs/package.json apps/fumadocs/
COPY apps/desktop/package.json apps/desktop/
COPY packages/core/package.json packages/core/
COPY packages/tax/package.json packages/tax/
COPY packages/csv/package.json packages/csv/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/

RUN bun install --frozen-lockfile

# ----- build ---------------------------------------------------------------
FROM oven/bun:1.3.14-alpine AS build
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/fumadocs/node_modules ./apps/fumadocs/node_modules

COPY . .

RUN cd apps/fumadocs && bun run build

# ----- runtime -------------------------------------------------------------
# node:22-slim is small (~70 MB) and ships a TLS-capable Node. Nitro's
# node-server output is plain ESM — no native deps to compile here.
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Nitro listens on $PORT (defaults to 3000). Dokploy will route :443 → :3000.
ENV PORT=3000
ENV HOST=0.0.0.0

# `.output/` is fully self-contained: server + public/ + node_modules.
COPY --from=build /repo/apps/fumadocs/.output ./

EXPOSE 3000

CMD ["node", "./server/index.mjs"]
