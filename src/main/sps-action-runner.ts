// sps-action-runner.ts — safe execution of SPS "button block" actions.
//
// SECURITY: the renderer used to send raw {type:"shell", command} payloads that
// the main process ran via `exec(command, …)` (implicit shell). That turned any
// renderer escape (e.g. the C3 RSS stored-XSS) into arbitrary command execution
// in the user's home. This module reuses the autonomy allowlist
// (`isCommandSafe`) and runs ONLY proven-safe, read-only commands via
// `execFile` with `shell:false`, parsing the command into argv ourselves so no
// shell ever interprets it.
//
// Pure-ish + dependency-light so the policy is unit-testable; the IPC layer in
// ipc/sps.ts is a thin wrapper that supplies the vault cwd.
import { execFile } from "child_process";
import { realpath } from "fs/promises";
import { isAbsolute, relative, resolve } from "path";
import { fetch as undiciFetch } from "undici";
import { isCommandSafe } from "./autonomy";
import { guardedAgent } from "./sps-agent";

export interface ActionOutcome {
  success: boolean;
  output?: string;
  error?: string;
}

const SHELL_TIMEOUT_MS = 15_000;
const API_TIMEOUT_MS = 15_000;
const API_MAX_BYTES = 1024 * 1024;
const VAULT_SCOPED_READ_BINARIES = new Set([
  "cat",
  "head",
  "tail",
  "grep",
  "rg",
  "wc",
  "stat",
  "file",
  "du",
]);
const SEARCH_OPTION_FLAGS_WITH_VALUE = new Set([
  "-A",
  "-B",
  "-C",
  "-m",
  "--after-context",
  "--before-context",
  "--context",
  "--max-count",
]);
const HEAD_TAIL_OPTION_FLAGS_WITH_VALUE = new Set([
  "-c",
  "-n",
  "--lines",
  "--bytes",
]);
const BLOCKED_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authorization",
  "x-forwarded-for",
  "forwarded",
  "connection",
  "transfer-encoding",
  "content-length",
]);

/**
 * Split a command string into argv WITHOUT a shell. Only reached after
 * `isCommandSafe` has already rejected metacharacters, so plain whitespace
 * splitting is safe here. Empty fields are dropped.
 */
function tokenize(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function optionFlagsWithValue(binary: string): Set<string> {
  if (binary === "grep" || binary === "rg")
    return SEARCH_OPTION_FLAGS_WITH_VALUE;
  if (binary === "head" || binary === "tail")
    return HEAD_TAIL_OPTION_FLAGS_WITH_VALUE;
  return new Set();
}

function positionalArgs(binary: string, args: string[]): string[] {
  const valueFlags = optionFlagsWithValue(binary);
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      out.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("-")) {
      if (valueFlags.has(arg)) i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function pathOperands(binary: string, args: string[]): string[] {
  if (!VAULT_SCOPED_READ_BINARIES.has(binary)) return [];
  const positional = positionalArgs(binary, args);
  if (binary === "grep" || binary === "rg") {
    return positional.slice(1);
  }
  return positional;
}

function isWithinPath(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

async function validateVaultScopedPaths(
  binary: string,
  args: string[],
  cwd: string,
): Promise<string | null> {
  const operands = pathOperands(binary, args);
  if (operands.length === 0) return null;
  let vaultRoot: string;
  try {
    vaultRoot = await realpath(cwd);
  } catch {
    return "Vault path is unavailable";
  }
  for (const operand of operands) {
    try {
      const candidate = isAbsolute(operand)
        ? operand
        : resolve(vaultRoot, operand);
      const target = await realpath(candidate);
      if (!isWithinPath(vaultRoot, target)) {
        return `Path is outside the vault: ${operand}`;
      }
    } catch {
      return `Path is outside the vault or unavailable: ${operand}`;
    }
  }
  return null;
}

/**
 * Run an allowlisted, read-only shell command in `cwd` without a shell.
 * Never throws — returns a failure outcome so the IPC handler can relay it.
 */
export function runShellAction(
  command: string | undefined,
  cwd: string,
): Promise<ActionOutcome> {
  const cmd = (command ?? "").trim();
  if (!cmd) {
    return Promise.resolve({ success: false, error: "Empty command string" });
  }
  if (!isCommandSafe(cmd)) {
    return Promise.resolve({
      success: false,
      error:
        "Command is not on the read-only allowlist (unsafe binary, shell metacharacter, or mutating subcommand).",
    });
  }

  const [binary, ...args] = tokenize(cmd);
  return validateVaultScopedPaths(binary, args, cwd).then((pathError) => {
    if (pathError) {
      return { success: false, error: pathError };
    }
    return new Promise<ActionOutcome>((resolve) => {
      execFile(
        binary,
        args,
        {
          cwd,
          shell: false,
          timeout: SHELL_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              success: false,
              output: stdout.toString(),
              error: stderr.toString() || error.message,
            });
          } else {
            resolve({ success: true, output: stdout.toString() });
          }
        },
      );
    });
  });
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers must be a JSON object");
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    const normalized = name.trim().toLowerCase();
    if (!normalized || BLOCKED_HEADER_NAMES.has(normalized)) {
      throw new Error(`Header is not allowed: ${name}`);
    }
    if (/[\0\r\n:]/.test(name)) {
      throw new Error(`Invalid header name: ${name}`);
    }
    if (typeof value !== "string" || /[\0\r\n]/.test(value)) {
      throw new Error(`Invalid header value for ${name}`);
    }
    headers[name] = value;
  }
  return headers;
}

/**
 * Run a guarded GET action. The URL goes through the existing SSRF-hardened
 * IP-pinning dispatcher, every redirect hop is re-validated, and the response
 * body is capped so a button block cannot stream unbounded data into memory.
 */
export async function runApiAction(
  url: string | undefined,
  headersJson?: string,
): Promise<ActionOutcome> {
  const rawUrl = (url ?? "").trim();
  if (!rawUrl) {
    return { success: false, error: "Empty API URL string" };
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch (err) {
    return {
      success: false,
      error: `Invalid API URL: ${(err as Error).message}`,
    };
  }
  if (!/^https?:$/.test(target.protocol)) {
    return { success: false, error: "Only http(s) API URLs are allowed" };
  }

  let headers: Record<string, string>;
  try {
    headers = parseHeaders(headersJson);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  try {
    const response = await undiciFetch(target.href, {
      method: "GET",
      headers,
      dispatcher: guardedAgent,
      redirect: "follow",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    if (reader) {
      try {
        while (bytesRead < API_MAX_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const remaining = API_MAX_BYTES - bytesRead;
          chunks.push(
            value.byteLength > remaining ? value.slice(0, remaining) : value,
          );
          bytesRead += Math.min(value.byteLength, remaining);
        }
      } finally {
        reader.releaseLock();
      }
    }

    const output = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
    ).toString("utf-8");
    if (response.status < 400) {
      return { success: true, output };
    }
    return {
      success: false,
      output,
      error: `Gateway returned status code ${response.status}`,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
