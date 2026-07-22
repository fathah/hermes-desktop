#!/usr/bin/env node
/**
 * Dev-only guard: Vite can leave a stale @react-three/drei pre-bundle (.map
 * without the .js) after an interrupted re-optimize, which 504s lazy Office loads.
 */
import fs from "node:fs";
import path from "node:path";

const cacheRoot = path.join("node_modules", ".vite");
const depsDir = path.join(cacheRoot, "deps");
const dreiJs = path.join(depsDir, "@react-three_drei.js");
const dreiMap = path.join(depsDir, "@react-three_drei.js.map");

if (fs.existsSync(dreiMap) && !fs.existsSync(dreiJs)) {
  console.warn(
    "[dev] Removing corrupt Vite dep cache (@react-three_drei.js missing)",
  );
  fs.rmSync(cacheRoot, { recursive: true, force: true });
}
