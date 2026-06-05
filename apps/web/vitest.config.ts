import { defineConfig } from "vitest/config";
import viteReact from "@vitejs/plugin-react";

// `viteReact` is typed against vite@8; vitest pulls vite@7 internally. The
// runtime shape is compatible — cast away the structural type drift.
export default defineConfig({
  plugins: [viteReact() as never],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
