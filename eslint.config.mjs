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
      // Honour the `_`-prefix convention used across the codebase for
      // deliberately-unused parameters/variables (e.g. unused args kept for
      // signature symmetry, or ignored caught errors).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // The 3D office (react-three-fiber) uses Three.js intrinsic elements whose
    // props (position, args, rotation, intensity, ...) are flagged by the
    // DOM-oriented `react/no-unknown-property` rule. Disable it here only.
    files: ["src/renderer/src/screens/Office/office3d/**/*.{ts,tsx}"],
    rules: {
      "react/no-unknown-property": "off",
      // Ported 3D art modules use many small internal helpers without explicit
      // return annotations; the renderer doesn't require them here.
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  eslintConfigPrettier,
);
