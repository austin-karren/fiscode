// fiscode web — static file server for the Vite SPA bundle.
//
// Runs on Bun, uses Hono for routing. Responsibilities:
//   1. Serve `dist/` with a SPA fallback to /index.html so TanStack Router's
//      client-side routes work on direct visits and reloads.
//   2. Set COOP/COEP/CORP on every response — required by sqlite-wasm's
//      OPFS sync-access VFS (and SharedArrayBuffer in general). Setting
//      them in middleware avoids the per-path drift that bit us with
//      nginx (`add_header` doesn't cascade) and Caddy.
//   3. Long-cache hashed assets. Never store the HTML document, whatever
//      URL it was served at, so deploys roll out on the next navigation.
//   4. Answer 404 for a file that does not exist. Only extension-less
//      paths (client routes) fall back to the document: a stale chunk URL
//      after a deploy must not come back as cacheable HTML.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const PORT = Number(process.env.PORT ?? 3001);
const HOSTNAME = "0.0.0.0";

const IMMUTABLE = "public, max-age=31536000, immutable";

// "/income" is a client route; "/missing.png" names a file.
const namesAFile = (path: string) => (path.split("/").pop() ?? "").includes(".");

/** The app, without a port. `dist` is the built bundle's folder. */
export function createApp(dist = "./dist") {
  const app = new Hono();

  // Cross-origin isolation + defensive defaults on every response.
  app.use("*", async (c, next) => {
    await next();
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Embedder-Policy", "require-corp");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    // The entry HTML is not hashed. It is the same document at "/",
    // "/index.html" and every client route; never store any of them.
    if (c.res.headers.get("Content-Type")?.startsWith("text/html")) {
      c.header("Cache-Control", "no-store");
    }
  });

  // Health probe for orchestrators (Dokploy, Railway, etc.).
  app.get("/healthz", (c) => c.text("ok"));

  // Vite emits content-hashed filenames under /assets: safe to cache forever,
  // but only when the file is there. A miss is a 404 with no cache header.
  app.use(
    "/assets/*",
    serveStatic({ root: dist, onFound: (_path, c) => c.header("Cache-Control", IMMUTABLE) }),
  );
  app.all("/assets/*", (c) => c.notFound());

  // Other static files, then the SPA fallback for client routes only.
  app.use("/*", serveStatic({ root: dist }));
  app.get("/*", async (c, next) => (namesAFile(c.req.path) ? c.notFound() : next()));
  app.get("/*", serveStatic({ root: dist, path: "index.html" }));

  return app;
}

if (import.meta.main) {
  console.log(`[fiscode-web] listening on http://${HOSTNAME}:${PORT}`);
}

export default {
  port: PORT,
  hostname: HOSTNAME,
  fetch: createApp().fetch,
};
