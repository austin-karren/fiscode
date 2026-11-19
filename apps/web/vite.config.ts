import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import sqlocal from "sqlocal/vite";
import { defineConfig, type Plugin } from "vite";

import { themeDetectorScript } from "../../packages/ui/src/lib/theme-script";

// Required for sqlite-wasm's OPFS sync-access VFS (and SharedArrayBuffer).
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Inlines the theme script into <head>, so the right theme class is on <html>
// before the first paint. An inline script (not a module) runs synchronously.
const themeScript = (): Plugin => ({
  name: "fiscode-theme-script",
  transformIndexHtml: () => [{ tag: "script", children: themeDetectorScript, injectTo: "head" }],
});

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
    themeScript(),
  ],
});
