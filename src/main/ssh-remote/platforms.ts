import type { CachedSession } from "../session-cache";
import type { SshConfig } from "../ssh-tunnel";
import { shellQuote, sshExec, sshReadFile, sshWriteFile } from "./core";
import { remoteConfigPath } from "./config";
import { sshListSessions } from "./sessions";

// Run a Hermes Kanban CLI subcommand over SSH and return a structured result.
export interface SshKanbanResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  stdout?: string;
}

export async function sshRunKanban<T = unknown>(
  config: SshConfig,
  args: string[],
  opts: { profile?: string; parseJson?: boolean; timeoutMs?: number } = {},
): Promise<SshKanbanResult<T>> {
  const cliArgs: string[] = [];
  if (opts.profile && opts.profile !== "default") {
    cliArgs.push("-p", opts.profile);
  }
  cliArgs.push("kanban", ...args);
  const cmd = buildRemoteHermesCmd(cliArgs);
  try {
    const stdout = await sshExec(
      config,
      cmd,
      undefined,
      opts.timeoutMs ?? 20000,
    );
    if (opts.parseJson) {
      try {
        return { success: true, data: JSON.parse(stdout) as T, stdout };
      } catch (err) {
        return {
          success: false,
          error: `Failed to parse JSON from remote 'hermes kanban': ${(err as Error).message}`,
          stdout,
        };
      }
    }
    return { success: true, stdout };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Remote kanban command failed",
    };
  }
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export async function sshReadLogs(
  config: SshConfig,
  logFile?: string,
  lines = 300,
): Promise<{ content: string; path: string }> {
  const allowed = ["agent.log", "errors.log", "gateway.log"];
  const file = logFile && allowed.includes(logFile) ? logFile : "agent.log";
  const remotePath = `$HOME/.hermes/logs/${file}`;
  try {
    const safeLines = Math.max(
      1,
      Math.min(5000, Number.parseInt(String(lines), 10) || 300),
    );
    const content = await sshExec(
      config,
      `bash -c 'case "$2" in "~/"*) p="$HOME/\${2#~/}" ;; "\\$HOME/"*) p="$HOME/\${2#\\$HOME/}" ;; *) p="$2" ;; esac; tail -n "$1" -- "$p" 2>/dev/null || echo ""' -- ${shellQuote(String(safeLines))} ${shellQuote(remotePath)}`,
    );
    return { content: content.trim(), path: `~/.hermes/logs/${file}` };
  } catch {
    return { content: "", path: `~/.hermes/logs/${file}` };
  }
}

// ── Platform toggles (Gateway page) ──────────────────────────────────────────

const SSH_SUPPORTED_PLATFORMS = [
  "discord",
  "slack",
  "whatsapp",
  "whatsapp_cloud",
  "signal",
  "matrix",
  "mattermost",
  "email",
  "sms",
  "bluebubbles",
  "dingtalk",
  "feishu",
  "wecom",
  "weixin",
  "webhooks",
  "home_assistant",
];

// Map from app platform keys to gateway_state.json keys (where they differ)
const PLATFORM_STATE_KEY: Record<string, string> = {
  home_assistant: "homeassistant",
};

export async function sshGetPlatformEnabled(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, boolean>> {
  void profile;
  try {
    const raw = await sshReadFile(config, "$HOME/.hermes/gateway_state.json");
    if (raw.trim()) {
      const state = JSON.parse(raw);
      const platforms = state.platforms || {};
      const result: Record<string, boolean> = {};
      for (const platform of SSH_SUPPORTED_PLATFORMS) {
        const stateKey = PLATFORM_STATE_KEY[platform] || platform;
        const p = platforms[stateKey];
        result[platform] = p
          ? p.state === "connected" || p.state === "running"
          : false;
      }
      return result;
    }
  } catch {
    // fall through
  }
  return Object.fromEntries(SSH_SUPPORTED_PLATFORMS.map((p) => [p, false]));
}

export async function sshSetPlatformEnabled(
  config: SshConfig,
  platform: string,
  enabled: boolean,
  profile?: string,
): Promise<void> {
  if (!SSH_SUPPORTED_PLATFORMS.includes(platform)) return;
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;

  let updated = content;
  const existingRe = new RegExp(
    `^([ \\t]+${platform}:\\s*\\n[ \\t]+enabled:\\s*)(?:true|false)`,
    "m",
  );

  if (existingRe.test(updated)) {
    updated = updated.replace(existingRe, `$1${enabled}`);
  } else {
    const platformsIdx = updated.indexOf("\nplatforms:");
    if (platformsIdx === -1) {
      updated += `\nplatforms:\n  ${platform}:\n    enabled: ${enabled}\n`;
    } else {
      const after = updated.substring(platformsIdx + 1);
      const lines = after.split("\n");
      let insertOffset = platformsIdx + 1 + lines[0].length + 1;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "" || /^\s/.test(lines[i]))
          insertOffset += lines[i].length + 1;
        else break;
      }
      const entry = `  ${platform}:\n    enabled: ${enabled}\n`;
      updated =
        updated.substring(0, insertOffset) +
        entry +
        updated.substring(insertOffset);
    }
  }

  await sshWriteFile(config, configPath, updated);
}

// ── Cached sessions (Sessions screen uses listCachedSessions) ─────────────────

export async function sshListCachedSessions(
  config: SshConfig,
  limit = 50,
  offset = 0,
): Promise<CachedSession[]> {
  void offset;
  const sessions = await sshListSessions(config, limit, 0);
  return sessions.map((s) => ({
    id: s.id,
    title: s.title || s.id,
    startedAt: s.startedAt,
    source: s.source,
    messageCount: s.messageCount,
    model: s.model,
  }));
}

// ── Doctor / diagnostics ──────────────────────────────────────────────────────

// Build a remote shell command that invokes the Hermes CLI, bypassing the
// common `/usr/local/bin/hermes` sudo-wrapper that production installs ship.
// That wrapper does `sudo -u hermes <venv>/bin/hermes "$@"`, and the sudoers
// policy refuses to let the hermes service user run it as itself ("Sorry,
// user hermes is not allowed to execute … as hermes"). The wrapper writes the
// refusal to stderr and exits non-zero, breaking `hermes doctor`,
// `hermes update`, `hermes dump`, and `hermes --version` when called over
// SSH as the hermes user.
//
// Probe the well-known venv install paths first; fall back to bare `hermes`
// on PATH only if none of those exist, preserving the old behavior for
// non-installer deployments.
//
// Each install base is probed with both `.venv` and `venv` — the venv
// directory name is not fixed, and an install that uses the un-dotted
// `venv` was otherwise invisible even when fully working (issue #284).
// `~/.local/bin/hermes` is also probed, where `pip install --user` flows
// place a wrapper. Before those default install paths, probe explicit
// per-user launcher hooks. They let managed deployments provide their own
// executable wrapper for unusual filesystem layouts, service users, or
// HERMES_HOME requirements without baking deployment-specific paths into the
// desktop. `command -v hermes` alone is not enough: the desktop's
// non-interactive SSH does not source `~/.profile`/`~/.bashrc`, so any PATH
// additions made there are not visible.
//
// Exported for unit testing the probe list without a live remote host.
export function buildRemoteHermesCmd(args: string[], extraShell = ""): string {
  const launcherCandidates = [
    "$HOME/.config/hermes-desktop/remote-hermes",
    "$HOME/.hermes/desktop-remote-hermes",
  ];
  const candidates = [
    "$HOME/hermes-agent/.venv/bin/hermes",
    "$HOME/hermes-agent/venv/bin/hermes",
    "$HOME/.hermes/hermes-agent/.venv/bin/hermes",
    "$HOME/.hermes/hermes-agent/venv/bin/hermes",
    "/opt/hermes/hermes-agent/.venv/bin/hermes",
    "/opt/hermes/hermes-agent/venv/bin/hermes",
    "$HOME/.local/bin/hermes",
  ];
  const quotedArgs = args.map((a) => shellQuote(a)).join(" ");
  const launcherProbe = launcherCandidates
    .map((p) => `[ -x ${p} ] && exec ${p} ${quotedArgs}${extraShell}`)
    .join("; ");
  const probe = candidates
    .map((p) => `[ -x ${p} ] && exec ${p} ${quotedArgs}${extraShell}`)
    .join("; ");
  const script = `${launcherProbe}; ${probe}; command -v hermes >/dev/null && exec hermes ${quotedArgs}${extraShell}; echo "ERR: hermes CLI not found on remote PATH, configured launcher, or in any known venv location" >&2; exit 1`;
  return `bash -c ${shellQuote(script)}`;
}

export async function sshRunDoctor(config: SshConfig): Promise<string> {
  try {
    // `hermes doctor` writes diagnostics to stdout; redirect stderr too so
    // any wrapper-refusal output is visible to the user rather than silently
    // dropped.
    const out = await sshExec(
      config,
      buildRemoteHermesCmd(["doctor"], " 2>&1"),
    );
    return out.trim() || "No output from doctor.";
  } catch (err) {
    return `SSH doctor failed: ${(err as Error).message}`;
  }
}

export async function sshRunUpdate(config: SshConfig): Promise<void> {
  await sshExec(
    config,
    buildRemoteHermesCmd(["update"], " 2>&1"),
    undefined,
    120000,
  );
}

export async function sshRunDump(config: SshConfig): Promise<string> {
  try {
    const out = await sshExec(
      config,
      buildRemoteHermesCmd(["dump"], " 2>&1"),
      undefined,
      60000,
    );
    return out.trim() || "No output from dump.";
  } catch (err) {
    return `SSH dump failed: ${(err as Error).message}`;
  }
}
