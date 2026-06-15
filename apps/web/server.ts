// fiscode web — Hono static server (runs on Bun).
//
// Three load-bearing pieces, same as the previous nginx/Caddy attempts:
//   1. SPA fallback: every non-asset request returns /index.html so
//      TanStack Router's client-side routing works on direct visits.
//   2. COOP/COEP/CORP: required by sqlite-wasm's OPFS sync-access VFS (and
//      SharedArrayBuffer in general). Set on EVERY response (HTML, assets,
//      workers, manifest) so the COOP/COEP-isolated document can use the
//      bundled `worker-*.js`. This is the exact thing nginx silently
//      dropped for /assets/ — keeping it explicit in code avoids that.
//   3. Long-cache for hashed assets, no-cache for HTML/SW/manifest.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const DIST = "./dist";
const PORT = Number(process.env.PORT ?? 80);

const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

const app = new Hono();

// Apply isolation + defensive headers to every response.
app.use("*", async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(ISOLATION_HEADERS)) {
    c.header(k, v);
  }
});

// Cache-Control by path. Hashed assets get a year + immutable; anything that
// updates on each deploy gets no-store so PWA users see new builds promptly.
app.use("/assets/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "public, max-age=31536000, immutable");
});
app.use(
  "/index.html",
  "/sw.js",
  "/registerSW.js",
  "/manifest.webmanifest",
  async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  },
);

// Orchestrator health probe.
app.get("/healthz", (c) => c.text("ok"));

// Static files first.
app.use("/*", serveStatic({ root: DIST }));

// SPA fallback — anything that didn't match a static file becomes /index.html
// so client-side routes (TanStack Router) work on direct visits and reloads.
app.get("/*", serveStatic({ path: `${DIST}/index.html` }));

export default {
  port: PORT,
  fetch: app.fetch,
};
