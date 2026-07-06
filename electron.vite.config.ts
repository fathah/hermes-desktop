import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
      // Ensure a single Three.js instance across our code, @react-three/fiber,
      // drei and troika — multiple copies break `instanceof THREE.*` checks in
      // the ported office agent renderer.
      dedupe: ["three"],
    },
    plugins: [tailwindcss(), react()],
  },
});
