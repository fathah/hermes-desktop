/**
 * Personalization feature — IPC-facing layer (fs + HERMES_HOME).
 *
 * Edits the user's "make the agent mine" cluster on disk:
 *   - ~/.hermes/agent-hooks/focus.md           (daily-context the hook injects)
 *   - the pre_llm_call shell hook in config.yaml + its consent allowlist
 *
 * USER.md / MEMORY.md editing reuses memory.ts (writeUserProfile / writeMemory).
 * Pure logic (YAML/allowlist manipulation, path guard) lives in
 * ./personalization-core so it can be unit-tested without Electron.
 */
import { existsSync, readFileSync, statSync, chmodSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";
import { profilePaths, safeWriteFile } from "./utils";
import {
  HOOK_EVENT,
  resolveInsideDir,
  configHasHook,
  upsertHookInConfig,
  removeHookFromConfig,
  buildAllowlistEntry,
  upsertAllowlist,
  allowlistHasEntry,
  type AllowlistFile,
} from "./personalization-core";

const AGENT_HOOKS_DIR = join(HERMES_HOME, "agent-hooks");
const FOCUS_NAME = "focus.md";
const SCRIPT_NAME = "inject-daily-context.sh";
const SCRIPT_PATH = join(AGENT_HOOKS_DIR, SCRIPT_NAME);
const ALLOWLIST_PATH = join(HERMES_HOME, "shell-hooks-allowlist.json");
const HOOK_TIMEOUT = 10;

/** focus.md is injected into every turn — keep it short. */
export const FOCUS_CHAR_LIMIT = 600;

// Bundled hook script, written on first enable if missing. Assembled line-by-line
// so the bash `${...}` expansions are never seen as JS template interpolation.
const SCRIPT_CONTENT = [
  "#!/usr/bin/env bash",
  '# pre_llm_call shell hook: inject today\'s date + focus.md as {"context":...}.',
  '# Output {"context": "..."} to inject, or {} for no-op. Fails open.',
  "cat - >/dev/null",
  "today=\"$(date '+%A, %Y-%m-%d')\"",
  'focus_file="$HOME/.hermes/agent-hooks/focus.md"',
  'focus=""',
  '[[ -f "$focus_file" ]] && focus="$(cat "$focus_file")"',
  'ctx="Today is ${today}."',
  '[[ -n "$focus" ]] && ctx="${ctx}"$\'\\n\'"Current focus: ${focus}"',
  "jq --null-input --arg c \"$ctx\" '{context: $c}'",
  "",
].join("\n");

function nowISO(): string {
  return new Date().toISOString().replace(".000Z", "Z");
}

function scriptMtimeISO(path: string): string | null {
  try {
    return new Date(statSync(path).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

function readAllowlist(): Partial<AllowlistFile> {
  try {
    if (!existsSync(ALLOWLIST_PATH)) return { approvals: [] };
    const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : { approvals: [] };
  } catch {
    return { approvals: [] };
  }
}

/** Back up config.yaml once (first mutation) so a bad edit is recoverable. */
function backupConfigOnce(configFile: string, content: string): void {
  const bak = `${configFile}.bak.personalization`;
  try {
    if (!existsSync(bak)) safeWriteFile(bak, content);
  } catch {
    // best-effort
  }
}

// ── focus.md ────────────────────────────────────────────

export function readFocus(): string {
  try {
    const target = resolveInsideDir(AGENT_HOOKS_DIR, FOCUS_NAME);
    if (!target || !existsSync(target)) return "";
    return readFileSync(target, "utf-8");
  } catch {
    return "";
  }
}

export function writeFocus(content: string): {
  success: boolean;
  error?: string;
} {
  if (content.length > FOCUS_CHAR_LIMIT) {
    return {
      success: false,
      error: `Exceeds limit (${content.length}/${FOCUS_CHAR_LIMIT} chars)`,
    };
  }
  const target = resolveInsideDir(AGENT_HOOKS_DIR, FOCUS_NAME);
  if (!target) return { success: false, error: "Invalid focus.md path" };
  try {
    safeWriteFile(target, content);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ── daily-context hook ──────────────────────────────────

export interface DailyContextHookStatus {
  configured: boolean;
  allowlisted: boolean;
  scriptExists: boolean;
  enabled: boolean;
}

export function getDailyContextHookStatus(
  profile?: string,
): DailyContextHookStatus {
  const { configFile } = profilePaths(profile);
  let configured = false;
  try {
    if (existsSync(configFile)) {
      configured = configHasHook(
        readFileSync(configFile, "utf-8"),
        SCRIPT_PATH,
      );
    }
  } catch {
    /* ignore */
  }
  const allowlisted = allowlistHasEntry(
    readAllowlist(),
    HOOK_EVENT,
    SCRIPT_PATH,
  );
  const scriptExists = existsSync(SCRIPT_PATH);
  return {
    configured,
    allowlisted,
    scriptExists,
    enabled: configured && allowlisted && scriptExists,
  };
}

export function setDailyContextHookEnabled(
  enabled: boolean,
  profile?: string,
): { success: boolean; error?: string } {
  const { configFile } = profilePaths(profile);
  try {
    if (!existsSync(configFile)) {
      return {
        success: false,
        error: "config.yaml not found for this profile",
      };
    }
    const original = readFileSync(configFile, "utf-8");
    backupConfigOnce(configFile, original);

    if (enabled) {
      // 1. Ensure the hook script exists + is executable.
      if (!existsSync(SCRIPT_PATH)) {
        safeWriteFile(SCRIPT_PATH, SCRIPT_CONTENT);
      }
      try {
        chmodSync(SCRIPT_PATH, 0o755);
      } catch {
        /* non-POSIX fs */
      }
      // 2. Register the hook in config.yaml (real YAML lib; idempotent).
      const updated = upsertHookInConfig(original, SCRIPT_PATH, HOOK_TIMEOUT);
      if (updated !== original) safeWriteFile(configFile, updated);
      // 3. Write the consent allowlist entry the gateway honors at startup.
      const entry = buildAllowlistEntry(
        SCRIPT_PATH,
        nowISO(),
        scriptMtimeISO(SCRIPT_PATH),
      );
      const next = upsertAllowlist(readAllowlist(), entry);
      safeWriteFile(ALLOWLIST_PATH, JSON.stringify(next, null, 2));
    } else {
      // Remove from config; leave script + allowlist so re-enable is instant.
      const updated = removeHookFromConfig(original, SCRIPT_PATH);
      if (updated !== original) safeWriteFile(configFile, updated);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
