import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "child_process";
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

function execOptions(
  secretKey: string,
  input?: string,
): ExecFileSyncOptionsWithStringEncoding {
  return {
    // Key name passed as DATA via env — never interpolated into the command.
    env: { ...process.env, HERMES_SECRET_KEY: secretKey },
    // The value (write) goes on stdin ONLY. undefined for delete.
    input,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    encoding: "utf-8",
    // Pipe + discard the helper's stderr: it can echo the value back, so it
    // must never stream into the Electron main process's inherited stderr.
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  };
}

/** Coerce a child-process error into a structured, secret-free reason. */
function failReason(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { status?: number; signal?: string };
  if (e.signal === "SIGTERM") return "timeout";
  if (e.code === "ENOENT") return "helper-not-found";
  return `exit-${e.status ?? e.code ?? "unknown"}`;
}

/**
 * A valid env-var-style key name. Enforced on WRITE/DELETE (not just non-empty)
 * so a name containing a newline or `=` can't inject a forged `KEY=VALUE` line
 * into a dotenv-dumping read helper's output (cross-key poisoning) or a `\n`
 * into a log line. Mirrors the shape the read parser treats as a key.
 */
const VALID_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Write/update one secret in the vault via `secrets.command_write`.
 * The value is delivered on the helper's stdin and never logged. Returns
 * { ok:false, error } on any failure — the error string is coarse and
 * secret-free.
 */
export function commandWriteSecret(
  key: string,
  value: string,
  profile?: string,
): MutationResult {
  const command = writeHelper(profile);
  if (!command) return { ok: false, error: "no-write-helper" };
  if (!VALID_KEY_NAME.test(key)) return { ok: false, error: "bad-key" };
  try {
    execFileSync("/bin/sh", ["-c", command], execOptions(key, value));
    return { ok: true };
  } catch (err) {
    console.warn(`[secrets:command] write(${key}) failed: ${failReason(err)}`);
    return { ok: false, error: failReason(err) };
  }
}

/**
 * Delete one secret from the vault via `secrets.command_delete`.
 * The key NAME goes via env; nothing is fed on stdin. Returns { ok:false }
 * on any failure.
 */
export function commandDeleteSecret(
  key: string,
  profile?: string,
): MutationResult {
  const command = deleteHelper(profile);
  if (!command) return { ok: false, error: "no-delete-helper" };
  if (!VALID_KEY_NAME.test(key)) return { ok: false, error: "bad-key" };
  try {
    execFileSync("/bin/sh", ["-c", command], execOptions(key));
    return { ok: true };
  } catch (err) {
    console.warn(`[secrets:command] delete(${key}) failed: ${failReason(err)}`);
    return { ok: false, error: failReason(err) };
  }
}
