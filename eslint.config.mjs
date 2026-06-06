import { defineConfig } from "eslint/config";
import tseslint from "@electron-toolkit/eslint-config-ts";
import eslintConfigPrettier from "@electron-toolkit/eslint-config-prettier";
import eslintPluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import eslintPluginReactRefresh from "eslint-plugin-react-refresh";

export default defineConfig(
  {
    ignores: [
      "**/node_modules",
      "**/dist",
      "**/out",
      ".claude/**",
      ".agents/**",
      "build/**",
      // Bundled MCP server output (esbuild via the `build:mcp` script). A
      // generated, git-ignored single-file CJS bundle — not our source to lint.
      "resources/*.cjs",
      // Vendored Tesseract.js WASM glue (worker.min.js / *-core*.wasm.js),
      // fetched into public/ at build time by scripts/fetch-ocr-assets.mjs and
      // git-ignored. Third-party minified artifacts — not our source to lint.
      "src/renderer/public/tesseract/**",
      // Standalone SPS Agent app + its design reference: separate sub-projects
      // with their own tooling. The integrated copy under
      // src/renderer/src/screens/SpsAgent IS linted.
      "sps-agent/**",
      "sps-agent-prototype/**",
      // CDP E2E harness — plain Node CommonJS scripts driving the
      // dev electron via Chrome DevTools Protocol for live testing.
      // They intentionally use require() because they run as one-off
      // `node scripts/*.js` invocations outside the TS build, and
      // they're not part of the shipped app. See scripts/README.md.
      "scripts/e2e-attach.js",
      "scripts/repro-*.js",
      "scripts/probe-*.js",
      "scripts/drive-*.js",
      "scripts/verify-*.js",
      // One-off build utility (plain JS): scopes the SPS Agent CSS under .sps-scope.
      "scripts/scope-sps-css.mjs",
    ],
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat["jsx-runtime"],
  {
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": eslintPluginReactHooks,
      "react-refresh": eslintPluginReactRefresh,
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // The integrated SPS Agent workspace is a faithful port of a React-idiomatic
    // app (inferred return types). Relax the explicit-return-type rule for it
    // rather than annotating ~110 components/handlers.
    files: ["src/renderer/src/screens/SpsAgent/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  {
    // Plain-JS build/smoke scripts (.mjs/.cjs/.js): explicit-function-return-type
    // is a TypeScript-only rule that cannot be satisfied without type annotations,
    // which aren't valid JavaScript. Other rules still apply.
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  eslintConfigPrettier,
);
