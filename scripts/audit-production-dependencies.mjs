import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

// Plain Node scripts are linted with the TypeScript preset, which cannot infer
// JavaScript return types without converting the release entry point to TS.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function isTransientAuditFailure(output) {
  return /\b(?:EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|ENOTFOUND)\b|(?:HTTP\s*)?5\d\d\b|audit endpoint returned an error|service unavailable|socket hang up/i.test(
    output,
  );
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function runAudit() {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolveResult, reject) => {
    const child = spawn(
      executable,
      ["audit", "--omit=dev", "--audit-level=high"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolveResult({ code: code ?? 1, output, signal }),
    );
  });
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function auditProductionDependencies({
  maxAttempts = MAX_ATTEMPTS,
  retryDelayMs = RETRY_DELAY_MS,
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runAudit();
    if (result.code === 0) return 0;

    if (!isTransientAuditFailure(result.output) || attempt === maxAttempts) {
      return result.code;
    }

    const delay = retryDelayMs * attempt;
    console.error(
      `npm audit registry request failed transiently; retrying in ${delay / 1000}s (${attempt}/${maxAttempts}).`,
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
  }

  return 1;
}

const isCli =
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isCli) {
  process.exitCode = await auditProductionDependencies();
}
