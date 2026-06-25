/**
 * SSH-proxied implementations of all hermes operations.
 * Used when connection mode is "ssh" — every feature that normally reads/writes
 * local files is instead executed on the remote host via SSH.
 */

import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
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
      `hermes skills install ${shellQuote(identifier)} --yes 2>&1`,
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
      `hermes skills uninstall ${shellQuote(name)} --yes 2>&1`,
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
      `hermes skills browse --query ${shellQuote(query)} --json 2>/dev/null || echo "[]"`,
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

export async function sshSetEnvValue(
  config: SshConfig,
  key: string,
  value: string,
  profile?: string,
): Promise<void> {
  const envPath = remoteEnvPath(profile);
  const content = await sshReadFile(config, envPath);

  if (!content.trim()) {
    await sshWriteFile(config, envPath, `${key}=${value}\n`);
    return;
  }

  const lines = content.split("\n");
  let found = false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().match(new RegExp(`^#?\\s*${escaped}\\s*=`))) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) lines.push(`${key}=${value}`);
  await sshWriteFile(config, envPath, lines.join("\n"));
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
        pid = int(open(pid_file).read().strip())
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
  try {
    const out = await sshPython(config, script);
    return JSON.parse(out.trim() || "[]");
  } catch {
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
  clone: boolean,
): Promise<boolean> {
  try {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe) return false;
    const quoted = shellQuote(safe);
    if (clone) {
      await sshExec(
        config,
        `hermes profiles create ${quoted} --clone-from default 2>&1 || mkdir -p ~/.hermes/profiles/${quoted}`,
      );
    } else {
      await sshExec(
        config,
        `hermes profiles create ${quoted} 2>&1 || mkdir -p ~/.hermes/profiles/${quoted}`,
      );
    }
    return true;
  } catch {
    return false;
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
    await sshExec(
      config,
      `hermes profiles delete ${quoted} --yes 2>&1 || rm -rf ~/.hermes/profiles/${quoted}`,
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
  if (profile && profile !== "default") {
    return (
      `mkdir -p $HOME/.hermes/profiles/${profile}; ` +
      `(nohup ${buildRemoteHermesCmd(
        ["--profile", profile, "gateway", "start"],
        ` > ${remoteGatewayLogPath(profile)} 2>&1`,
      )} &);`
    );
  }
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `sudo -n systemctl start hermes.service 2>/dev/null || ` +
    `systemctl start hermes.service 2>/dev/null || true; ` +
    `else ` +
    `(nohup hermes gateway start > $HOME/.hermes/gateway.log 2>&1 &); ` +
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
    `hermes gateway stop 2>/dev/null || ` +
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

export async function sshStartGateway(
  config: SshConfig,
  profile?: string,
): Promise<void> {
  try {
    await sshExec(config, buildGatewayStartCommand(profile));
  } catch {
    // best effort
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
// place a wrapper. `command -v hermes` alone is not enough: the desktop's
// non-interactive SSH does not source `~/.profile`/`~/.bashrc`, so any
// PATH additions made there are not visible.
//
// Exported for unit testing the probe list without a live remote host.
export function buildRemoteHermesCmd(args: string[], extraShell = ""): string {
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
  const probe = candidates
    .map((p) => `[ -x ${p} ] && exec ${p} ${quotedArgs}${extraShell}`)
    .join("; ");
  const script = `${probe}; command -v hermes >/dev/null && exec hermes ${quotedArgs}${extraShell}; echo "ERR: hermes CLI not found on remote PATH or in any known venv location" >&2; exit 1`;
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
