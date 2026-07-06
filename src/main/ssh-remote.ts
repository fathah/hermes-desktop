/**
 * SSH-proxied implementations of all hermes operations.
 * Used when connection mode is "ssh" — every feature that normally reads/writes
 * local files is instead executed on the remote host via SSH.
 */

import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { randomBytes } from "crypto";
import type { SshConfig } from "./ssh-tunnel";
import type { KanbanTask } from "./kanban";
import { buildSshControlOptions } from "./ssh-options";
import {
  classifySkillCliOutput,
  type InstalledSkill,
  type SkillSearchResult,
} from "./skills";
import type { MemoryInfo } from "./memory";
import type { HistoryItem, SessionSummary, SearchResult } from "./sessions";
import type { CachedSession } from "./session-cache";
import type { Attachment } from "../shared/attachments";
import { isImageMime, MAX_IMAGE_BYTES } from "../shared/attachments";
import type { ToolsetInfo } from "./tools";
import {
  extractLeadingVisionImageFallback,
  stripTrailingImagePlaceholders,
} from "./session-attachment-store";
import { DEFAULT_MESSAGING_PLATFORM_TOOLSETS } from "../shared/messaging-platforms";
import type { SavedModel } from "./models";
import type { MemoryProviderInfo } from "./installer";
import { parseMemoryLimitsConfig, type MemoryLimits } from "./memory-limits";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

// ── SSH exec core ────────────────────────────────────────────────────────────

function buildExecArgs(config: SshConfig): string[] {
  const keyPath = config.keyPath?.trim() || join(homedir(), ".ssh", "id_rsa");
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
    ...buildSshControlOptions(),
    "-i",
    keyPath,
    "-p",
    String(config.port || 22),
    `${config.username}@${config.host}`,
  ];
}

export function sshExec(
  config: SshConfig,
  command: string,
  stdin?: string,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const keyPath = config.keyPath?.trim() || join(homedir(), ".ssh", "id_rsa");
    if (!existsSync(keyPath)) {
      return reject(new Error(`SSH private key file not found at: ${keyPath}`));
    }

    const child = spawn("ssh", [...buildExecArgs(config), command], {
      stdio: ["pipe", "pipe", "pipe"],
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("SSH command timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      if (err && "code" in err && err.code === "ENOENT") {
        reject(
          new Error(
            "System SSH binary not found on your system PATH. Please ensure an SSH client is installed.",
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(sanitizeSshError(stderr) || "SSH command failed"));
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

function sshPython(
  config: SshConfig,
  script: string,
  stdin?: string,
  timeoutMs = 30000,
): Promise<string> {
  if (stdin === undefined) {
    return sshExec(config, "python3 -", script, timeoutMs);
  }
  return sshExec(config, `python3 -c ${shellQuote(script)}`, stdin, timeoutMs);
}

function sanitizeSshError(stderr: string): string {
  const cleaned = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Warning: Permanently added /.test(line))
    .filter((line) => !/identity file .* not accessible/i.test(line))
    .join("\n")
    .trim();
  if (
    /Permission denied \(publickey\)|no such identity|could not open a connection|publickey/i.test(
      cleaned,
    )
  ) {
    return "SSH authentication failed. Configure an SSH key for this host and try again.";
  }
  if (
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(
      cleaned,
    )
  ) {
    return "SSH host key verification failed. Check the host key before reconnecting.";
  }
  return cleaned;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function normalizeRemotePath(remotePath: string): string {
  return remotePath.replace(/^~\//, "$HOME/");
}

function pythonJsonInput(payload: unknown): string {
  return JSON.stringify(payload);
}

export interface SshDirectoryEntry {
  name: string;
  isDirectory: boolean;
}

export async function sshReadDirectory(
  config: SshConfig,
  remotePath: string,
): Promise<SshDirectoryEntry[] | null> {
  const script = `
import json
import os
import sys

payload = json.loads(sys.stdin.read() or "{}")
raw = str(payload.get("path") or "")
if raw.startswith("~/"):
    raw = os.path.join(os.path.expanduser("~"), raw[2:])
elif raw.startswith("$HOME/"):
    raw = os.path.join(os.path.expanduser("~"), raw[6:])
path = os.path.abspath(os.path.expanduser(raw or "."))
rows = []
for entry in os.scandir(path):
    rows.append({
        "name": entry.name,
        "isDirectory": entry.is_dir(follow_symlinks=False),
    })
rows.sort(key=lambda item: (not item["isDirectory"], item["name"].lower(), item["name"]))
print(json.dumps(rows))
`;

  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ path: remotePath }),
    );
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (entry): entry is SshDirectoryEntry =>
          entry !== null &&
          typeof entry === "object" &&
          typeof entry.name === "string" &&
          typeof entry.isDirectory === "boolean",
      )
      .map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
      }));
  } catch {
    return null;
  }
}

async function sshReadFile(
  config: SshConfig,
  remotePath: string,
): Promise<string> {
  try {
    return await sshExec(
      config,
      `sh -c 'case "$1" in "~/"*) p="$HOME/\${1#~/}" ;; "\\$HOME/"*) p="$HOME/\${1#\\$HOME/}" ;; *) p="$1" ;; esac; cat -- "$p" 2>/dev/null || true' -- ${shellQuote(normalizeRemotePath(remotePath))}`,
    );
  } catch {
    return "";
  }
}

async function sshWriteFile(
  config: SshConfig,
  remotePath: string,
  content: string,
): Promise<void> {
  const p = normalizeRemotePath(remotePath);
  const dir = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : ".";
  await sshExec(
    config,
    `sh -c 'expand(){ case "$1" in "~/"*) printf "%s" "$HOME/\${1#~/}" ;; "\\$HOME/"*) printf "%s" "$HOME/\${1#\\$HOME/}" ;; *) printf "%s" "$1" ;; esac; }; dir=$(expand "$1"); file=$(expand "$2"); mkdir -p -- "$dir" && cat > "$file"' -- ${shellQuote(dir)} ${shellQuote(p)}`,
    content,
  );
}

// ── Skills ───────────────────────────────────────────────────────────────────

const REMOTE_PREFIX = "REMOTE:";

export async function sshListInstalledSkills(
  config: SshConfig,
  profile?: string,
): Promise<InstalledSkill[]> {
  const script = `
import os, json, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
skills_dir = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills" if profile and profile != "default" else "~/.hermes/skills")
skills = []

def read_meta(skill_path):
    description = ""
    skill_file = os.path.join(skill_path, "SKILL.md")
    if os.path.exists(skill_file):
        try:
            content = open(skill_file).read(4000)
            if content.startswith("---"):
                end = content.find("---", 3)
                if end != -1:
                    for line in content[3:end].splitlines():
                        if line.strip().startswith("description:"):
                            description = line.split(":",1)[1].strip().strip("'").strip('"')
            else:
                for line in content.splitlines():
                    if line.strip() and not line.startswith("#"):
                        description = line.strip()[:120]
                        break
        except:
            pass
    return description

if os.path.isdir(skills_dir):
    for entry in sorted(os.listdir(skills_dir)):
        entry_path = os.path.join(skills_dir, entry)
        if not os.path.isdir(entry_path):
            continue
        direct_skill_file = os.path.join(entry_path, "SKILL.md")
        if os.path.exists(direct_skill_file):
            skills.append({"name": entry, "category": "", "description": read_meta(entry_path), "path": entry_path})
            continue
        for name in sorted(os.listdir(entry_path)):
            skill_path = os.path.join(entry_path, name)
            if os.path.isdir(skill_path) and os.path.exists(os.path.join(skill_path, "SKILL.md")):
                skills.append({"name": name, "category": entry, "description": read_meta(skill_path), "path": skill_path})
print(json.dumps(skills))
`;
  try {
    const out = await sshPython(config, script, pythonJsonInput({ profile }));
    const parsed = JSON.parse(out.trim() || "[]") as Array<{
      name: string;
      category: string;
      description: string;
      path: string;
    }>;
    return parsed.map((s) => ({ ...s, path: REMOTE_PREFIX + s.path }));
  } catch {
    return [];
  }
}

export async function sshGetSkillContent(
  config: SshConfig,
  skillPath: string,
): Promise<string> {
  const remote = skillPath.startsWith(REMOTE_PREFIX)
    ? skillPath.slice(REMOTE_PREFIX.length)
    : skillPath;
  return await sshReadFile(config, `${remote}/SKILL.md`);
}

export async function sshInstallSkill(
  config: SshConfig,
  identifier: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const stdout = await sshExec(
      config,
      buildRemoteHermesCmd(["skills", "install", identifier, "--yes"], " 2>&1"),
      undefined,
      120000,
    );
    return classifySkillCliOutput(stdout ?? "");
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sshUninstallSkill(
  config: SshConfig,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const stdout = await sshExec(
      config,
      buildRemoteHermesCmd(["skills", "uninstall", name, "--yes"], " 2>&1"),
    );
    const result = classifySkillCliOutput(stdout ?? "");
    if (result.success) return result;

    // CLI didn't find it — try direct filesystem removal on the remote.
    // Walk ~/.hermes/skills/*/ to find a directory whose SKILL.md frontmatter
    // name or directory basename matches `name`.
    await sshExec(
      config,
      `python3 -c '
import os, sys
name = ${shellQuote(name)}
home = os.path.expanduser("~")
skills_dir = os.path.join(home, ".hermes", "skills")
if not os.path.isdir(skills_dir):
    sys.exit(0)
for cat in os.listdir(skills_dir):
    cat_path = os.path.join(skills_dir, cat)
    if not os.path.isdir(cat_path):
        continue
    for entry in os.listdir(cat_path):
        entry_path = os.path.join(cat_path, entry)
        if not os.path.isdir(entry_path):
            continue
        skill_file = os.path.join(entry_path, "SKILL.md")
        if not os.path.isfile(skill_file):
            continue
        skill_name = entry
        try:
            with open(skill_file, "r", encoding="utf-8") as f:
                lines = f.read(4000).splitlines()
            in_fm = False
            for line in lines:
                if line.strip() == "---":
                    if not in_fm:
                        in_fm = True
                        continue
                    else:
                        break
                if in_fm and line.strip().startswith("name:"):
                    skill_name = line.split(":", 1)[1].strip().strip('"').strip("'")
                    break
        except Exception:
            pass
        if skill_name == name or entry == name:
            import shutil
            shutil.rmtree(entry_path)
            sys.exit(0)
' 2>&1`,
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sshSearchSkills(
  config: SshConfig,
  query: string,
): Promise<SkillSearchResult[]> {
  try {
    const out = await sshExec(
      config,
      `${buildRemoteHermesCmd(
        ["skills", "browse", "--query", query, "--json"],
        " 2>/dev/null",
      )} || echo "[]"`,
    );
    const parsed = JSON.parse(out.trim() || "[]");
    if (Array.isArray(parsed)) {
      return parsed.map((r: Record<string, string>) => ({
        name: r.name || "",
        description: r.description || "",
        category: r.category || "",
        source: r.source || "",
        installed: false,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

export async function sshListBundledSkills(
  config: SshConfig,
): Promise<SkillSearchResult[]> {
  return await sshSearchSkills(config, "");
}

// ── Memory ───────────────────────────────────────────────────────────────────

const ENTRY_DELIMITER = "\n§\n";

function parseMemoryEntries(
  content: string,
): Array<{ index: number; content: string }> {
  if (!content.trim()) return [];
  return content
    .split(ENTRY_DELIMITER)
    .map((entry, index) => ({ index, content: entry.trim() }))
    .filter((e) => e.content.length > 0);
}

function serializeEntries(
  entries: Array<{ index: number; content: string }>,
): string {
  return entries.map((e) => e.content).join(ENTRY_DELIMITER);
}

function remoteMemoryPath(profile?: string): string {
  if (profile && profile !== "default") {
    return `~/.hermes/profiles/${profile}/memories/MEMORY.md`;
  }
  return "~/.hermes/memories/MEMORY.md";
}

function remoteUserPath(profile?: string): string {
  if (profile && profile !== "default") {
    return `~/.hermes/profiles/${profile}/memories/USER.md`;
  }
  return "~/.hermes/memories/USER.md";
}

async function sshReadMemoryLimits(
  config: SshConfig,
  profile?: string,
): Promise<MemoryLimits> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  return parseMemoryLimitsConfig(content);
}

async function sshGetSessionStats(
  config: SshConfig,
  profile?: string,
): Promise<{ totalSessions: number; totalMessages: number }> {
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print(json.dumps({"totalSessions": 0, "totalMessages": 0}))
    sys.exit(0)
conn = sqlite3.connect(db)
try:
    s = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    m = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    print(json.dumps({"totalSessions": s, "totalMessages": m}))
except:
    print(json.dumps({"totalSessions": 0, "totalMessages": 0}))
finally:
    conn.close()
`;
  try {
    const out = await sshPython(config, script, pythonJsonInput({ profile }));
    return JSON.parse(out.trim());
  } catch {
    return { totalSessions: 0, totalMessages: 0 };
  }
}

export async function sshReadMemory(
  config: SshConfig,
  profile?: string,
): Promise<MemoryInfo> {
  const [memContent, userContent, stats, limits] = await Promise.all([
    sshReadFile(config, remoteMemoryPath(profile)),
    sshReadFile(config, remoteUserPath(profile)),
    sshGetSessionStats(config, profile),
    sshReadMemoryLimits(config, profile),
  ]);

  return {
    memory: {
      content: memContent,
      exists: memContent.length > 0,
      lastModified: null,
      entries: parseMemoryEntries(memContent),
      charCount: memContent.length,
      charLimit: limits.memoryCharLimit,
    },
    user: {
      content: userContent,
      exists: userContent.length > 0,
      lastModified: null,
      charCount: userContent.length,
      charLimit: limits.userCharLimit,
    },
    stats,
  };
}

export async function sshAddMemoryEntry(
  config: SshConfig,
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const [current, limits] = await Promise.all([
    sshReadFile(config, remoteMemoryPath(profile)),
    sshReadMemoryLimits(config, profile),
  ]);
  const entries = parseMemoryEntries(current);
  const newContent = serializeEntries([
    ...entries,
    { index: entries.length, content: content.trim() },
  ]);
  if (newContent.length > limits.memoryCharLimit) {
    return {
      success: false,
      error: `Would exceed memory limit (${newContent.length}/${limits.memoryCharLimit} chars)`,
    };
  }
  await sshWriteFile(config, remoteMemoryPath(profile), newContent);
  return { success: true };
}

export async function sshUpdateMemoryEntry(
  config: SshConfig,
  index: number,
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const [current, limits] = await Promise.all([
    sshReadFile(config, remoteMemoryPath(profile)),
    sshReadMemoryLimits(config, profile),
  ]);
  const entries = parseMemoryEntries(current);
  if (index < 0 || index >= entries.length)
    return { success: false, error: "Entry not found" };
  entries[index] = { ...entries[index], content: content.trim() };
  const newContent = serializeEntries(entries);
  if (newContent.length > limits.memoryCharLimit) {
    return {
      success: false,
      error: `Would exceed memory limit (${newContent.length}/${limits.memoryCharLimit} chars)`,
    };
  }
  await sshWriteFile(config, remoteMemoryPath(profile), newContent);
  return { success: true };
}

export async function sshRemoveMemoryEntry(
  config: SshConfig,
  index: number,
  profile?: string,
): Promise<boolean> {
  const current = await sshReadFile(config, remoteMemoryPath(profile));
  const entries = parseMemoryEntries(current);
  if (index < 0 || index >= entries.length) return false;
  entries.splice(index, 1);
  await sshWriteFile(
    config,
    remoteMemoryPath(profile),
    serializeEntries(entries),
  );
  return true;
}

export async function sshWriteUserProfile(
  config: SshConfig,
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const limits = await sshReadMemoryLimits(config, profile);
  if (content.length > limits.userCharLimit) {
    return {
      success: false,
      error: `Exceeds limit (${content.length}/${limits.userCharLimit} chars)`,
    };
  }
  await sshWriteFile(config, remoteUserPath(profile), content);
  return { success: true };
}

// ── Soul ─────────────────────────────────────────────────────────────────────

const DEFAULT_SOUL = `You are Hermes, a helpful AI assistant. You are friendly, knowledgeable, and always eager to help.

You communicate clearly and concisely. When asked to perform tasks, you think step-by-step and explain your reasoning. You are honest about your limitations and ask for clarification when needed.

You strive to be helpful while being safe and responsible. You respect the user's privacy and handle sensitive information carefully.
`;

function remoteSoulPath(profile?: string): string {
  if (profile && profile !== "default")
    return `~/.hermes/profiles/${profile}/SOUL.md`;
  return "~/.hermes/SOUL.md";
}

export async function sshReadSoul(
  config: SshConfig,
  profile?: string,
): Promise<string> {
  return await sshReadFile(config, remoteSoulPath(profile));
}

export async function sshWriteSoul(
  config: SshConfig,
  content: string,
  profile?: string,
): Promise<boolean> {
  try {
    await sshWriteFile(config, remoteSoulPath(profile), content);
    return true;
  } catch {
    return false;
  }
}

export async function sshResetSoul(
  config: SshConfig,
  profile?: string,
): Promise<string> {
  await sshWriteSoul(config, DEFAULT_SOUL, profile);
  return DEFAULT_SOUL;
}

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLSET_DEFS = [
  {
    key: "web",
    labelKey: "tools.web.label",
    descriptionKey: "tools.web.description",
  },
  {
    key: "browser",
    labelKey: "tools.browser.label",
    descriptionKey: "tools.browser.description",
  },
  {
    key: "terminal",
    labelKey: "tools.terminal.label",
    descriptionKey: "tools.terminal.description",
  },
  {
    key: "file",
    labelKey: "tools.file.label",
    descriptionKey: "tools.file.description",
  },
  {
    key: "code_execution",
    labelKey: "tools.code_execution.label",
    descriptionKey: "tools.code_execution.description",
  },
  {
    key: "vision",
    labelKey: "tools.vision.label",
    descriptionKey: "tools.vision.description",
  },
  {
    key: "image_gen",
    labelKey: "tools.image_gen.label",
    descriptionKey: "tools.image_gen.description",
  },
  {
    key: "tts",
    labelKey: "tools.tts.label",
    descriptionKey: "tools.tts.description",
  },
  {
    key: "skills",
    labelKey: "tools.skills.label",
    descriptionKey: "tools.skills.description",
  },
  {
    key: "memory",
    labelKey: "tools.memory.label",
    descriptionKey: "tools.memory.description",
  },
  {
    key: "session_search",
    labelKey: "tools.session_search.label",
    descriptionKey: "tools.session_search.description",
  },
  {
    key: "clarify",
    labelKey: "tools.clarify.label",
    descriptionKey: "tools.clarify.description",
  },
  {
    key: "delegation",
    labelKey: "tools.delegation.label",
    descriptionKey: "tools.delegation.description",
  },
];

function parsePlatformToolsets(content: string): Record<string, Set<string>> {
  const toolsets: Record<string, Set<string>> = {};
  let inPlatformToolsets = false;
  let currentPlatform: string | null = null;
  for (const line of content.split("\n")) {
    const trimmed = line.trimEnd();
    if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
      inPlatformToolsets = true;
      currentPlatform = null;
      continue;
    }
    if (inPlatformToolsets && /^\S/.test(trimmed) && trimmed !== "") {
      inPlatformToolsets = false;
      currentPlatform = null;
      continue;
    }
    if (!inPlatformToolsets) continue;

    const platformMatch = trimmed.match(
      /^\s+([A-Za-z0-9_-]+)\s*:\s*(\[\])?\s*(?:#.*)?$/,
    );
    if (platformMatch) {
      const platformName = platformMatch[1];
      currentPlatform = platformMatch[2] ? null : platformName;
      toolsets[platformName] ??= new Set<string>();
      continue;
    }

    if (currentPlatform) {
      const m = trimmed.match(/^\s+-\s+["']?([A-Za-z0-9_-]+)["']?/);
      if (m) toolsets[currentPlatform].add(m[1]);
    }
  }
  return toolsets;
}

function parseEnabledToolsets(content: string, platform = "cli"): Set<string> {
  return parsePlatformToolsets(content)[platform] ?? new Set<string>();
}

function isSafeToolsetConfigKey(key: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(key);
}

function localizeToolDefs(
  enabled: boolean | ((key: string) => boolean),
): ToolsetInfo[] {
  const locale = getAppLocale();
  return TOOLSET_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey, locale),
    description: t(d.descriptionKey, locale),
    enabled: typeof enabled === "function" ? enabled(d.key) : enabled,
  }));
}

function remoteConfigPath(profile?: string): string {
  if (profile && profile !== "default")
    return `$HOME/.hermes/profiles/${profile}/config.yaml`;
  return `$HOME/.hermes/config.yaml`;
}

export async function sshGetToolsets(
  config: SshConfig,
  profile?: string,
): Promise<ToolsetInfo[]> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return localizeToolDefs(true);
  const enabled = parseEnabledToolsets(content);
  if (enabled.size === 0 && !content.includes("platform_toolsets"))
    return localizeToolDefs(true);
  return localizeToolDefs((key) => enabled.has(key));
}

export async function sshGetPlatformToolsets(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, string[]>> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return {};
  return Object.fromEntries(
    Object.entries(parsePlatformToolsets(content)).map(([platform, values]) => [
      platform,
      Array.from(values).sort(),
    ]),
  );
}

export async function sshSetToolsetEnabled(
  config: SshConfig,
  key: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  return sshSetPlatformToolsetEnabled(config, "cli", key, enabled, profile);
}

export async function sshSetMessagingPlatformToolsetEnabled(
  config: SshConfig,
  platform: string,
  key: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  return sshSetPlatformToolsetEnabled(
    config,
    platform,
    key,
    enabled,
    profile,
    DEFAULT_MESSAGING_PLATFORM_TOOLSETS,
  );
}

async function sshSetPlatformToolsetEnabled(
  config: SshConfig,
  platform: string,
  key: string,
  enabled: boolean,
  profile?: string,
  defaultEnabled: string[] = [],
): Promise<boolean> {
  try {
    if (!isSafeToolsetConfigKey(platform) || !isSafeToolsetConfigKey(key)) {
      return false;
    }
    const configPath = remoteConfigPath(profile);
    const content = await sshReadFile(config, configPath);
    if (!content) return false;

    const parsed = parsePlatformToolsets(content);
    const hasPlatformConfig = Object.prototype.hasOwnProperty.call(
      parsed,
      platform,
    );
    const current = hasPlatformConfig
      ? new Set(parsed[platform])
      : new Set(defaultEnabled);
    if (enabled) current.add(key);
    else current.delete(key);

    const toolsetLines = Array.from(current)
      .sort()
      .map((t) => `      - ${t}`)
      .join("\n");
    const newSection = `  ${platform}:\n${toolsetLines}`;
    const platformHeader = new RegExp(`^\\s+${platform}\\s*:`);

    let newContent: string;
    if (content.includes("platform_toolsets")) {
      const lines = content.split("\n");
      const result: string[] = [];
      let inPT = false,
        inTargetPlatform = false,
        inserted = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimEnd();
        if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
          inPT = true;
          result.push(line);
          continue;
        }
        if (inPT && platformHeader.test(trimmed)) {
          inTargetPlatform = true;
          result.push(newSection);
          inserted = true;
          continue;
        }
        if (inTargetPlatform) {
          if (/^\s+-\s/.test(trimmed)) continue;
          inTargetPlatform = false;
          result.push(line);
          continue;
        }
        if (inPT && /^\S/.test(trimmed) && trimmed !== "") {
          inPT = false;
          if (!inserted) {
            result.push(newSection);
            inserted = true;
          }
        }
        result.push(line);
      }
      if (inPT && !inserted) {
        result.push(newSection);
      }
      newContent = result.join("\n");
    } else {
      newContent =
        content.trimEnd() + "\n\nplatform_toolsets:\n" + newSection + "\n";
    }

    await sshWriteFile(config, configPath, newContent);
    return true;
  } catch {
    return false;
  }
}

// ── Env / Config (Providers) ─────────────────────────────────────────────────

function remoteEnvPath(profile?: string): string {
  if (profile && profile !== "default")
    return `~/.hermes/profiles/${profile}/.env`;
  return "~/.hermes/.env";
}

export async function sshReadEnv(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, string>> {
  const content = await sshReadFile(config, remoteEnvPath(profile));
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const k = trimmed.substring(0, eqIdx).trim();
    let v = trimmed.substring(eqIdx + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (v) result[k] = v;
  }
  // Home Assistant has accumulated three naming conventions across hermes
  // versions: HASS_* (what gateway/config.py currently reads), HOMEASSISTANT_*
  // (legacy), and HA_* (older desktop builds). Mirror all three so the UI
  // can display the value regardless of which one the remote server uses.
  const HA_ALIAS_GROUPS: string[][] = [
    ["HASS_URL", "HOMEASSISTANT_URL", "HA_URL"],
    ["HASS_TOKEN", "HOMEASSISTANT_TOKEN", "HA_TOKEN"],
  ];
  for (const group of HA_ALIAS_GROUPS) {
    const present = group.find((k) => result[k]);
    if (!present) continue;
    const value = result[present];
    for (const k of group) {
      if (!result[k]) result[k] = value;
    }
  }
  return result;
}

// Pure line-rewrite for sshSetEnvValue, exported for tests. Rewrites the
// FIRST matching line (commented-out counts — it becomes live) and DROPS any
// later duplicates. Both sshReadEnv and the remote gateway's dotenv are
// last-wins, and pre-dedup desktops left .env files with several
// API_SERVER_KEY / HERMES_DASHBOARD_SESSION_TOKEN lines — replacing only the
// first while a stale later line survives means the gateway keeps using the
// OLD value while this desktop caches the new one (a permanent 401). One
// canonical line, matching the grep-v writers for the dashboard token/port.
export function upsertEnvLine(
  content: string,
  key: string,
  value: string,
): string {
  if (!content.trim()) return `${key}=${value}\n`;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^#?\\s*${escaped}\\s*=`);
  let found = false;
  const lines: string[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim().match(matcher)) {
      lines.push(line);
      continue;
    }
    if (!found) lines.push(`${key}=${value}`);
    found = true;
  }
  if (!found) lines.push(`${key}=${value}`);
  return lines.join("\n");
}

export async function sshSetEnvValue(
  config: SshConfig,
  key: string,
  value: string,
  profile?: string,
): Promise<void> {
  const envPath = remoteEnvPath(profile);
  const content = await sshReadFile(config, envPath);
  await sshWriteFile(config, envPath, upsertEnvLine(content, key, value));
}

// ─── Dotted-path YAML helpers (mirror of the local-mode fix) ───────────────
//
// The previous implementation used `^\s*<key>:` against the whole remote
// config.yaml. Two problems, both observed in the wild (#240): dotted-path
// keys like `model.provider` looked for a literal `model.provider:` line
// that doesn't exist in real YAML, and flat keys leaked across blocks
// (the first `default:` at any indent — typically `personalities.default`
// — would shadow `model.default`). The new helpers walk path segments at
// strictly-greater indent than each parent and pin single-segment keys
// to column 0.
//
// Duplicates the navigator in config.ts intentionally to keep this PR
// self-contained and independent. Once both land, a small consolidation
// PR can lift these into a shared module.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripYamlQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

interface YamlPathHit {
  value: string;
  valueStart: number;
  valueEnd: number;
}

interface SegmentMatch {
  indent: number;
  rawValue: string;
  valueStart: number;
  valueEnd: number;
  afterLine: number;
}

function findSegmentInBlock(
  content: string,
  startAt: number,
  parentIndent: number,
  segment: string,
): SegmentMatch | null {
  const escapedSegment = escapeRegex(segment);
  let directChildIndent: number | null = null;
  let cursor = startAt;

  while (cursor < content.length) {
    const lineEnd = content.indexOf("\n", cursor);
    const lineEndExclusive = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(cursor, lineEndExclusive);
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      cursor =
        lineEndExclusive === content.length
          ? content.length
          : lineEndExclusive + 1;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    // Block boundary: a non-blank line at or shallower than the parent
    // closes the parent's block.
    if (indent <= parentIndent) return null;

    if (directChildIndent === null) directChildIndent = indent;

    if (indent === directChildIndent) {
      // `[ \t]*` so this also matches top-level keys at column 0 (the
      // first segment of a dotted path); the `indent === directChild`
      // gate above already enforces depth.
      const m = line.match(
        new RegExp(
          `^([ \\t]*)(${escapedSegment}):([ \\t]*)([^\\n#]*?)([ \\t]*)(#.*)?$`,
        ),
      );
      if (m) {
        const indentStr = m[1];
        const gapBeforeValue = m[3];
        const rawValue = m[4];
        const keyEnd = cursor + indentStr.length + segment.length + 1;
        const valueStart = keyEnd + gapBeforeValue.length;
        const valueEnd = valueStart + rawValue.length;
        return {
          indent: indentStr.length,
          rawValue,
          valueStart,
          valueEnd,
          afterLine:
            lineEndExclusive === content.length
              ? content.length
              : lineEndExclusive + 1,
        };
      }
    }

    cursor =
      lineEndExclusive === content.length
        ? content.length
        : lineEndExclusive + 1;
  }

  return null;
}

/** Exported for unit testing. Walks a dotted YAML path through `content`. */
export function findYamlPath(
  content: string,
  dottedPath: string,
): YamlPathHit | null {
  const segments = dottedPath.split(".").filter(Boolean);
  if (segments.length === 0) return null;

  let cursor = 0;
  let parentIndent = -1;

  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const found = findSegmentInBlock(
      content,
      cursor,
      parentIndent,
      segments[i],
    );
    if (!found) return null;

    if (isLast) {
      return {
        value: stripYamlQuotes(found.rawValue),
        valueStart: found.valueStart,
        valueEnd: found.valueEnd,
      };
    }
    cursor = found.afterLine;
    parentIndent = found.indent;
  }

  return null;
}

/** Exported for unit testing. Matches `<key>:` at column 0 only. */
export function findTopLevelKey(
  content: string,
  key: string,
): YamlPathHit | null {
  const re = new RegExp(
    `^(${escapeRegex(key)}):([ \\t]*)([^\\n#]*?)([ \\t]*)(#.*)?$`,
    "m",
  );
  const m = content.match(re);
  if (!m || m.index === undefined) return null;
  const gap = m[2];
  const rawValue = m[3];
  const lineStart = m.index;
  const valueStart = lineStart + key.length + 1 + gap.length;
  const valueEnd = valueStart + rawValue.length;
  return {
    value: stripYamlQuotes(rawValue),
    valueStart,
    valueEnd,
  };
}

function locateInYaml(content: string, key: string): YamlPathHit | null {
  const segments = key.split(".").filter(Boolean);
  if (segments.length === 0) return null;
  return segments.length === 1
    ? findTopLevelKey(content, segments[0])
    : findYamlPath(content, key);
}

export async function sshGetConfigValue(
  config: SshConfig,
  key: string,
  profile?: string,
): Promise<string | null> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return null;
  const hit = locateInYaml(content, key);
  return hit ? hit.value : null;
}

export async function sshSetConfigValue(
  config: SshConfig,
  key: string,
  value: string,
  profile?: string,
): Promise<void> {
  if (/["\\\n\r]/.test(value)) {
    throw new Error(
      'Config value contains illegal characters: ", \\, or newline',
    );
  }
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;

  const hit = locateInYaml(content, key);
  let updated: string;
  if (hit) {
    updated =
      content.slice(0, hit.valueStart) +
      `"${value}"` +
      content.slice(hit.valueEnd);
  } else if (!key.includes(".")) {
    // Flat key missing → append at top level.
    const sep = content.endsWith("\n") || content === "" ? "" : "\n";
    updated = `${content}${sep}${key}: "${value}"\n`;
  } else {
    // Missing nested path — don't guess where to materialize a parent
    // block; that risks corrupting the file. Leave the content alone.
    return;
  }

  await sshWriteFile(config, configPath, updated);
}

export function sshGetHermesHome(_config: SshConfig, profile?: string): string {
  if (profile && profile !== "default") return `~/.hermes/profiles/${profile}`;
  return "~/.hermes";
}

export async function sshGetModelConfig(
  config: SshConfig,
  profile?: string,
): Promise<{ provider: string; model: string; baseUrl: string }> {
  // Use dotted paths so the lookup is scoped to the `model:` block. The
  // previous flat keys `provider` / `default` / `base_url` would each
  // match the first occurrence at any indent — typically picking up
  // `personalities.default` or `auxiliary.vision.provider` and reporting
  // them as the model fields (#240).
  return {
    provider:
      (await sshGetConfigValue(config, "model.provider", profile)) || "auto",
    model: (await sshGetConfigValue(config, "model.default", profile)) || "",
    baseUrl: (await sshGetConfigValue(config, "model.base_url", profile)) || "",
  };
}

export async function sshSetModelConfig(
  config: SshConfig,
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): Promise<void> {
  await sshSetConfigValue(config, "model.provider", provider, profile);
  await sshSetConfigValue(config, "model.default", model, profile);
  if (baseUrl) {
    await sshSetConfigValue(config, "model.base_url", baseUrl, profile);
  }
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;
  let updated = content.replace(/^(\s*streaming:\s*)(\S+)/m, "$1true");
  const lines = updated.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (
      /^\s*enabled:\s*(true|false)/.test(lines[i]) &&
      i > 0 &&
      /smart_model_routing/.test(lines[i - 1])
    ) {
      lines[i] = lines[i].replace(/(enabled:\s*)(true|false)/, "$1false");
    }
  }
  updated = lines.join("\n");
  if (updated !== content) await sshWriteFile(config, configPath, updated);
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function sshListSessions(
  config: SshConfig,
  limit = 30,
  offset = 0,
  profile?: string,
): Promise<SessionSummary[]> {
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
limit = max(1, min(200, int(payload.get("limit") or 30)))
offset = max(0, int(payload.get("offset") or 0))
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT id, source, started_at, ended_at, message_count, model, title "
    "FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?",
    (limit, offset)
).fetchall()
result = []
for r in rows:
    result.append({
        "id": r["id"], "source": r["source"] or "cli",
        "startedAt": r["started_at"], "endedAt": r["ended_at"],
        "messageCount": r["message_count"] or 0, "model": r["model"] or "",
        "title": r["title"], "preview": ""
    })
print(json.dumps(result))
conn.close()
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, limit, offset }),
    );
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

export async function sshGetSessionMessages(
  config: SshConfig,
  sessionId: string,
  profile?: string,
): Promise<HistoryItem[]> {
  // Mirror the local getSessionMessages logic over SSH: widen the SELECT to
  // include tool_calls / tool_name / tool_call_id / reasoning columns, then
  // expand each row into one or more HistoryItem entries. Kept inline in
  // Python for transport simplicity. See src/main/sessions.ts for the
  // canonical implementation and column documentation.
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
session_id = payload.get("sessionId") or ""
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row

CONTENT_JSON_PREFIX = "\\x00json:"

def decode(raw):
    """Mirror src/main/sessions.ts::decodeContent — strip multimodal
    sentinel, concat text parts, ignore images here (SSH path drops
    attachments)."""
    if not raw or not raw.startswith(CONTENT_JSON_PREFIX):
        return raw or ""
    try:
        parts = json.loads(raw[len(CONTENT_JSON_PREFIX):])
    except Exception:
        return raw
    if isinstance(parts, str):
        return parts
    if not isinstance(parts, list):
        return raw
    texts = []
    for p in parts:
        if isinstance(p, str):
            if p: texts.append(p)
            continue
        if not isinstance(p, dict): continue
        t = str(p.get("type") or "").lower()
        if t in ("text", "input_text", "output_text"):
            v = p.get("text")
            if isinstance(v, str) and v: texts.append(v)
    return "\\n\\n".join(texts)

def pick_reasoning(row):
    for col in ("reasoning", "reasoning_content"):
        v = (row[col] or "").strip() if row[col] else ""
        if v: return v
    details = (row["reasoning_details"] or "").strip()
    if not details: return ""
    try:
        parsed = json.loads(details)
    except Exception:
        return ""
    if isinstance(parsed, str): return parsed
    if isinstance(parsed, list):
        texts = []
        for entry in parsed:
            if not isinstance(entry, dict): continue
            for k in ("text", "thinking"):
                v = entry.get(k)
                if isinstance(v, str) and v: texts.append(v); break
        if texts: return "\\n\\n".join(texts)
    return ""

def parse_tool_calls(raw):
    if not raw or not raw.strip(): return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list): return []
    out = []
    for entry in parsed:
        if not isinstance(entry, dict): continue
        fn = entry.get("function") or {}
        name = fn.get("name")
        if not isinstance(name, str) or not name: continue
        call_id = entry.get("call_id") or entry.get("id") or ""
        raw_args = fn.get("arguments")
        args = raw_args if isinstance(raw_args, str) else ""
        try:
            args = json.dumps(json.loads(args), indent=2)
        except Exception:
            pass
        out.append({"callId": call_id, "name": name, "args": args})
    return out

rows = conn.execute(
    "SELECT id, role, content, timestamp, tool_call_id, tool_calls, tool_name, "
    "reasoning, reasoning_content, reasoning_details "
    "FROM messages WHERE session_id = ? AND role IN ('user','assistant','tool') "
    "ORDER BY timestamp, id",
    (session_id,)
).fetchall()

items = []
for r in rows:
    text = decode(r["content"] or "")
    if r["role"] == "user":
        if not text: continue
        items.append({"kind":"user","id":r["id"],"content":text,"timestamp":r["timestamp"]})
        continue
    if r["role"] == "assistant":
        reasoning_text = pick_reasoning(r)
        if reasoning_text:
            items.append({"kind":"reasoning","id":r["id"],"assistantId":r["id"],"text":reasoning_text,"timestamp":r["timestamp"]})
        if text:
            items.append({"kind":"assistant","id":r["id"],"content":text,"timestamp":r["timestamp"]})
        for tc in parse_tool_calls(r["tool_calls"]):
            items.append({"kind":"tool_call","id":r["id"],"assistantId":r["id"],"callId":tc["callId"],"name":tc["name"],"args":tc["args"],"timestamp":r["timestamp"]})
        continue
    if r["role"] == "tool":
        items.append({"kind":"tool_result","id":r["id"],"callId":r["tool_call_id"] or "","name":r["tool_name"] or "tool","content":text,"timestamp":r["timestamp"]})
        continue

print(json.dumps(items))
conn.close()
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, sessionId }),
    );
    const items = JSON.parse(out.trim() || "[]") as HistoryItem[];
    return hydrateSshPromptImageAttachments(config, items);
  } catch {
    return [];
  }
}

function sshImageName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || "image";
}

function attachmentFromSshDataUrl(
  dataUrl: string | null,
  filePath: string,
  id: string,
): Attachment | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!isImageMime(mime)) return null;
  const size = Buffer.byteLength(match[2], "base64");
  if (size <= 0 || size > MAX_IMAGE_BYTES) return null;
  return {
    id,
    kind: "image",
    name: sshImageName(filePath),
    mime,
    size,
    dataUrl: dataUrl || "",
    path: filePath,
  };
}

async function sshReadImageAsDataUrl(
  config: SshConfig,
  filePath: string,
): Promise<string | null> {
  const script = `
import base64, json, mimetypes, os, sys
payload = json.load(sys.stdin)
path = payload.get("path") or ""
max_bytes = int(payload.get("maxBytes") or 0)
if not path:
    print(json.dumps({"data_url": None})); sys.exit(0)
path = os.path.expanduser(path)
try:
    st = os.stat(path)
    if not os.path.isfile(path) or st.st_size <= 0 or (max_bytes and st.st_size > max_bytes):
        print(json.dumps({"data_url": None})); sys.exit(0)
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if not mime.startswith("image/"):
        print(json.dumps({"data_url": None})); sys.exit(0)
    with open(path, "rb") as fh:
        data = fh.read(max_bytes + 1 if max_bytes else -1)
    if max_bytes and len(data) > max_bytes:
        print(json.dumps({"data_url": None})); sys.exit(0)
    print(json.dumps({"data_url": "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii"))}))
except Exception:
    print(json.dumps({"data_url": None}))
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ path: filePath, maxBytes: MAX_IMAGE_BYTES }),
      30000,
    );
    const parsed = JSON.parse(out.trim() || "{}") as { data_url?: unknown };
    return typeof parsed.data_url === "string" ? parsed.data_url : null;
  } catch {
    return null;
  }
}

async function hydrateSshPromptImageAttachments(
  config: SshConfig,
  items: HistoryItem[],
): Promise<HistoryItem[]> {
  const hydrated: HistoryItem[] = [];
  const cache = new Map<string, Promise<string | null>>();

  for (const item of items) {
    if (item.kind !== "user") {
      hydrated.push(item);
      continue;
    }

    const fallback = extractLeadingVisionImageFallback(item.content);
    if (!fallback.imagePath) {
      hydrated.push(item);
      continue;
    }

    const nextContent = stripTrailingImagePlaceholders(fallback.content);
    if (item.attachments?.length) {
      hydrated.push({ ...item, content: nextContent });
      continue;
    }

    const dataUrlPromise =
      cache.get(fallback.imagePath) ??
      sshReadImageAsDataUrl(config, fallback.imagePath);
    cache.set(fallback.imagePath, dataUrlPromise);
    const attachment = attachmentFromSshDataUrl(
      await dataUrlPromise,
      fallback.imagePath,
      `ssh-fallback-att-${item.id}-0`,
    );

    hydrated.push({
      ...item,
      content: nextContent,
      ...(attachment ? { attachments: [attachment] } : {}),
    });
  }

  return hydrated;
}

export async function sshSearchSessions(
  config: SshConfig,
  query: string,
  limit = 20,
  profile?: string,
): Promise<SearchResult[]> {
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
query = payload.get("query") or ""
limit = max(1, min(200, int(payload.get("limit") or 20)))
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
try:
    rows = conn.execute(
        "SELECT s.id, s.title, s.started_at, s.source, s.message_count, s.model, m.content as snippet "
        "FROM sessions s LEFT JOIN messages m ON m.session_id = s.id "
        "WHERE lower(coalesce(s.title, '')) LIKE lower(?) "
        "OR lower(s.id) LIKE lower(?) "
        "OR lower(coalesce(m.content, '')) LIKE lower(?) "
        "ORDER BY s.started_at DESC, m.timestamp ASC, m.id ASC LIMIT ?",
        (f"%{query}%", f"%{query}%", f"%{query}%", max(limit * 8, 50))
    ).fetchall()
    seen = set()
    result = []
    for r in rows:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        snippet = r["snippet"] or r["title"] or ("Session " + r["id"][-6:])
        result.append({"sessionId": r["id"], "title": r["title"], "startedAt": r["started_at"], "source": r["source"] or "cli", "messageCount": r["message_count"] or 0, "model": r["model"] or "", "snippet": snippet[:500]})
        if len(result) >= limit:
            break
    print(json.dumps(result))
except Exception as e:
    print("[]")
conn.close()
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, query, limit }),
    );
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export interface SshProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

export function parseHermesProfileListOutput(output: string): SshProfileInfo[] {
  const profiles: SshProfileInfo[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^profile\s+model\s+gateway\b/i.test(trimmed)) continue;
    if (/^[─\-\s]+$/.test(trimmed)) continue;

    const active = /^[◆*]/.test(trimmed);
    const line = trimmed.replace(/^[◆*]\s*/, "");
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    const [name, model, gateway] = parts;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) continue;
    const gatewayState = gateway.toLowerCase();
    if (gatewayState !== "running" && gatewayState !== "stopped") continue;

    profiles.push({
      name,
      path: name === "default" ? "~/.hermes" : `~/.hermes/profiles/${name}`,
      isDefault: name === "default",
      isActive: active,
      model: model === "—" ? "" : model,
      provider: "auto",
      hasEnv: false,
      hasSoul: false,
      skillCount: 0,
      gatewayRunning: gatewayState === "running",
    });
  }

  if (profiles.length > 0 && !profiles.some((p) => p.isActive)) {
    const defaultProfile = profiles.find((p) => p.isDefault) ?? profiles[0];
    defaultProfile.isActive = true;
  }

  return profiles;
}

// Per-user launcher hooks a managed deployment can drop in to wrap the real
// Hermes CLI (custom HERMES_HOME, service user, unusual filesystem layout).
// Kept in sync with the launcher probe order in buildRemoteHermesCmd.
const REMOTE_HERMES_LAUNCHER_CANDIDATES = [
  "$HOME/.config/hermes-desktop/remote-hermes",
  "$HOME/.hermes/desktop-remote-hermes",
];

const LAUNCHER_PRESENT_SENTINEL = "__HERMES_REMOTE_LAUNCHER__";

export interface LauncherProfileResult {
  // Whether an executable launcher hook actually exists on the remote. This is
  // distinct from "the CLI returned profiles": the regular hermes binary on
  // PATH can answer `profile list` even with no launcher configured, so count
  // heuristics cannot tell the two apart — only this flag can.
  present: boolean;
  profiles: SshProfileInfo[];
}

// Detect whether a remote launcher hook exists and, if so, list its profiles in
// a single round trip. When no launcher is configured the loop exits without
// invoking the Hermes CLI, so ordinary installs stay cheap and fall through to
// the richer filesystem scan in sshListProfiles.
async function sshDetectLauncherProfiles(
  config: SshConfig,
): Promise<LauncherProfileResult> {
  const list = REMOTE_HERMES_LAUNCHER_CANDIDATES.map((p) => `"${p}"`).join(" ");
  // Echo the sentinel BEFORE exec so it is flushed even though exec replaces
  // the shell; `exec` then streams the launcher's `profile list` to the same
  // stdout. No launcher → no sentinel, empty output.
  const script =
    `for p in ${list}; do ` +
    `[ -x "$p" ] && { echo ${LAUNCHER_PRESENT_SENTINEL}; exec "$p" profile list 2>/dev/null; }; ` +
    `done`;
  try {
    const out = await sshExec(
      config,
      `sh -c ${shellQuote(script)}`,
      undefined,
      20000,
    );
    if (!out.includes(LAUNCHER_PRESENT_SENTINEL)) {
      return { present: false, profiles: [] };
    }
    const cleaned = out
      .split(/\r?\n/)
      .filter((line) => line.trim() !== LAUNCHER_PRESENT_SENTINEL)
      .join("\n");
    return { present: true, profiles: parseHermesProfileListOutput(cleaned) };
  } catch {
    return { present: false, profiles: [] };
  }
}

// Decide which profile list represents the actual remote runtime. A configured
// launcher runs against the deployment's real HERMES_HOME and is authoritative;
// the filesystem scan always assumes ~/.hermes. Prefer the launcher whenever it
// is present and returned profiles — even when it reports the SAME number of
// profiles as the scan — so Office/Agents reflect the live runtime instead of
// stale home-directory state. Exported for unit testing the decision in
// isolation from any live SSH host.
export function selectSshProfiles(
  launcher: LauncherProfileResult,
  scannedProfiles: SshProfileInfo[],
): SshProfileInfo[] {
  if (launcher.present && launcher.profiles.length > 0)
    return launcher.profiles;
  if (scannedProfiles.length > 0) return scannedProfiles;
  return launcher.profiles;
}

export async function sshListProfiles(
  config: SshConfig,
): Promise<SshProfileInfo[]> {
  const script = `
import os, json
hermes_home = os.path.expanduser("~/.hermes")
profiles_dir = os.path.join(hermes_home, "profiles")
profiles = []

def read_config(path):
    model, provider = "", "auto"
    config_file = os.path.join(path, "config.yaml")
    if os.path.exists(config_file):
        content = open(config_file).read()
        import re
        m = re.search(r'^\\s*default:\\s*["\\'\\']?([^"\\'\\' \\n#]+)["\\'\\']?', content, re.M)
        if m: model = m.group(1).strip()
        p = re.search(r'^\\s*provider:\\s*["\\'\\']?([^"\\'\\' \\n#]+)["\\'\\']?', content, re.M)
        if p: provider = p.group(1).strip()
    return model, provider

def count_skills(path):
    skills_dir = os.path.join(path, "skills")
    count = 0
    if os.path.isdir(skills_dir):
        for cat in os.listdir(skills_dir):
            cat_path = os.path.join(skills_dir, cat)
            if os.path.isdir(cat_path):
                for name in os.listdir(cat_path):
                    if os.path.exists(os.path.join(cat_path, name, "SKILL.md")):
                        count += 1
    return count

def gw_running(path):
    pid_file = os.path.join(path, "gateway.pid")
    if not os.path.exists(pid_file): return False
    try:
        raw = open(pid_file).read().strip()
        # \`hermes gateway run\` writes a JSON pidfile ({"pid": N, ...}); older
        # builds wrote a bare integer. Handle both.
        try:
            d = json.loads(raw)
            pid = int(d.get("pid") if isinstance(d, dict) else d)
        except Exception:
            pid = int(raw)
        os.kill(pid, 0)
        return True
    except:
        return False

# Default profile
model, provider = read_config(hermes_home)
profiles.append({
    "name": "default", "path": hermes_home, "isDefault": True, "isActive": True,
    "model": model, "provider": provider,
    "hasEnv": os.path.exists(os.path.join(hermes_home, ".env")),
    "hasSoul": os.path.exists(os.path.join(hermes_home, "SOUL.md")),
    "skillCount": count_skills(hermes_home),
    "gatewayRunning": gw_running(hermes_home)
})

if os.path.isdir(profiles_dir):
    for name in sorted(os.listdir(profiles_dir)):
        p = os.path.join(profiles_dir, name)
        if not os.path.isdir(p): continue
        model, provider = read_config(p)
        profiles.append({
            "name": name, "path": p, "isDefault": False, "isActive": False,
            "model": model, "provider": provider,
            "hasEnv": os.path.exists(os.path.join(p, ".env")),
            "hasSoul": os.path.exists(os.path.join(p, "SOUL.md")),
            "skillCount": count_skills(p),
            "gatewayRunning": gw_running(p)
        })

print(json.dumps(profiles))
`;
  const launcher = await sshDetectLauncherProfiles(config);

  try {
    const out = await sshPython(config, script);
    const scannedProfiles = JSON.parse(out.trim() || "[]") as SshProfileInfo[];
    return selectSshProfiles(launcher, scannedProfiles);
  } catch {
    // The filesystem scan failed (e.g. no python on the remote). A configured
    // launcher is still authoritative; otherwise fall back to a minimal default.
    if (launcher.present && launcher.profiles.length > 0) {
      return launcher.profiles;
    }
    return [
      {
        name: "default",
        path: "~/.hermes",
        isDefault: true,
        isActive: true,
        model: "",
        provider: "auto",
        hasEnv: false,
        hasSoul: false,
        skillCount: 0,
        gatewayRunning: false,
      },
    ];
  }
}

export async function sshCreateProfile(
  config: SshConfig,
  name: string,
  cloneFrom: string | null,
): Promise<{ success: boolean; error?: string }> {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return { success: false, error: "Invalid profile name" };
  const quoted = shellQuote(safe);
  try {
    if (cloneFrom) {
      const safeSource = cloneFrom.replace(/[^a-zA-Z0-9_-]/g, "") || "default";
      // No `|| mkdir` fallback here: a failed clone must surface as an error
      // rather than silently leaving an empty profile that copied no config,
      // keys, or skills. sshExec rejects on a non-zero exit, caught below.
      // buildRemoteHermesCmd locates the CLI in the remote venv/launcher when
      // `hermes` is not on the non-interactive SSH PATH; the subcommand is
      // `profile` (singular) to match the rest of the SSH profile calls.
      await sshExec(
        config,
        buildRemoteHermesCmd([
          "profile",
          "create",
          safe,
          "--clone-from",
          safeSource,
        ]),
      );
    } else {
      // A fresh profile is just a directory, so falling back to mkdir when the
      // remote CLI lacks the subcommand is an acceptable, lossless result.
      await sshExec(
        config,
        `${buildRemoteHermesCmd([
          "profile",
          "create",
          safe,
        ])} 2>&1 || mkdir -p ~/.hermes/profiles/${quoted}`,
      );
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create profile",
    };
  }
}

export async function sshDeleteProfile(
  config: SshConfig,
  name: string,
): Promise<boolean> {
  try {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe || safe === "default") return false;
    const quoted = shellQuote(safe);
    // `profile` (singular) subcommand, resolved via buildRemoteHermesCmd so it
    // works when `hermes` is not on the non-interactive SSH PATH; fall back to
    // a filesystem remove when the CLI is unavailable/lacks the subcommand.
    await sshExec(
      config,
      `${buildRemoteHermesCmd(
        ["profile", "delete", safe, "--yes"],
        " 2>&1",
      )} || rm -rf ~/.hermes/profiles/${quoted}`,
    );
    return true;
  } catch {
    return false;
  }
}

// ── Gateway ───────────────────────────────────────────────────────────────────
//
// In SSH mode the remote gateway may be owned by a systemd `hermes.service`
// unit — the standard VPS installer sets this up. Starting our own detached
// `nohup` gateway then strands that unit in a restart crash-loop (issue
// #285). Each operation below therefore asks the remote, in a single shell
// `if`, whether such a unit is installed and routes the request through
// systemd when it is — one SSH round-trip, atomic decision. The command
// strings are built by the exported helpers below so they can be unit
// tested without a live host.

/**
 * Shell test that succeeds when a systemd `hermes.service` unit file is
 * installed on the remote. Safe on hosts without systemd: a missing
 * `systemctl` yields empty output, so the test simply fails and callers
 * fall back to the plain (`nohup` / pidfile) path.
 */
const SYSTEMD_HERMES_UNIT_TEST =
  "systemctl list-unit-files hermes.service 2>/dev/null | " +
  "grep -q '^hermes\\.service'";

/**
 * Command to start the remote gateway (issue #285). When a systemd
 * `hermes.service` exists it owns the lifecycle, so the request is handed
 * to systemd — `hermes.service` is a system unit, so `sudo` is tried first,
 * then a direct call for when the SSH user is root. If neither works the
 * command does nothing on purpose: an unmanaged `nohup` orphan that
 * crash-loops the systemd unit is worse than a gateway that simply did not
 * start (the status check will then report it as down). The detached
 * `nohup` start is used only when there is no unit to collide with.
 */
function remoteGatewayPidPath(profile?: string): string {
  return profile && profile !== "default"
    ? `$HOME/.hermes/profiles/${profile}/gateway.pid`
    : "$HOME/.hermes/gateway.pid";
}

function remoteGatewayLogPath(profile?: string): string {
  return profile && profile !== "default"
    ? `$HOME/.hermes/profiles/${profile}/gateway.log`
    : "$HOME/.hermes/gateway.log";
}

export function buildGatewayStartCommand(profile?: string): string {
  // NB: `gateway run` (foreground, backgrounded here via nohup), NOT `gateway
  // start`. `gateway start` drives the systemd/launchd *service* and fails with
  // "Gateway service is not installed" on a bare VPS that never ran `hermes
  // gateway install` — which is the common SSH remote. `gateway run` launches
  // the gateway (and its api_server, when API_SERVER_ENABLED) directly and
  // writes ~/.hermes/gateway.pid, matching the pid-based status/stop commands
  // below. Hosts that DO have a systemd unit still go through systemctl.
  if (profile && profile !== "default") {
    return (
      `mkdir -p $HOME/.hermes/profiles/${profile}; ` +
      `(nohup ${buildRemoteHermesCmd(
        ["--profile", profile, "gateway", "run"],
        ` > ${remoteGatewayLogPath(profile)} 2>&1`,
      )} &); sleep 0.3`
    );
  }
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `sudo -n systemctl start hermes.service 2>/dev/null || ` +
    `systemctl start hermes.service 2>/dev/null || true; ` +
    `else ` +
    // buildRemoteHermesCmd (not bare `hermes`) so the run works on remotes
    // where `hermes` is not on the non-interactive SSH PATH (only the venv /
    // launcher locations) — matching the named-profile branch above.
    `(nohup ${buildRemoteHermesCmd(
      ["gateway", "run"],
      " > $HOME/.hermes/gateway.log 2>&1",
    )} &); sleep 0.3; ` +
    `fi`
  );
}

/**
 * Command to stop the remote gateway (issue #285). Routed through systemd
 * when a `hermes.service` unit exists, so the unit is left cleanly inactive
 * rather than the desktop killing a process systemd would just restart;
 * otherwise it falls back to `hermes gateway stop` and, last resort, the
 * recorded pid.
 */
export function buildGatewayStopCommand(profile?: string): string {
  if (profile && profile !== "default") {
    const pidPath = remoteGatewayPidPath(profile);
    return (
      `${buildRemoteHermesCmd(["--profile", profile, "gateway", "stop"], " 2>/dev/null")} || ` +
      `(if [ -f ${pidPath} ]; then ` +
      `pid=$(python3 -c "import json; d=json.load(open('${pidPath}')); print(d['pid'] if isinstance(d,dict) else d)" 2>/dev/null); ` +
      `[ -n "$pid" ] && kill $pid 2>/dev/null; fi); true`
    );
  }
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `sudo -n systemctl stop hermes.service 2>/dev/null || ` +
    `systemctl stop hermes.service 2>/dev/null || true; ` +
    `else ` +
    // buildRemoteHermesCmd (not bare `hermes`) so stop works on remotes where
    // `hermes` is not on the non-interactive SSH PATH — matching the named-
    // profile branch above; the recorded-pid kill remains the last resort.
    `${buildRemoteHermesCmd(["gateway", "stop"], " 2>/dev/null")} || ` +
    `(if [ -f $HOME/.hermes/gateway.pid ]; then ` +
    `pid=$(python3 -c "import json; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d['pid'] if isinstance(d,dict) else d)" 2>/dev/null); ` +
    `[ -n "$pid" ] && kill $pid 2>/dev/null; fi); true; ` +
    `fi`
  );
}

/**
 * Command to report remote gateway state (issue #285). For a systemd-managed
 * gateway this is the unit's `is-active` state (`active` when up); otherwise
 * it is a liveness check on the recorded pid. Prints `active` or `running`
 * when up, anything else when not.
 */
export function buildGatewayStatusCommand(profile?: string): string {
  if (profile && profile !== "default") {
    const pidPath = remoteGatewayPidPath(profile);
    return (
      `if [ -f ${pidPath} ]; then ` +
      `pid=$(python3 -c "import json,sys; d=json.load(open('${pidPath}')); print(d.get('pid',d) if isinstance(d,dict) else d)" 2>/dev/null || cat ${pidPath}); ` +
      `kill -0 $pid 2>/dev/null && echo "running" || echo "stopped"; ` +
      `else echo "stopped"; fi`
    );
  }
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `systemctl is-active hermes.service 2>/dev/null || true; ` +
    `else ` +
    `if [ -f $HOME/.hermes/gateway.pid ]; then ` +
    `pid=$(python3 -c "import json,sys; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d.get('pid',d) if isinstance(d,dict) else d)" 2>/dev/null || cat $HOME/.hermes/gateway.pid); ` +
    `kill -0 $pid 2>/dev/null && echo "running" || echo "stopped"; ` +
    `else echo "stopped"; fi; ` +
    `fi`
  );
}

export async function sshGatewayStatus(
  config: SshConfig,
  profile?: string,
): Promise<boolean> {
  try {
    const out = await sshExec(config, buildGatewayStatusCommand(profile));
    const state = out.trim();
    return state === "running" || state === "active";
  } catch {
    return false;
  }
}

// In-flight dedup so a connect storm (model-library + chat + sessions firing at
// once, each finding "no gateway" before any start writes the pidfile) can't
// launch several `gateway run` processes — observed as 4+ concurrent gateways
// piling up and OOM-killing a small remote. Re-checks status inside the guard so
// a gateway that came up between the caller's check and here isn't duplicated.
const gatewayStartPromises = new Map<string, Promise<void>>();

export async function sshStartGateway(
  config: SshConfig,
  profile?: string,
): Promise<void> {
  const key = `${config.host}:${config.port || 22}:${config.username}:${profile || "default"}`;
  const inflight = gatewayStartPromises.get(key);
  if (inflight) return inflight;

  const run = (async (): Promise<void> => {
    if (await sshGatewayStatus(config, profile)) return; // already up — don't duplicate
    try {
      await sshExec(config, buildGatewayStartCommand(profile));
    } catch {
      // best effort
    }
  })();
  gatewayStartPromises.set(key, run);
  try {
    await run;
  } finally {
    gatewayStartPromises.delete(key);
  }
}

export async function sshStopGateway(
  config: SshConfig,
  profile?: string,
): Promise<void> {
  try {
    await sshExec(config, buildGatewayStopCommand(profile));
  } catch {
    // best effort
  }
}

export async function sshResolveApiServerPort(
  config: SshConfig,
  profile?: string,
): Promise<number> {
  if (!profile || profile === "default") return config.remotePort || 8642;
  const fallbackPort = config.remotePort || 8642;
  const script = `
import json, os, re, sys

payload = json.loads(sys.stdin.read() or "{}")
profile = payload.get("profile")
fallback_port = int(payload.get("fallbackPort") or 8642)
home = os.path.expanduser("~/.hermes")
profiles_dir = os.path.join(home, "profiles")

def config_path(name):
    if name and name != "default":
        return os.path.join(profiles_dir, name, "config.yaml")
    return os.path.join(home, "config.yaml")

def read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""

def line_indent(line):
    return len(line) - len(line.lstrip(" "))

def api_server_bounds(lines):
    for i, line in enumerate(lines):
        if re.match(r"^\\s*api_server\\s*:\\s*(?:#.*)?$", line):
            indent = line_indent(line)
            end = len(lines)
            for j in range(i + 1, len(lines)):
                if lines[j].strip() and line_indent(lines[j]) <= indent:
                    end = j
                    break
            return i, end, indent
    return None

def configured_port(text):
    lines = text.splitlines()
    bounds = api_server_bounds(lines)
    if not bounds:
        return None
    start, end, _ = bounds
    for line in lines[start + 1:end]:
        m = re.match(r"^\\s*port\\s*:\\s*[\\"']?(\\d+)[\\"']?\\s*(?:#.*)?$", line)
        if m:
            port = int(m.group(1))
            if 0 < port < 65536:
                return port
    return None

def existing_ports():
    ports = {fallback_port}
    paths = [config_path(None)]
    if os.path.isdir(profiles_dir):
        for name in os.listdir(profiles_dir):
            p = os.path.join(profiles_dir, name)
            if os.path.isdir(p):
                paths.append(os.path.join(p, "config.yaml"))
    for path in paths:
        port = configured_port(read(path))
        if port:
            ports.add(port)
    return ports

def allocate_port():
    used = existing_ports()
    for port in range(fallback_port + 1, min(65535, fallback_port + 100) + 1):
        if port not in used:
            return port
    return fallback_port

def ensure_profile_port(path, port):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = read(path)
    lines = text.splitlines()
    bounds = api_server_bounds(lines)
    if bounds:
        start, end, indent = bounds
        for i in range(start + 1, end):
            if re.match(r"^\\s*port\\s*:", lines[i]):
                lines[i] = " " * line_indent(lines[i]) + f"port: {port}"
                break
        else:
            extra_index = None
            extra_indent = indent + 2
            for i in range(start + 1, end):
                if re.match(r"^\\s*extra\\s*:\\s*(?:#.*)?$", lines[i]):
                    extra_index = i
                    extra_indent = line_indent(lines[i])
                    break
            if extra_index is not None:
                lines.insert(extra_index + 1, " " * (extra_indent + 2) + f"port: {port}")
            else:
                lines.insert(start + 1, " " * (indent + 2) + "enabled: true")
                lines.insert(start + 2, " " * (indent + 2) + "extra:")
                lines.insert(start + 3, " " * (indent + 4) + f"port: {port}")
    else:
        platforms_index = None
        for i, line in enumerate(lines):
            if re.match(r"^\\s*platforms\\s*:\\s*(?:#.*)?$", line):
                platforms_index = i
                break
        block = ["  api_server:", "    enabled: true", "    extra:", f"      port: {port}"]
        if platforms_index is not None:
            lines[platforms_index + 1:platforms_index + 1] = block
        else:
            if lines and lines[-1].strip():
                lines.append("")
            lines.extend(["platforms:", *block])
    with open(path, "w", encoding="utf-8") as f:
        f.write("\\n".join(lines) + "\\n")

path = config_path(profile)
current = configured_port(read(path))
if current:
    print(current)
else:
    port = allocate_port()
    ensure_profile_port(path, port)
    print(port)
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, fallbackPort }),
    );
    const port = parseInt(out.trim(), 10);
    if (port > 0 && port < 65536) return port;
  } catch (err) {
    console.warn(
      "[ssh] Failed to allocate remote profile API port:",
      err instanceof Error ? err.message : String(err),
    );
  }
  return fallbackPort;
}

// ── Remote API key (for chat auth through SSH tunnel) ─────────────────────────

export async function sshReadRemoteApiKey(config: SshConfig): Promise<string> {
  try {
    const env = await sshReadEnv(config);
    return env["API_SERVER_KEY"] || "";
  } catch {
    return "";
  }
}

// The gateway api_server refuses to bind with a key shorter than 16 chars or an
// obvious placeholder, so chat over /v1 can never connect with one. Mirrors the
// remote-side guard.
const MIN_API_SERVER_KEY_LENGTH = 16;
const PLACEHOLDER_API_SERVER_KEY =
  /^(?:changeme|placeholder|your[-_]?(?:api[-_]?)?key|api[-_]?server[-_]?key|secret|password|token)$/i;

export function isUsableApiServerKey(key: string): boolean {
  const k = (key || "").trim();
  return (
    k.length >= MIN_API_SERVER_KEY_LENGTH && !PLACEHOLDER_API_SERVER_KEY.test(k)
  );
}

export interface SshApiServerKeyResult {
  key: string;
  /** True when the key and/or enable flag were just written — the caller must
   *  (re)start the gateway so the api_server platform picks them up. */
  created: boolean;
}

// Provision the remote gateway api_server for SSH chat over /v1 — the no-build
// transport (no dashboard web dist, no Node) used by remote mode and
// hermes-webui's gateway backend. SSH mode, unlike local mode (startGateway),
// never WROTE these to the remote, so a fresh server had no /v1 endpoint at all:
// the api_server refuses to start without API_SERVER_KEY, and the gateway only
// loads the api_server platform when API_SERVER_ENABLED is truthy
// (gateway/config.py). Ensures both, generating a key when missing/invalid.
// In-flight dedup — same race class as the dashboard token: this is ensured on
// every chat, so concurrent first-connect callers could each see "no key" and
// append a different generated API_SERVER_KEY, leaving the gateway (dotenv
// last-wins) on one value while a caller cached another → 401 over /v1.
const apiServerKeyPromises = new Map<string, Promise<SshApiServerKeyResult>>();

export async function sshEnsureApiServerKey(
  config: SshConfig,
  profile?: string,
): Promise<SshApiServerKeyResult> {
  const cacheKey = `${config.host}:${config.port || 22}:${config.username}:${profile || "default"}`;
  const inflight = apiServerKeyPromises.get(cacheKey);
  if (inflight) return inflight;

  const run = (async (): Promise<SshApiServerKeyResult> => {
    let existing = "";
    let enabled = false;
    try {
      const env = await sshReadEnv(config, profile);
      existing = (env["API_SERVER_KEY"] || "").trim();
      enabled = ["true", "1", "yes"].includes(
        (env["API_SERVER_ENABLED"] || "").trim().toLowerCase(),
      );
    } catch {
      // remote .env missing/unreadable — provision from scratch below.
    }

    let key = existing;
    let created = false;
    if (!isUsableApiServerKey(existing)) {
      key = randomBytes(24).toString("hex"); // 48 hex chars, well over the minimum
      await sshSetEnvValue(config, "API_SERVER_KEY", key, profile);
      created = true;
    }
    if (!enabled) {
      await sshSetEnvValue(config, "API_SERVER_ENABLED", "true", profile);
      created = true; // gateway must (re)start to load the api_server platform
    }
    return { key, created };
  })();

  apiServerKeyPromises.set(cacheKey, run);
  try {
    return await run;
  } finally {
    apiServerKeyPromises.delete(cacheKey);
  }
}

// Poll the remote api_server's /health on the given loopback port until it
// answers or the deadline passes. Runs on the remote via python3 (no curl
// dependency). Lets a freshly (re)started gateway finish binding before we open
// the tunnel, so the first chat doesn't race "tunnel health check failed".
export async function sshWaitGatewayApiReady(
  config: SshConfig,
  port: number,
  timeoutMs = 20000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const script =
    `import urllib.request as u\n` +
    `try:\n` +
    ` print(u.urlopen("http://127.0.0.1:${port}/health", timeout=3).status)\n` +
    `except Exception:\n` +
    ` print(0)`;
  while (Date.now() <= deadline) {
    try {
      const out = await sshExec(
        config,
        `python3 -c ${shellQuote(script)}`,
        undefined,
        8000,
      );
      if (out.trim() === "200") return true;
    } catch {
      // transient — keep polling until the deadline
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ── Dashboard lifecycle ─────────────────────────────────────────────────────
//
// Dashboard transport over SSH. The desktop starts `hermes dashboard` on the
// remote and tunnels to it for the model library, session list, and the chat
// WebSocket (/api/ws) — the surfaces the gateway api_server does NOT serve.
//
// IMPORTANT: the dashboard is NOT a /v1 superset. hermes_cli/web_server.py has
// no /v1/chat|responses|runs routes and does not proxy /v1 to the gateway, so
// chat over the dashboard tunnel uses /api/ws (token auth), never /v1. The /v1
// chat transport lives ONLY on the gateway api_server (port 8642, API_SERVER_KEY
// auth); see sshEnsureApiServerKey + prepareSshTunnel's gateway branch. The
// dashboard also requires a built web dist (Node), which gateway-only installs
// lack — those fall back to the gateway /v1 path. Its /api/* routes are gated by
// HERMES_DASHBOARD_SESSION_TOKEN (the api_server key is rejected there).

const REMOTE_DASHBOARD_DEFAULT_PORT = 9119;
const REMOTE_DASHBOARD_PORT_ENV = "HERMES_DESKTOP_DASHBOARD_PORT";

function remoteDashboardLogPath(profile?: string): string {
  return profile && profile !== "default"
    ? `$HOME/.hermes/profiles/${profile}/dashboard.log`
    : "$HOME/.hermes/dashboard.log";
}

// Read the dashboard session token from the remote .env (per profile),
// generating + persisting one when absent so it stays stable across reconnects
// and is shared by the remote dashboard process and the desktop client.
// In-flight dedup so a connect storm (the dashboard is ensured on every chat /
// model-library / session op) can't run several token provisions at once. The
// previous raw `printf >> .env` had no guard, so concurrent callers each read
// "no token" and appended a different one — observed as 9 divergent
// HERMES_DASHBOARD_SESSION_TOKEN lines in one remote .env, where dotenv's
// last-wins value drifted from whatever a caller cached.
const dashboardTokenPromises = new Map<string, Promise<string>>();

export async function sshEnsureDashboardToken(
  config: SshConfig,
  profile?: string,
): Promise<string> {
  const envPath = remoteEnvPath(profile);
  const cacheKey = `${config.host}:${config.port || 22}:${config.username}:${envPath}`;
  const inflight = dashboardTokenPromises.get(cacheKey);
  if (inflight) return inflight;

  const run = (async (): Promise<string> => {
    let token = "";
    try {
      const env = await sshReadEnv(config, profile);
      token = (env["HERMES_DASHBOARD_SESSION_TOKEN"] || "").trim();
    } catch {
      // .env missing/unreadable — generate below.
    }
    if (!token) token = randomBytes(24).toString("hex");
    // Write exactly ONE canonical line: strip any existing (possibly duplicated)
    // entries, append one, then truncate-in-place via `cat > file` so the file's
    // permissions/owner are preserved. Idempotent and self-heals prior dupes.
    await sshExec(
      config,
      `mkdir -p "$(dirname ${envPath})" 2>/dev/null; ` +
        `touch ${envPath}; ` +
        `tmp=${envPath}.tmp.$$; ` +
        `grep -v '^HERMES_DASHBOARD_SESSION_TOKEN=' ${envPath} > $tmp 2>/dev/null || true; ` +
        `printf 'HERMES_DASHBOARD_SESSION_TOKEN=%s\\n' ${shellQuote(token)} >> $tmp; ` +
        `cat $tmp > ${envPath}; rm -f $tmp`,
    );
    return token;
  })();

  dashboardTokenPromises.set(cacheKey, run);
  try {
    return await run;
  } finally {
    dashboardTokenPromises.delete(cacheKey);
  }
}

// Resolve the remote dashboard port. Default profile uses 9119; named profiles
// get a distinct stable port derived from their api_server port so they never
// collide with the default or each other.
export async function sshResolveDashboardPort(
  config: SshConfig,
  profile?: string,
): Promise<number> {
  try {
    const env = await sshReadEnv(config, profile);
    const persisted = Number.parseInt(env[REMOTE_DASHBOARD_PORT_ENV] || "", 10);
    if (persisted > 0 && persisted < 65536) return persisted;
  } catch {
    // Fall through to the stable preferred port.
  }
  if (!profile || profile === "default") return REMOTE_DASHBOARD_DEFAULT_PORT;
  const apiPort = await sshResolveApiServerPort(config, profile);
  return REMOTE_DASHBOARD_DEFAULT_PORT + (apiPort - 8642);
}

async function sshAllocateDashboardPort(config: SshConfig): Promise<number> {
  const script = `
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
`;
  const out = await sshPython(config, script);
  const port = Number.parseInt(out.trim(), 10);
  if (!(port > 0 && port < 65536)) {
    throw new Error("Remote host did not return a valid dashboard port.");
  }
  return port;
}

async function sshPersistDashboardPort(
  config: SshConfig,
  profile: string | undefined,
  port: number,
): Promise<void> {
  const envPath = remoteEnvPath(profile);
  // Write exactly ONE canonical line (strip any prior entries, then append) so
  // repeated port reallocations don't accumulate duplicate
  // HERMES_DESKTOP_DASHBOARD_PORT lines — sshReadEnv is last-wins, so dupes
  // "worked" by luck but drifted and grew. cat-in-place preserves perms.
  await sshExec(
    config,
    `mkdir -p "$(dirname ${envPath})" 2>/dev/null; ` +
      `touch ${envPath}; ` +
      `tmp=${envPath}.tmp.$$; ` +
      `grep -v '^${REMOTE_DASHBOARD_PORT_ENV}=' ${envPath} > $tmp 2>/dev/null || true; ` +
      `printf '${REMOTE_DASHBOARD_PORT_ENV}=%s\\n' ${shellQuote(String(port))} >> $tmp; ` +
      `cat $tmp > ${envPath}; rm -f $tmp`,
  );
}

// Remote-side readiness probe: is the dashboard answering /api/status on the
// given loopback port? (/api/status is unauthenticated.) Runs on the remote via
// python3 so it needs no curl on the host.
export async function sshDashboardRunning(
  config: SshConfig,
  port: number,
): Promise<boolean> {
  try {
    const script =
      `import urllib.request as u\n` +
      `try:\n` +
      ` print(u.urlopen("http://127.0.0.1:${port}/api/status", timeout=3).status)\n` +
      `except Exception:\n` +
      ` print(0)`;
    const out = await sshExec(
      config,
      `python3 -c ${shellQuote(script)}`,
      undefined,
      8000,
    );
    return out.trim() === "200";
  } catch {
    return false;
  }
}

// A public /api/status response only proves that *something* HTTP-speaking is
// bound to the dashboard port. Verify an authenticated dashboard route before
// handing the target to callers; otherwise a stale dashboard (different token)
// or another service on 9119 is mistaken for a usable dashboard, leading to
// /api/* 401s and legacy /v1 chat being POSTed to the wrong server (405).
export async function sshDashboardAuthenticated(
  config: SshConfig,
  port: number,
  token: string,
): Promise<boolean> {
  const script = `
import json
import sys
import urllib.request

payload = json.loads(sys.stdin.read() or "{}")
port = int(payload.get("port") or 0)
token = str(payload.get("token") or "")
request = urllib.request.Request(
    f"http://127.0.0.1:{port}/api/sessions?limit=1",
    headers={"X-Hermes-Session-Token": token},
)
try:
    with urllib.request.urlopen(request, timeout=3) as response:
        print(response.status)
except Exception:
    print(0)
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ port, token }),
      8000,
    );
    return out.trim() === "200";
  } catch {
    return false;
  }
}

// Start `hermes dashboard` on the remote, bound to loopback (the SSH tunnel
// terminates there) with --skip-build (the web dist is prebuilt) and the
// session token in its env. Backgrounded so the exec returns.
export async function sshStartDashboard(
  config: SshConfig,
  profile: string | undefined,
  port: number,
  token: string,
): Promise<void> {
  // Always the unified machine dashboard (no --profile / --isolated): one server
  // serves every profile's data via `?profile=`, so the single global SSH tunnel
  // has exactly one target. Per-profile isolated dashboards on distinct ports
  // thrash that tunnel when the app queries multiple profiles at once. `profile`
  // is accepted for signature compatibility but intentionally unused.
  void profile;
  const cmd = buildRemoteHermesCmd([
    "dashboard",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--no-open",
    "--skip-build",
  ]);
  const log = remoteDashboardLogPath(profile);
  await sshExec(
    config,
    `(nohup env HERMES_DASHBOARD_SESSION_TOKEN=${shellQuote(
      token,
    )} ${cmd} > ${log} 2>&1 &); sleep 0.2`,
  );
}

// Poll the remote readiness probe until the dashboard answers or the deadline
// passes.
export async function sshWaitDashboardReady(
  config: SshConfig,
  port: number,
  timeoutMs = 30000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await sshDashboardRunning(config, port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export interface SshDashboardTarget {
  port: number;
  token: string;
}

const dashboardDistBuildPromises = new Map<string, Promise<boolean>>();

// Candidate hermes-agent install roots, most specific first. A system-wide
// install (the Linux package / install.sh default) lives at
// /usr/local/lib/hermes-agent — NOT under $HOME — so a hardcoded
// ~/.hermes/hermes-agent path wrongly concludes the dashboard web dist is
// absent and forces every SSH connection into basic chat. Mirrors the resolver
// philosophy of buildRemoteHermesCmd.
const REMOTE_HERMES_ROOT_CANDIDATES = [
  "/usr/local/lib/hermes-agent",
  "$HOME/.hermes/hermes-agent",
  "/opt/hermes/hermes-agent",
  "$HOME/hermes-agent",
];

// Resolve the remote hermes-agent install root that has (or can build) the
// dashboard web dist. Returns the first candidate whose built dist exists, else
// the first that has the `web/` workspace (buildable), else null. One round
// trip.
export async function sshResolveDashboardRoot(
  config: SshConfig,
): Promise<string | null> {
  const roots = REMOTE_HERMES_ROOT_CANDIDATES.join(" ");
  // Prefer a root with the prebuilt dist; fall back to one with web sources.
  const script =
    `built=""; buildable=""; ` +
    `for r in ${roots}; do ` +
    `  if [ -z "$built" ] && [ -f "$r/hermes_cli/web_dist/index.html" ]; then built="$r"; fi; ` +
    `  if [ -z "$buildable" ] && [ -f "$r/web/package.json" ]; then buildable="$r"; fi; ` +
    `done; ` +
    `if [ -n "$built" ]; then echo "$built"; elif [ -n "$buildable" ]; then echo "$buildable"; fi`;
  try {
    const out = (await sshExec(config, script, undefined, 10000)).trim();
    return out || null;
  } catch {
    return null;
  }
}

// Ensure the dashboard web dist is built on the remote so `hermes dashboard
// --skip-build` can serve it. Resolves the real install root first (system-wide
// or under $HOME), so an already-built dist is detected wherever hermes lives.
// The install vendors Node (~/.hermes/node) and the web workspace deps, so a
// missing dist just needs the vite build (→ hermes_cli/web_dist). Returns true
// when the dist exists (already or after building), false when it can't (no
// install with web sources / no Node / build failed) — sshEnsureDashboard then
// reports the dashboard unavailable and the desktop falls back to legacy.
// Concurrent callers share one in-flight build so a connect storm can't kick
// off several `npm run build` at once.
export async function sshEnsureDashboardDist(
  config: SshConfig,
): Promise<boolean> {
  const root = await sshResolveDashboardRoot(config);
  if (!root) return false;
  const marker = `${root}/hermes_cli/web_dist/index.html`;
  const exists = async (): Promise<boolean> => {
    try {
      const out = await sshExec(
        config,
        `[ -f "${marker}" ] && echo yes || echo no`,
        undefined,
        10000,
      );
      return out.trim() === "yes";
    } catch {
      return false;
    }
  };
  if (await exists()) return true;
  // Keyed by host (like the other in-flight maps): a stale in-flight build for
  // a PREVIOUS remote must not be handed to a caller targeting a new one.
  const buildKey = `${config.host}:${config.port || 22}:${config.username}`;
  const inflight = dashboardDistBuildPromises.get(buildKey);
  if (inflight) return inflight;
  const run = (async () => {
    try {
      // tsc -b && vite build. Prefer the vendored Node, fall back to system
      // Node/npm on PATH. Generous timeout: a first build on a small VPS can
      // take a few minutes.
      await sshExec(
        config,
        `cd "${root}" && ` +
          `PATH="$HOME/.hermes/node/bin:$PATH" npm run build -w web 2>&1`,
        undefined,
        300000,
      );
    } catch {
      // build failed (no Node, missing deps, …) — fall through to re-check
    }
    return exists();
  })();
  dashboardDistBuildPromises.set(buildKey, run);
  try {
    return await run;
  } finally {
    dashboardDistBuildPromises.delete(buildKey);
  }
}

// Negative cache: the dashboard is "ensured" on every chat / model-library /
// session op. Only cache a *permanent* failure — the remote has no web dist and
// can't build one (a gateway-only install) — so we don't re-run the heavy build
// probe every call. A TRANSIENT failure (the dashboard is still starting, a
// readiness/auth blip) must NOT be cached: caching it would force chat's
// `prepareSshTunnel` onto the gateway /v1 tunnel (8642) while model-library still
// targets the dashboard port, and the single global SSH tunnel would thrash
// between them ("SSH tunnel is not active" / 405). In-flight dedup collapses a
// connect storm into one probe regardless.
const DASHBOARD_UNAVAILABLE_TTL_MS = 60_000;
const dashboardUnavailableUntil = new Map<string, number>();
const dashboardEnsurePromises = new Map<
  string,
  Promise<SshDashboardTarget | null>
>();

function dashboardCacheKey(config: SshConfig, _profile?: string): string {
  // Machine-scoped (NOT per-profile): the unified dashboard is one server for
  // all profiles, so all profiles share one cache/in-flight entry and one tunnel
  // target. Keying per-profile would let concurrent profiles each ensure/tunnel
  // separately and thrash the single global tunnel.
  return `${config.host}:${config.port || 22}:${config.username}`;
}

// Clear the dashboard negative cache — call when the connection config changes
// so a freshly (re)configured remote is probed immediately, not after the TTL.
export function resetSshDashboardAvailability(): void {
  dashboardUnavailableUntil.clear();
}

// Ensure the remote has a running dashboard for SSH transport. Starts the
// gateway too (messaging/cron stays up, and chat keeps a working /v1 endpoint),
// builds the web dist if missing, then starts the dashboard and waits for
// readiness. Returns the port + token to tunnel to, or null when the remote
// can't run the dashboard (no web dist, or it won't become ready) — callers then
// fall back to the gateway-only /v1 path (see prepareSshTunnel).
export async function sshEnsureDashboard(
  config: SshConfig,
  profile?: string,
): Promise<SshDashboardTarget | null> {
  const cacheKey = dashboardCacheKey(config, profile);
  const until = dashboardUnavailableUntil.get(cacheKey);
  if (until && until > Date.now()) return null; // remote can't run a dashboard — skip the probe
  const inflight = dashboardEnsurePromises.get(cacheKey);
  if (inflight) return inflight;

  const run = (async (): Promise<SshDashboardTarget | null> => {
    const target = await ensureDashboardInner(config, profile);
    if (target) {
      dashboardUnavailableUntil.delete(cacheKey);
      return target;
    }
    // Only latch the negative cache for the PERMANENT case (no buildable web
    // dist). Transient failures stay uncached so the next op retries and the
    // tunnel target stays consistent (dashboard, not gateway) — avoiding thrash.
    const distOk = await sshEnsureDashboardDist(config).catch(() => false);
    if (!distOk) {
      dashboardUnavailableUntil.set(
        cacheKey,
        Date.now() + DASHBOARD_UNAVAILABLE_TTL_MS,
      );
    }
    return null;
  })();
  dashboardEnsurePromises.set(cacheKey, run);
  try {
    return await run;
  } finally {
    dashboardEnsurePromises.delete(cacheKey);
  }
}

async function ensureDashboardInner(
  config: SshConfig,
  profile?: string,
): Promise<SshDashboardTarget | null> {
  // The dashboard is the UNIFIED machine dashboard (default profile, one port +
  // one token) for EVERY profile — NOT a per-profile isolated server. `hermes
  // dashboard` serves any profile's data via `?profile=`, and the desktop has a
  // single global SSH tunnel that can only point at one remote port. Per-profile
  // dashboard ports (the old `--isolated` approach) made concurrent profile
  // queries (e.g. `default` + `accessibility-auditor`) resolve different ports
  // and thrash that one tunnel ("SSH tunnel is not active"). So all dashboard
  // resolution here uses the machine scope (profile=undefined); callers pass the
  // requested profile to the dashboard OPS as `?profile=` for per-profile data.
  void profile; // intentionally machine-scoped
  if (!(await sshGatewayStatus(config))) {
    await sshStartGateway(config);
  }
  const token = await sshEnsureDashboardToken(config);
  let port = await sshResolveDashboardPort(config);
  if (await sshDashboardRunning(config, port)) {
    if (await sshDashboardAuthenticated(config, port, token)) {
      return { port, token };
    }
    // The preferred/persisted port belongs to a stale dashboard with another
    // token (or a different HTTP service). Do not kill an externally managed
    // process. Move this desktop-managed dashboard to a free remote port and
    // persist it so every later IPC call and app restart reuses the same target.
    port = await sshAllocateDashboardPort(config);
    await sshPersistDashboardPort(config, undefined, port);
  }
  // Build the web dist if it isn't there yet (first connect to a fresh install
  // that ran the installer but never built the dashboard UI). Without a dist,
  // `dashboard --skip-build` can't serve, so treat an unbuildable remote as
  // dashboard-unavailable → legacy fallback.
  if (!(await sshEnsureDashboardDist(config))) return null;
  await sshStartDashboard(config, undefined, port, token);
  if (
    (await sshWaitDashboardReady(config, port)) &&
    (await sshDashboardAuthenticated(config, port, token))
  ) {
    return { port, token };
  }
  return null;
}

// ── Versions ──────────────────────────────────────────────────────────────────

export async function sshGetHermesVersion(
  config: SshConfig,
): Promise<string | null> {
  try {
    // Use the venv-probe path so the version string is the real multi-line
    // output (Engine / Released / Python / OpenAI SDK) the Settings UI
    // parses, not an empty string when the /usr/local/bin/hermes wrapper
    // refuses to run as the hermes user. See buildRemoteHermesCmd notes.
    const out = await sshExec(
      config,
      buildRemoteHermesCmd(["--version"], " 2>/dev/null"),
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

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

export interface SshCronResult {
  success: boolean;
  error?: string;
  stdout?: string;
}

export async function sshRunCron(
  config: SshConfig,
  args: string[],
  opts: { profile?: string; timeoutMs?: number } = {},
): Promise<SshCronResult> {
  const cliArgs: string[] = [];
  if (opts.profile && opts.profile !== "default") {
    cliArgs.push("-p", opts.profile);
  }
  cliArgs.push("cron", ...args);
  try {
    const stdout = await sshExec(
      config,
      buildRemoteHermesCmd(cliArgs),
      undefined,
      opts.timeoutMs ?? 15000,
    );
    return { success: true, stdout };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Remote cron command failed",
    };
  }
}

// ── Claw3D HQ board (read-only) ───────────────────────────────────────────────
//
// Claw3D ("hermes-office") maintains its own headquarters task board independent
// of `hermes kanban`. It stores tasks at
// `<state-dir>/claw3d/task-manager/tasks.json`, where <state-dir> resolves to
// `~/.openclaw` (new) or `~/.clawdbot` / `~/.moltbot` (legacy) — see
// hermes-office/src/lib/clawdbot/paths.ts. We surface it as a virtual,
// read-only second board in the desktop's Kanban tab so the Claw3D HQ cards
// are visible alongside the agent dispatcher's own board.

interface Claw3dSharedTaskRecord {
  id: string;
  title: string;
  description?: string;
  status?: string;
  source?: string;
  assignedAgentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  channel?: string | null;
  notes?: unknown;
  isArchived?: boolean;
}

// Claw3D's TaskBoardStatus → desktop kanban column. Claw3D has no "triage" or
// "ready" semantics, so `review` (awaiting attention) lands in "ready" and
// `in_progress` maps to "running". Everything else is straight-through.
const CLAW3D_STATUS_MAP: Record<string, KanbanTask["status"]> = {
  todo: "todo",
  in_progress: "running",
  blocked: "blocked",
  review: "ready",
  done: "done",
};

function parseIsoToEpochSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function mapClaw3dTaskToKanbanTask(raw: Claw3dSharedTaskRecord): KanbanTask {
  const status = (raw.status && CLAW3D_STATUS_MAP[raw.status]) || "todo";
  const createdAt = parseIsoToEpochSeconds(raw.createdAt);
  return {
    id: raw.id,
    title: raw.title,
    body: raw.description?.trim() || null,
    assignee: raw.assignedAgentId?.trim() || null,
    status,
    priority: 0,
    tenant: null,
    workspace_kind: "scratch",
    workspace_path: null,
    created_by: raw.source || null,
    created_at: createdAt,
    started_at: null,
    completed_at:
      status === "done" ? parseIsoToEpochSeconds(raw.updatedAt) : null,
    result: null,
    skills: [],
    max_retries: null,
  };
}

// Candidate state dirs mirror hermes-office's resolveStateDir() precedence:
// new `.openclaw` first, then legacy `.clawdbot` / `.moltbot`.
const CLAW3D_TASKS_PATHS = [
  "~/.openclaw/claw3d/task-manager/tasks.json",
  "~/.clawdbot/claw3d/task-manager/tasks.json",
  "~/.moltbot/claw3d/task-manager/tasks.json",
];

export interface SshClaw3dHqResult {
  success: boolean;
  tasks?: KanbanTask[];
  error?: string;
  source?: string; // resolved remote path
}

export async function sshListClaw3dHqTasks(
  config: SshConfig,
): Promise<SshClaw3dHqResult> {
  for (const remotePath of CLAW3D_TASKS_PATHS) {
    let raw = "";
    try {
      raw = await sshReadFile(config, remotePath);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw) as { tasks?: unknown };
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      const mapped = tasks
        .filter(
          (t): t is Claw3dSharedTaskRecord =>
            Boolean(t) &&
            typeof t === "object" &&
            typeof (t as Claw3dSharedTaskRecord).id === "string" &&
            typeof (t as Claw3dSharedTaskRecord).title === "string",
        )
        .filter((t) => !t.isArchived)
        .map(mapClaw3dTaskToKanbanTask);
      return { success: true, tasks: mapped, source: remotePath };
    } catch (err) {
      return {
        success: false,
        error: `Failed to parse Claw3D tasks.json: ${(err as Error).message}`,
      };
    }
  }
  // No file found at any candidate path — that's fine, just means the user
  // hasn't run Claw3D's HQ board yet. Return empty rather than erroring so
  // the renderer can still show an empty HQ board placeholder.
  return { success: true, tasks: [] };
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
      `sh -c 'case "$2" in "~/"*) p="$HOME/\${2#~/}" ;; "\\$HOME/"*) p="$HOME/\${2#\\$HOME/}" ;; *) p="$2" ;; esac; tail -n "$1" -- "$p" 2>/dev/null || echo ""' -- ${shellQuote(String(safeLines))} ${shellQuote(remotePath)}`,
    );
    return { content: content.trim(), path: `~/.hermes/logs/${file}` };
  } catch {
    return { content: "", path: `~/.hermes/logs/${file}` };
  }
}

// ── Platform toggles (Gateway page) ──────────────────────────────────────────

const SSH_SUPPORTED_PLATFORMS = [
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "signal",
  "matrix",
  "mattermost",
  "email",
  "sms",
  "bluebubbles",
  "dingtalk",
  "feishu",
  "wecom",
  "wecom_callback",
  "weixin",
  "qqbot",
  "yuanbao",
  "api_server",
  "webhook",
  "webhooks",
  "homeassistant",
  "home_assistant",
];

// Map from app platform keys to gateway_state.json keys (where they differ)
const PLATFORM_STATE_KEY: Record<string, string> = {
  home_assistant: "homeassistant",
  webhooks: "webhook",
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
    contextFolder: null,
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
// desktop.
// `command -v hermes` alone is not enough: the desktop's non-interactive SSH
// does not source `~/.profile`/`~/.bashrc`, so any PATH additions made there
// are not visible.
//
// Exported for unit testing the probe list without a live remote host.
export function buildRemoteHermesCmd(args: string[], extraShell = ""): string {
  const launcherCandidates = REMOTE_HERMES_LAUNCHER_CANDIDATES;
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
  return `sh -c ${shellQuote(script)}`;
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

export async function sshDiscoverMemoryProviders(
  config: SshConfig,
  profile?: string,
): Promise<MemoryProviderInfo[]> {
  const activeProvider =
    (await sshGetConfigValue(config, "memory.provider", profile)) || "";
  const script = `
import json, os
known = {
    "honcho": {"description": "memory.providers.honcho", "envVars": ["HONCHO_API_KEY"]},
    "hindsight": {"description": "memory.providers.hindsight", "envVars": ["HINDSIGHT_API_KEY", "HINDSIGHT_API_URL", "HINDSIGHT_BANK_ID"]},
    "mem0": {"description": "memory.providers.mem0", "envVars": ["MEM0_API_KEY"]},
    "retaindb": {"description": "memory.providers.retaindb", "envVars": ["RETAINDB_API_KEY"]},
    "supermemory": {"description": "memory.providers.supermemory", "envVars": ["SUPERMEMORY_API_KEY"]},
    "holographic": {"description": "memory.providers.holographic", "envVars": []},
    "openviking": {"description": "memory.providers.openviking", "envVars": ["OPENVIKING_ENDPOINT", "OPENVIKING_API_KEY"]},
    "byterover": {"description": "memory.providers.byterover", "envVars": ["BRV_API_KEY"]},
}
roots = [
    os.path.expanduser("~/.hermes/plugins/memory"),
    os.path.expanduser("~/hermes/plugins/memory"),
    os.path.expanduser("~/hermes-agent/plugins/memory"),
]
names = set(known)
for root in roots:
    if os.path.isdir(root):
        for name in os.listdir(root):
            if not name.startswith("_") and os.path.isdir(os.path.join(root, name)):
                names.add(name)
result = []
for name in sorted(names):
    meta = known.get(name, {"description": f"memory.providers.{name}", "envVars": []})
    result.append({
        "name": name,
        "description": meta["description"],
        "envVars": meta["envVars"],
        "installed": True,
        "active": name == ${JSON.stringify(activeProvider)},
    })
print(json.dumps(result))
`;
  try {
    const out = await sshPython(config, script);
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

// ── Models library ─────────────────────────────────────────────────────────────

export async function sshListModels(config: SshConfig): Promise<SavedModel[]> {
  try {
    const raw = await sshReadFile(config, "$HOME/.hermes/models.json");
    if (raw.trim()) return JSON.parse(raw);
  } catch {
    // no models.json on remote yet
  }
  return [];
}

export async function sshSaveModels(
  config: SshConfig,
  models: SavedModel[],
): Promise<void> {
  await sshWriteFile(
    config,
    "$HOME/.hermes/models.json",
    JSON.stringify(models, null, 2),
  );
}

// Mirror the local CRUD helpers in models.ts against the remote
// ~/.hermes/models.json. Each operation does a full read/mutate/write so the
// SSH cost is the same as a manual edit — there is no remote API to call
// instead, and the file is small (a few KB at most).

function randomId(): string {
  // RFC4122-ish v4 UUID without pulling in crypto.randomUUID, which is fine
  // here because IDs only need to be unique within models.json.
  const hex = (n: number): string =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

export async function sshAddModel(
  config: SshConfig,
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
): Promise<SavedModel> {
  const models = await sshListModels(config);
  const existing = models.find(
    (m) => m.model === model && m.provider === provider,
  );
  if (existing) return existing;
  const entry: SavedModel = {
    id: randomId(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    createdAt: Date.now(),
  };
  await sshSaveModels(config, [...models, entry]);
  return entry;
}

export async function sshRemoveModel(
  config: SshConfig,
  id: string,
): Promise<boolean> {
  const models = await sshListModels(config);
  const filtered = models.filter((m) => m.id !== id);
  if (filtered.length === models.length) return false;
  await sshSaveModels(config, filtered);
  return true;
}

export async function sshUpdateModel(
  config: SshConfig,
  id: string,
  fields: Partial<Pick<SavedModel, "name" | "provider" | "model" | "baseUrl">>,
): Promise<boolean> {
  const models = await sshListModels(config);
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  models[idx] = { ...models[idx], ...fields };
  await sshSaveModels(config, models);
  return true;
}
