import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { LogHandlerWithDefault, RollupLog } from "rollup";

const mixedDynamicStaticImportModules = [
  "src/main/db.ts",
  "src/main/note-index.ts",
  "src/main/skills.ts",
  "src/main/hermes/chat-client.ts",
  "src/main/memory.ts",
  "src/main/tools.ts",
];

const isKnownMixedImportWarning = (log: RollupLog): boolean =>
  log.message.includes("is dynamically imported by") &&
  log.message.includes("but also statically imported by") &&
  log.message.includes(
    "dynamic import will not move module into another chunk",
  ) &&
  mixedDynamicStaticImportModules.some((modulePath) =>
    log.message.includes(modulePath),
  );

const onMainBuildLog: LogHandlerWithDefault = (level, log, handler) => {
  if (level === "warn" && isKnownMixedImportWarning(log)) return;
  handler(level, log);
};

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // node-mac-contacts is an optional, macOS-only native module loaded via
        // a guarded require in src/main/mac-contacts.ts; keep it external so the
        // bundler ignores it when it isn't installed.
        external: ["better-sqlite3", "pdfjs-dist", "node-mac-contacts"],
        onLog: onMainBuildLog,
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          askpass: resolve("src/preload/askpass.ts"),
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react()],
  },
});
