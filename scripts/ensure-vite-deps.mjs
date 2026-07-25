#!/usr/bin/env node
/**
 * Dev-only guard: Vite can leave a stale @react-three/drei pre-bundle (.map
 * without the .js) after an interrupted re-optimize, which 504s lazy Office loads.
 * Pass --force to always clear the cache (cross-platform `dev:clean`).
 */
import fs from "node:fs";
import path from "node:path";

const force = process.argv.includes("--force");
const cacheRoot = path.join("node_modules", ".vite");
const depsDir = path.join(cacheRoot, "deps");
const dreiJs = path.join(depsDir, "@react-three_drei.js");
const dreiMap = path.join(depsDir, "@react-three_drei.js.map");

if (force) {
  console.warn("[dev] Clearing Vite dep cache (--force)");
  fs.rmSync(cacheRoot, { recursive: true, force: true });
} else if (fs.existsSync(dreiMap) && !fs.existsSync(dreiJs)) {
  console.warn(
    "[dev] Removing corrupt Vite dep cache (@react-three_drei.js missing)",
  );
  fs.rmSync(cacheRoot, { recursive: true, force: true });
}
