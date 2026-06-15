# syntax=docker/dockerfile:1.7
#
# fiscode web — multi-stage Docker build for Dokploy.
#
#   stage 1 (deps):   bun install of the whole monorepo (workspaces)
#   stage 2 (build):  vite build → apps/web/dist
#   stage 3 (serve):  nginx:alpine serves dist with SPA fallback + COOP/COEP
#                     headers (required by sqlite-wasm OPFS).
#
# Build context MUST be the repo root (NOT apps/web/), so the build has access
# to the workspaces. Dokploy: set "Build context" to the repo root and
# "Dockerfile" to apps/web/Dockerfile.

# ----- deps ----------------------------------------------------------------
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /repo

# Copy lockfile + every package.json so bun can install the workspace graph
# without invalidating cache on every source change.
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

# Reuse installed node_modules from the deps stage.
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules

# Now bring in the source tree. .dockerignore excludes dist/, .turbo/, etc.
COPY . .

# Allow the docs site URL to be configured at build time (baked into the bundle).
ARG VITE_DOCS_URL=https://docs.fiscode.app
ENV VITE_DOCS_URL=${VITE_DOCS_URL}
# Optional remote tax-data mirror; if unset the app falls back to bundled
# config and silently logs misses at console.debug.
ARG VITE_TAX_DATA_BASE_URL
ENV VITE_TAX_DATA_BASE_URL=${VITE_TAX_DATA_BASE_URL}

RUN cd apps/web && bun run build

# ----- serve ---------------------------------------------------------------
FROM nginx:1.29-alpine AS serve

# COOP/COEP headers + SPA fallback config.
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine's default CMD does the right thing (daemon off, foreground).
