// fiscode web — static file server for the Vite SPA bundle.
//
// Runs on Bun, uses Hono for routing. Responsibilities:
//   1. Serve `dist/` with a SPA fallback to /index.html so TanStack Router's
//      client-side routes work on direct visits and reloads.
//   2. Set COOP/COEP/CORP on every response — required by sqlite-wasm's
//      OPFS sync-access VFS (and SharedArrayBuffer in general). Setting
//      them in middleware avoids the per-path drift that bit us with
//      nginx (`add_header` doesn't cascade) and Caddy.
//   3. Long-cache hashed assets, no-cache `index.html` so deploys roll out
//      immediately.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const DIST = "./dist";
const PORT = Number(process.env.PORT ?? 3001);
const HOSTNAME = "0.0.0.0";

const app = new Hono();

// Cross-origin isolation + defensive defaults on every response.
app.use("*", async (c, next) => {
  await next();
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Embedder-Policy", "require-corp");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

// Vite emits content-hashed filenames under /assets — safe to cache forever.
app.use("/assets/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "public, max-age=31536000, immutable");
});

// The entry HTML is not hashed; never cache it so deploys take effect on
// the next navigation.
app.use("/index.html", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

// Health probe for orchestrators (Dokploy, Railway, etc.).
app.get("/healthz", (c) => c.text("ok"));

// Static files, then SPA fallback for everything else.
app.use("/*", serveStatic({ root: DIST }));
app.get("/*", serveStatic({ path: `${DIST}/index.html` }));

console.log(`[fiscode-web] listening on http://${HOSTNAME}:${PORT}`);

export default {
  port: PORT,
  hostname: HOSTNAME,
  fetch: app.fetch,
};
