import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import sqlocal from "sqlocal/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Required for sqlite-wasm's OPFS sync-access VFS (and SharedArrayBuffer).
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: {
    port: 3001,
    headers: ISOLATION_HEADERS,
  },
  preview: {
    headers: ISOLATION_HEADERS,
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
      // "prompt": a new deploy waits until the user presses Reload in the
      // update toast (src/lib/pwa-update.ts), so code is never swapped under
      // an open tab that holds unsaved form state.
      registerType: "prompt",
      // Registered from src/main.tsx through virtual:pwa-register.
      injectRegister: false,
      // Precached on top of the build output below; manifest icons are added
      // by the plugin.
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "fiscode",
        short_name: "fiscode",
        description:
          "A local-only tax estimator and time tracker for 1099 / self-employed work. Your data stays on your device.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // The app's dark background token; index.html's theme-color matches.
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app shell and every built asset, including the sqlite wasm and
        // its worker scripts, which the app needs to open the local database
        // offline. Cached responses keep their COOP/COEP headers.
        globPatterns: ["**/*.{js,css,html,wasm,woff2}"],
        // Any route reloads to the app shell when offline.
        navigateFallback: "index.html",
        // Tax data is never precached or cached at runtime: it always goes to
        // the network, and fails offline the way it does without a worker.
        navigateFallbackDenylist: [/^\/tax-data\//, /^\/healthz$/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
