import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Vite inlines MAIN_VITE_* into `import.meta.env` at BUILD time, so a dev edit
// to `.env` doesn't take effect until the main bundle is rebuilt. That makes
// the Hermes One API endpoint feel like it ignores the file (see
// getApiUrl/getApiKey in hermes-account.ts). Loading the project `.env` into
// process.env at startup lets those runtime reads reflect the file after a
// plain app relaunch — handy for pointing dev at a real backend.

/**
 * Parse the project-root `.env` (dev only) and copy its keys into process.env
 * without overwriting values already set in the real environment. No-ops when
 * the file is absent (packaged builds ship none). Best-effort: any read/parse
 * failure is swallowed so a malformed file can't block startup.
 */
export function loadDotEnvForDev(): void {
  const file = join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
