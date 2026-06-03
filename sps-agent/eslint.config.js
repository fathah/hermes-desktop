import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // This app is a faithful port of an imperative contentEditable block editor.
      // The React-Compiler-oriented hooks rules below fight patterns that are
      // intentional and correct here, so they are tuned rather than worked around:
      //   - immutability: we mutate contentEditable DOM through refs (el.innerHTML)
      //   - set-state-in-effect: menus/selection reset on a prop change (query)
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      // allow `cond && fn()` and `export const FOO = [...]` alongside components
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
]);
