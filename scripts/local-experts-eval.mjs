#!/usr/bin/env node
import { spawnSync } from "node:child_process";

if (process.env.LOCAL_EXPERT_LIVE_EVAL === "1") {
  console.error(
    "Live Local Expert evals are not implemented yet. Unset LOCAL_EXPERT_LIVE_EVAL to run the deterministic offline suite.",
  );
  process.exit(2);
}

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "vitest",
    "run",
    "tests/local-expert-evals.test.ts",
    "tests/local-expert-google-docs-e2e.test.ts",
  ],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status ?? 1);
