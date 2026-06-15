# syntax=docker/dockerfile:1.7
#
# fiscode web — multi-stage Docker build for Dokploy.
#
#   stage 1 (deps):   bun install of the whole monorepo (workspaces)
#   stage 2 (build):  vite build → apps/web/dist
#   stage 3 (serve):  bun runs a Hono static server (apps/web/server.ts).
#                     SPA fallback + COOP/COEP/CORP on every response so the
#                     sqlite-wasm OPFS worker can be instantiated.
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

# Bundle the static server into a single file so the serve stage doesn't
# need to carry node_modules around. Hono is the only dep and it's tiny.
RUN cd apps/web && bun build server.ts --target=bun --outfile=server.js

# ----- serve ---------------------------------------------------------------
# oven/bun:alpine is small (~95 MB) and gives us a single runtime for the
# server + the same Bun used at build time. Hono is the only runtime dep.
FROM oven/bun:1.3.14-alpine AS serve
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Just the static bundle + the bundled server. No node_modules, no source.
COPY --from=build /repo/apps/web/server.js ./server.js
COPY --from=build /repo/apps/web/dist ./dist

EXPOSE 3001

CMD ["bun", "run", "server.js"]
