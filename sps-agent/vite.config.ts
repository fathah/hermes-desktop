/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { unfurlPlugin } from "./vite-plugins/unfurl";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Hermes assistant proxy: forwards /v1/* to a locally-running Hermes
  // OpenAI-compatible API server so the browser never holds a key.
  const hermesTarget = env.VITE_HERMES_BASE_URL || "http://localhost:8000";
  return {
    plugins: [react(), unfurlPlugin()],
    server: {
      proxy: {
        "/v1": { target: hermesTarget, changeOrigin: true },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./test/setup.ts",
      css: false,
    },
  };
});
