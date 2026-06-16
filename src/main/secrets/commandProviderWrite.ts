import { spawn } from "child_process";
import { getConfigValue } from "../config";

/**
 * Write/delete side of the `command` secrets provider — OPT-IN, user-configured
 * helpers that mutate the backing vault. Read resolution lives in
 * commandProvider.ts; this module is its mirror image for writes.
 *
 * Security model (mirrors the read helper, with the value-handling tightened):
 *   - The command templates (`secrets.command_write` / `secrets.command_delete`)
 *     are the USER'S OWN config (same trust level as their .env / read helper),
 *     so they run via `sh -c <command>`.
 *   - The key NAME is passed ONLY via the `HERMES_SECRET_KEY` env var — never
 *     interpolated into the shell string, so a hostile key name is inert data.
 *   - The new VALUE (write only) is fed to the helper exclusively on **stdin**
 *     (like a password prompt). It is NEVER placed in argv, never in the shell
 *     string, never in the env. A value cannot leak via `ps`, argv, or the
 *     command string.
 *   - Hard timeout + output cap; failures return { ok:false } and log ONLY
 *     structured fields (exit code / signal) — never the value, command, or
 *     helper stderr (which can echo the value back).
 *   - POSIX-only (`/bin/sh`), same as the read helper.
 *
 * ASYNC (AIR-016): runs via `spawn` so a slow vault write never freezes the
 * Electron main thread. NOTE: `execFile`/`execFileSync` accept an `input`
 * option for stdin, but the async `execFile` does NOT honor `input` — so we use
 * `spawn` and write the value to `child.stdin` explicitly. This keeps the
 * value-on-stdin invariant intact in the non-blocking path.
 */
const COMMAND_TIMEOUT_MS = 5_000; // writes can be a touch slower than reads
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface MutationResult {
  ok: boolean;
  /** Coarse failure reason — never contains secret material. */
  error?: string;
}

function writeHelper(profile?: string): string | null {
  const cmd = getConfigValue("secrets.command_write", profile);
  return cmd && cmd.trim() !== "" ? cmd : null;
}

function deleteHelper(profile?: string): string | null {
  const cmd = getConfigValue("secrets.command_delete", profile);
  return cmd && cmd.trim() !== "" ? cmd : null;
}

/** Is a write helper configured? (capability probe; no vault contact) */
export function hasWriteHelper(profile?: string): boolean {
  return writeHelper(profile) !== null;
}

/** Is a delete helper configured? (capability probe; no vault contact) */
export function hasDeleteHelper(profile?: string): boolean {
  return deleteHelper(profile) !== null;
}

/**
 * A valid env-var-style key name. Enforced on WRITE/DELETE (not just non-empty)
 * so a name containing a newline or `=` can't inject a forged `KEY=VALUE` line
 * into a dotenv-dumping read helper's output (cross-key poisoning) or a `\n`
 * into a log line. Mirrors the shape the read parser treats as a key.
 */
const VALID_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Coerce a child-process failure into a structured, secret-free reason. */
function failReasonFromExit(
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  if (signal === "SIGTERM" || signal === "SIGKILL") return "timeout";
  return `exit-${code ?? "unknown"}`;
}

/**
 * Run the user's helper via `/bin/sh -c`, NON-BLOCKING. The key NAME is passed
 * as env data; the optional VALUE is written to stdin only. stderr is piped and
 * discarded (it can echo the value). Resolves { ok } — never throws, never logs
 * the value/command/stderr. A hung helper is killed at COMMAND_TIMEOUT_MS.
 */
function runHelper(
  command: string,
  secretKey: string,
  stdinValue: string | null,
): Promise<MutationResult> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      // Key name as inert env DATA — never interpolated into the command.
      env: { ...process.env, HERMES_SECRET_KEY: secretKey },
      // pipe stdin (value), pipe+discard stdout/stderr (stderr can echo value).
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let settled = false;
    let outBytes = 0;
    const finish = (r: MutationResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    // Hard timeout: kill a hung helper so it can never wedge the write path.
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      finish({ ok: false, error: "timeout" });
    }, COMMAND_TIMEOUT_MS);

    // Output cap: drain but bound memory; we never inspect the content.
    const capStream = (s: NodeJS.ReadableStream | null): void => {
      if (!s) return;
      s.on("data", (chunk: Buffer) => {
        outBytes += chunk.length;
        if (outBytes > MAX_OUTPUT_BYTES) {
          try {
            child.kill("SIGTERM");
          } catch {
            /* already gone */
          }
        }
      });
    };
    capStream(child.stdout);
    capStream(child.stderr);

    child.on("error", () => finish({ ok: false, error: "helper-not-found" }));
    child.on("close", (code, signal) => {
      if (code === 0) finish({ ok: true });
      else finish({ ok: false, error: failReasonFromExit(code, signal) });
    });

    // VALUE on stdin ONLY (write); delete passes null → just close stdin.
    if (child.stdin) {
      child.stdin.on("error", () => {
        /* EPIPE if helper exits before reading — surfaced via close handler */
      });
      if (stdinValue !== null) child.stdin.write(stdinValue);
      child.stdin.end();
    }
  });
}

/**
 * Write/update one secret in the vault via `secrets.command_write`.
 * The value is delivered on the helper's stdin and never logged. Returns
 * { ok:false, error } on any failure — the error string is coarse and
 * secret-free.
 */
export async function commandWriteSecret(
  key: string,
  value: string,
  profile?: string,
): Promise<MutationResult> {
  const command = writeHelper(profile);
  if (!command) return { ok: false, error: "no-write-helper" };
  if (!VALID_KEY_NAME.test(key)) return { ok: false, error: "bad-key" };
  const r = await runHelper(command, key, value);
  if (!r.ok) console.warn(`[secrets:command] write(${key}) failed: ${r.error}`);
  return r;
}

/**
 * Delete one secret from the vault via `secrets.command_delete`.
 * The key NAME goes via env; nothing is fed on stdin. Returns { ok:false }
 * on any failure.
 */
export async function commandDeleteSecret(
  key: string,
  profile?: string,
): Promise<MutationResult> {
  const command = deleteHelper(profile);
  if (!command) return { ok: false, error: "no-delete-helper" };
  if (!VALID_KEY_NAME.test(key)) return { ok: false, error: "bad-key" };
  const r = await runHelper(command, key, null);
  if (!r.ok)
    console.warn(`[secrets:command] delete(${key}) failed: ${r.error}`);
  return r;
}
