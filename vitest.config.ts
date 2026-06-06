import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Use the automatic JSX runtime (matches tsconfig.web's "react-jsx") so test
  // files and components don't need an explicit `import React`.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer/src"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    // Generous timeouts so timing-sensitive RTL tests don't fail purely from CPU
    // starvation when the suite runs under load (e.g. alongside other worktrees /
    // builds on the same machine). Only matters when a test would otherwise time
    // out; the happy path is unaffected.
    testTimeout: 15000,
    hookTimeout: 15000,
    setupFiles: ["./src/renderer/src/test/setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],
  },
});
