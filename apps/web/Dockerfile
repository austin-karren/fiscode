# syntax=docker/dockerfile:1.7
#
# fiscode web — multi-stage Docker build for Dokploy.
#
#   stage 1 (deps):   bun install of the whole monorepo (workspaces)
#   stage 2 (build):  vite build → apps/web/dist
#   stage 3 (serve):  caddy:alpine serves dist with SPA fallback + COOP/COEP
#                     headers (required by sqlite-wasm OPFS). Caddy's global
#                     `header` directive applies to every response, including
#                     bundled workers — nginx's add_header doesn't cascade.
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

# --ignore-scripts skips better-sqlite3's native gyp build (used only in tests
# via @fiscode/db/test). The web bundle uses sqlite-wasm at runtime.
RUN bun install --frozen-lockfile --ignore-scripts

# ----- build ---------------------------------------------------------------
FROM oven/bun:1.3.14-alpine AS build
WORKDIR /repo

# Reuse the entire installed tree from the deps stage (root + every
# packages/*/node_modules — bun puts workspace-local deps under each package).
COPY --from=deps /repo /repo

# Overlay the source tree. .dockerignore excludes dist/, .turbo/, and
# node_modules, so this won't clobber what we just copied.
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
FROM caddy:2.10-alpine AS serve

# COOP/COEP headers + SPA fallback config.
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /usr/share/caddy

EXPOSE 80

# caddy:alpine's default CMD runs the Caddyfile at /etc/caddy/Caddyfile.
