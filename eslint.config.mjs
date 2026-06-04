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
  eslintConfigPrettier,
);
