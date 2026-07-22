import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const DREI_FILE = "@react-three_drei.js";
const WAIT_MS = 120_000;

/**
 * Delay the first HTML response until `@react-three/drei` is pre-bundled.
 * electron-vite opens Electron while Vite is still optimizing; an early page
 * load races the optimizer and can leave `@react-three_drei.js` missing.
 * @lat [[main-process#Dev Vite loading]]
 */
export function waitForDreiPrebundle(): Plugin {
  return {
    name: "hermes:wait-for-drei-prebundle",
    apply: "serve",
    configureServer(server) {
      const client = server.environments.client;
      const optimizer = client.depsOptimizer;
      if (!optimizer) return;

      let ready: Promise<void> | undefined;

      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        const pathname = (req.url ?? "/").split("?")[0] ?? "/";
        const isDocument = pathname === "/" || pathname.startsWith("/index.html");
        if (!isDocument) {
          next();
          return;
        }

        ready ??= waitForDreiFile(client.config.cacheDir, optimizer);
        void ready.then(
          () => next(),
          (err: unknown) =>
            next(err instanceof Error ? err : new Error(String(err))),
        );
      });
    },
  };
}

async function waitForDreiFile(
  cacheDir: string,
  optimizer: NonNullable<
    import("vite").DevEnvironment["depsOptimizer"]
  >,
): Promise<void> {
  await optimizer.init();
  const scanProcessing = (
    optimizer as typeof optimizer & { scanProcessing?: Promise<void> }
  ).scanProcessing;
  if (scanProcessing) await scanProcessing;

  const filePath = path.join(cacheDir, "deps", DREI_FILE);
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 1_000_000) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `@react-three/drei pre-bundle missing after ${WAIT_MS / 1000}s. Run: npm run dev:clean`,
  );
}
