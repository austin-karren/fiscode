import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import sqlocal from "sqlocal/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    port: 3001,
    headers: {
      // Required for sqlite-wasm's OPFS sync-access VFS (and SharedArrayBuffer).
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ["sqlocal"],
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    sqlocal(),
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      // Routes live under src/routes; output the tree next to them.
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    viteReact(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icon.svg"],
      // todo: replace placeholder icons before launch
      manifest: {
        name: "fiscode",
        short_name: "fiscode",
        description: "Local-only tax estimator and time tracker for 1099 / self-employed work.",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        // SPA shell precache; no runtime data API to cache.
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // The sqlite-wasm worker MUST hit the network so the Hono server's
        // COOP/COEP/CORP headers reach the browser. A precached Response can
        // arrive without those headers (especially if cached from a prior
        // nginx/Caddy deploy that didn't set them on /assets/) and the
        // COOP/COEP-isolated document then refuses to instantiate the worker.
        globIgnores: ["**/worker-*.js", "**/*-worker-*.js"],
        navigateFallback: "/index.html",
        // Take over open tabs as soon as a new SW activates, so a fresh
        // deploy isn't shadowed by a stale SW serving cache-without-headers.
        clientsClaim: true,
        skipWaiting: true,
        // Drop precaches from previous SW versions on activation so stale
        // worker-*.js entries from earlier deploys don't linger.
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
