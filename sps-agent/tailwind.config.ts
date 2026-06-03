import type { Config } from "tailwindcss";

/**
 * Tailwind is intentionally minimal here. The SPS "Sukhi" design system lives in
 * src/styles/*.css (ported verbatim from the prototype) and is the source of truth.
 *
 * - `preflight` is DISABLED so Tailwind's reset never fights the hand-tuned CSS.
 * - The theme below only *mirrors* the existing CSS variables so that any net-new
 *   scaffolding written with utilities resolves to the exact same tokens.
 *
 * Do NOT re-express ported components as utility classes — emit the original class
 * names (.rail, .block, .db-tab, …); the ported CSS keys off them.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // semantic runtime vars (home.css :root / [data-theme])
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        sunk: "var(--sunk)",
        appbg: "var(--app-bg)",
        hair: "var(--hair)",
        "hair-soft": "var(--hair-soft)",
        "hair-strong": "var(--hair-strong)",
        "tx-1": "var(--tx-1)",
        "tx-2": "var(--tx-2)",
        "tx-3": "var(--tx-3)",
        "tx-4": "var(--tx-4)",
        "row-hover": "var(--row-hover)",
        "row-sel": "var(--row-sel)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        "accent-text": "var(--accent-text)",
      },
      fontFamily: {
        sans: "var(--font-sans)",
        serif: "var(--font-serif)",
        mono: "var(--font-mono)",
      },
      boxShadow: {
        pop: "var(--shadow-pop)",
        menu: "var(--shadow-menu)",
      },
    },
  },
  plugins: [],
} satisfies Config;
