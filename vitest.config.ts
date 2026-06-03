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
    setupFiles: ["./src/renderer/src/test/setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],
  },
});
