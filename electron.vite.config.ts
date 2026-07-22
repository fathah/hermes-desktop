import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { waitForDreiPrebundle } from "./scripts/vite-wait-for-drei";

const rendererPort = Number(process.env.HERMES_DESKTOP_RENDERER_PORT || 0);

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ["better-sqlite3"],
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
    ...(rendererPort > 0
      ? {
          server: {
            port: rendererPort,
            strictPort: false,
          },
        }
      : {}),
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
      dedupe: ["three"],
    },
    optimizeDeps: {
      include: [
        "@react-three/drei",
        "@react-three/fiber",
        "three",
        "troika-three-text",
        "three/examples/jsm/utils/SkeletonUtils.js",
      ],
    },
    plugins: [waitForDreiPrebundle(), tailwindcss(), react()],
  },
});
