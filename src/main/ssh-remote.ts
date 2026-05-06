/**
 * SSH-proxied implementations of all hermes operations.
 * Used when connection mode is "ssh" — every feature that normally reads/writes
 * local files is instead executed on the remote host via SSH.
 *
 * FIXES (PR #68 review):
 * 1. All spawnSync → async spawn+Promise. ControlMaster multiplexing added.
 * 2. Shell injection: user values passed via base64-encoded argv, never interpolated.
 * 3. Python injection: params passed as JSON on stdin, parameterized SQL.
 */

import { spawn, ChildProcess } from "child_process";
import { homedir } from "os";
import { join } from "path";
import type { SshConfig } from "./ssh-tunnel";
import type { InstalledSkill, SkillSearchResult } from "./skills";
import type { MemoryInfo } from "./memory";
import type { SessionSummary, SessionMessage, SearchResult } from "./sessions";
import type { ToolsetInfo } from "./tools";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";

// ── SSH exec core ────────────────────────────────────────────────────────────

function controlSocket(config: SshConfig): string {
  // Unique socket per host:port combination, using a short hash to keep path short.
  const hash = Buffer.from(`${config.username}@${config.host}:${config.port || 22}`).toString("base64url").slice(0, 12);
  return `/tmp/hermes_ssh_${hash}.sock`;
}

function buildExecArgs(config: SshConfig): string[] {
  const keyPath = config.keyPath?.trim() || join(homedir(), ".ssh", "id_rsa");
  const socket = controlSocket(config);
  return [
    "-o", `ControlPath=${socket}`,
    "-o", "ControlMaster=auto",
    "-o", "ControlPersist=300",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-i", keyPath,
    "-p", String(config.port || 22),
    `${config.username}@${config.host}`,
  ];
}

/**
 * Close the ControlMaster connection for a given config.
 * Call this when the SSH connection is no longer needed (e.g., user disconnects).
 */
export async function closeSshMaster(config: SshConfig): Promise<void> {
  const socket = controlSocket(config);
  try {
    const result = await new Promise<string>((resolve) => {
      const p = spawn("ssh", ["-o", `ControlPath=${socket}`, "-O", "exit", `${config.username}@${config.host}`], {
        timeout: 5000,
      });
      let out = "";
      p.stdout?.on("data", (d) => (out += d));
      p.stderr?.on("data", (d) => (out += d));
      p.on("close", () => resolve(out));
    });
    // Ignore errors — socket may not exist
    void result;
  } catch {
    // Ignore — master may not be running
  }
}

async function collectOutput(proc: ChildProcess): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
    proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf-8")));
    proc.on("close", (status) => resolve({ stdout, stderr, status }));
    proc.on("error", () => resolve({ stdout, stderr, status: -1 }));
  });
}

export async function sshExec(config: SshConfig, command: string, stdin?: string): Promise<string> {
  const proc = spawn("ssh", [...buildExecArgs(config), command], {
    timeout: 30000,
  });
  if (stdin) {
    proc.stdin?.write(stdin);
    proc.stdin?.end();
  }
  const { stdout, stderr, status } = await collectOutput(proc);
  if (status !== 0) {
    throw new Error(stderr?.trim() || "SSH command failed");
  }
  return stdout || "";
}

async function sshPython(config: SshConfig, script: string, paramsJson?: string): Promise<string> {
  // FIX: When paramsJson is provided, embed it as base64 in the script itself.
  // The Python script reads _PARAMS_B64, decodes it, and uses json.loads().
  // This avoids both shell injection (base64 is alphanumeric) and Python injection
  // (params are data, not code).
  let finalScript = script;
  if (paramsJson) {
    const b64 = Buffer.from(paramsJson).toString("base64");
    // Prepend a safe base64 constant + decoder. No shell/Python injection possible.
    finalScript = `import base64,json;_P=json.loads(base64.b64decode("${b64}"))\n${script}`;
  }
  const proc = spawn("ssh", [...buildExecArgs(config), "python3 -"], {
    timeout: 30000,
  });
  proc.stdin?.write(finalScript);
  proc.stdin?.end();
  const { stdout, stderr, status } = await collectOutput(proc);
  if (status !== 0) {
    throw new Error(stderr?.trim() || "SSH python failed");
  }
  return stdout || "";
}

/**
 * Safely encode a value for use in shell commands via base64.
 * The encoded value is alphanumeric (+ / =), safe from shell interpretation.
 * On the remote side, decode with: $(echo 'BASE64' | base64 -d)
 */
function shellSafe(value: string): string {
  return Buffer.from(value).toString("base64");
}

function sshReadFile(config: SshConfig, remotePath: string): Promise<string> {
  // FIX: Pass path via base64 to prevent shell injection (backticks, $(), etc.)
  const p = remotePath.replace(/^~\//, "$HOME/");
  const encoded = shellSafe(p);
  // Remote shell: decode base64 into a variable, then use it.
  // The base64 string itself cannot contain shell metacharacters.
  return sshExec(config, `cat "$(echo '${encoded}' | base64 -d)" 2>/dev/null || true`).catch(() => "");
}

async function sshWriteFile(config: SshConfig, remotePath: string, content: string): Promise<void> {
  // FIX: Pass dir and path via base64 to prevent shell injection.
  const p = remotePath.replace(/^~\//, "$HOME/");
  const dir = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : ".";
  const dirEncoded = shellSafe(dir);
  const pathEncoded = shellSafe(p);
  const cmd = `mkdir -p "$(echo '${dirEncoded}' | base64 -d)" && cat > "$(echo '${pathEncoded}' | base64 -d)"`;
  await sshExec(config, cmd, content);
}

// ── Skills ───────────────────────────────────────────────────────────────────

const REMOTE_PREFIX = "REMOTE:";

export async function sshListInstalledSkills(config: SshConfig): Promise<InstalledSkill[]> {
  const script = `
import os, json
skills_dir = os.path.expanduser("~/.hermes/skills")
skills = []
if os.path.isdir(skills_dir):
    for category in sorted(os.listdir(skills_dir)):
        cat_path = os.path.join(skills_dir, category)
        if not os.path.isdir(cat_path):
            continue
        for name in sorted(os.listdir(cat_path)):
            skill_path = os.path.join(cat_path, name)
            if not os.path.isdir(skill_path):
                continue
            skill_file = os.path.join(skill_path, "SKILL.md")
            display_name = name
            description = ""
            if os.path.exists(skill_file):
                try:
                    content = open(skill_file).read(4000)
                    if content.startswith("---"):
                        end = content.find("---", 3)
                        if end != -1:
                            for line in content[3:end].splitlines():
                                if line.strip().startswith("name:"):
                                    display_name = line.split(":",1)[1].strip().strip("'\\\\\"")
                                elif line.strip().startswith("description:"):
                                    description = line.split(":",1)[1].strip().strip("'\\\\\"")
                    else:
                        for line in content.splitlines():
                            if line.startswith("#"):
                                display_name = line.lstrip("#").strip()
                                break
                except:
                    pass
            skills.append({"name": display_name, "category": category, "description": description, "path": skill_path})
print(json.dumps(skills))
`;
  try {
    const out = await sshPython(config, script);
    const parsed = JSON.parse(out.trim() || "[]") as Array<{
      name: string; category: string; description: string; path: string;
    }>;
    return parsed.map((s) => ({ ...s, path: REMOTE_PREFIX + s.path }));
  } catch {
    return [];
  }
}

export async function sshGetSkillContent(config: SshConfig, skillPath: string): Promise<string> {
  const remote = skillPath.startsWith(REMOTE_PREFIX)
    ? skillPath.slice(REMOTE_PREFIX.length)
    : skillPath;
  return await sshReadFile(config, `${remote}/SKILL.md`);
}

export async function sshInstallSkill(config: SshConfig, identifier: string): Promise<{ success: boolean; error?: string }> {
  try {
    // FIX: Pass identifier via base64 to prevent shell injection.
    const encoded = shellSafe(identifier);
    await sshExec(config, `hermes skills install "$(echo '${encoded}' | base64 -d)" --yes 2>&1`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sshUninstallSkill(config: SshConfig, name: string): Promise<{ success: boolean; error?: string }> {
  try {
    // FIX: Pass name via base64 to prevent shell injection.
    const encoded = shellSafe(name);
    await sshExec(config, `hermes skills uninstall "$(echo '${encoded}' | base64 -d)" --yes 2>&1`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sshSearchSkills(config: SshConfig, query: string): Promise<SkillSearchResult[]> {
  try {
    // FIX: Pass query via base64 to prevent shell injection.
    const encoded = shellSafe(query);
    const out = await sshExec(
      config,
      `hermes skills browse --query "$(echo '${encoded}' | base64 -d)" --json 2>/dev/null || echo "[]"`,
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

export async function sshListBundledSkills(config: SshConfig): Promise<SkillSearchResult[]> {
  return await sshSearchSkills(config, "");
}

// ── Memory ───────────────────────────────────────────────────────────────────

const ENTRY_DELIMITER = "\n§\n";
const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;

function parseMemoryEntries(content: string): Array<{ index: number; content: string }> {
  if (!content.trim()) return [];
  return content
    .split(ENTRY_DELIMITER)
    .map((entry, index) => ({ index, content: entry.trim() }))
    .filter((e) => e.content.length > 0);
}

function serializeEntries(entries: Array<{ index: number; content: string }>): string {
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

async function sshGetSessionStats(config: SshConfig, profile?: string): Promise<{ totalSessions: number; totalMessages: number }> {
  // FIX: Pass dbPath as JSON on stdin instead of interpolating into Python source.
  const dbPath = profile && profile !== "default"
    ? `~/.hermes/profiles/${profile}/state.db`
    : "~/.hermes/state.db";
  const params = JSON.stringify({ dbPath });

  const script = `
import sqlite3, json, os, sys
db = os.path.expanduser(_P["dbPath"])
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
    const out = await sshPython(config, script, params);
    return JSON.parse(out.trim());
  } catch {
    return { totalSessions: 0, totalMessages: 0 };
  }
}

export async function sshReadMemory(config: SshConfig, profile?: string): Promise<MemoryInfo> {
  const memContent = await sshReadFile(config, remoteMemoryPath(profile));
  const userContent = await sshReadFile(config, remoteUserPath(profile));
  const stats = await sshGetSessionStats(config, profile);

  return {
    memory: {
      content: memContent,
      exists: memContent.length > 0,
      lastModified: null,
      entries: parseMemoryEntries(memContent),
      charCount: memContent.length,
      charLimit: MEMORY_CHAR_LIMIT,
    },
    user: {
      content: userContent,
      exists: userContent.length > 0,
      lastModified: null,
      charCount: userContent.length,
      charLimit: USER_CHAR_LIMIT,
    },
    stats,
  };
}

export async function sshAddMemoryEntry(config: SshConfig, content: string, profile?: string): Promise<{ success: boolean; error?: string }> {
  const current = await sshReadFile(config, remoteMemoryPath(profile));
  const entries = parseMemoryEntries(current);
  const newContent = serializeEntries([...entries, { index: entries.length, content: content.trim() }]);
  if (newContent.length > MEMORY_CHAR_LIMIT) {
    return { success: false, error: `Would exceed memory limit (${newContent.length}/${MEMORY_CHAR_LIMIT} chars)` };
  }
  await sshWriteFile(config, remoteMemoryPath(profile), newContent);
  return { success: true };
}

export async function sshUpdateMemoryEntry(config: SshConfig, index: number, content: string, profile?: string): Promise<{ success: boolean; error?: string }> {
  const current = await sshReadFile(config, remoteMemoryPath(profile));
  const entries = parseMemoryEntries(current);
  if (index < 0 || index >= entries.length) return { success: false, error: "Entry not found" };
  entries[index] = { ...entries[index], content: content.trim() };
  const newContent = serializeEntries(entries);
  if (newContent.length > MEMORY_CHAR_LIMIT) {
    return { success: false, error: `Would exceed memory limit (${newContent.length}/${MEMORY_CHAR_LIMIT} chars)` };
  }
  await sshWriteFile(config, remoteMemoryPath(profile), newContent);
  return { success: true };
}

export async function sshRemoveMemoryEntry(config: SshConfig, index: number, profile?: string): Promise<boolean> {
  const current = await sshReadFile(config, remoteMemoryPath(profile));
  const entries = parseMemoryEntries(current);
  if (index < 0 || index >= entries.length) return false;
  entries.splice(index, 1);
  await sshWriteFile(config, remoteMemoryPath(profile), serializeEntries(entries));
  return true;
}

export async function sshWriteUserProfile(config: SshConfig, content: string, profile?: string): Promise<{ success: boolean; error?: string }> {
  if (content.length > USER_CHAR_LIMIT) {
    return { success: false, error: `Exceeds limit (${content.length}/${USER_CHAR_LIMIT} chars)` };
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
  if (profile && profile !== "default") return `~/.hermes/profiles/${profile}/SOUL.md`;
  return "~/.hermes/SOUL.md";
}

export async function sshReadSoul(config: SshConfig, profile?: string): Promise<string> {
  return await sshReadFile(config, remoteSoulPath(profile));
}

export async function sshWriteSoul(config: SshConfig, content: string, profile?: string): Promise<boolean> {
  try {
    await sshWriteFile(config, remoteSoulPath(profile), content);
    return true;
  } catch {
    return false;
  }
}

export async function sshResetSoul(config: SshConfig, profile?: string): Promise<string> {
  await sshWriteSoul(config, DEFAULT_SOUL, profile);
  return DEFAULT_SOUL;
}

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLSET_DEFS = [
  { key: "web", labelKey: "tools.web.label", descriptionKey: "tools.web.description" },
  { key: "browser", labelKey: "tools.browser.label", descriptionKey: "tools.browser.description" },
  { key: "terminal", labelKey: "tools.terminal.label", descriptionKey: "tools.terminal.description" },
  { key: "file", labelKey: "tools.file.label", descriptionKey: "tools.file.description" },
  { key: "code_execution", labelKey: "tools.code_execution.label", descriptionKey: "tools.code_execution.description" },
  { key: "vision", labelKey: "tools.vision.label", descriptionKey: "tools.vision.description" },
  { key: "image_gen", labelKey: "tools.image_gen.label", descriptionKey: "tools.image_gen.description" },
  { key: "tts", labelKey: "tools.tts.label", descriptionKey: "tools.tts.description" },
  { key: "skills", labelKey: "tools.skills.label", descriptionKey: "tools.skills.description" },
  { key: "memory", labelKey: "tools.memory.label", descriptionKey: "tools.memory.description" },
  { key: "session_search", labelKey: "tools.session_search.label", descriptionKey: "tools.session_search.description" },
  { key: "clarify", labelKey: "tools.clarify.label", descriptionKey: "tools.clarify.description" },
  { key: "delegation", labelKey: "tools.delegation.label", descriptionKey: "tools.delegation.description" },
];

function parseEnabledToolsets(content: string): Set<string> {
  const enabled = new Set<string>();
  let inPlatformToolsets = false;
  let inCli = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trimEnd();
    if (/^\s*platform_toolsets\s*:/.test(trimmed)) { inPlatformToolsets = true; inCli = false; continue; }
    if (inPlatformToolsets && /^\s+cli\s*:/.test(trimmed)) { inCli = true; continue; }
    if (inPlatformToolsets && /^\S/.test(trimmed) && !/^\s*$/.test(trimmed)) { inPlatformToolsets = false; inCli = false; continue; }
    if (inCli && /^\s{4}\S/.test(trimmed) && !/^\s{4,}-/.test(trimmed)) { inCli = false; continue; }
    if (inCli) { const m = trimmed.match(/^\s+-\s+["']?(\w+)["']?/); if (m) enabled.add(m[1]); }
  }
  return enabled;
}

function localizeToolDefs(enabled: boolean | ((key: string) => boolean)): ToolsetInfo[] {
  const locale = getAppLocale();
  return TOOLSET_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey, locale),
    description: t(d.descriptionKey, locale),
    enabled: typeof enabled === "function" ? enabled(d.key) : enabled,
  }));
}

function remoteConfigPath(profile?: string): string {
  if (profile && profile !== "default") return `$HOME/.hermes/profiles/${profile}/config.yaml`;
  return `$HOME/.hermes/config.yaml`;
}

export async function sshGetToolsets(config: SshConfig, profile?: string): Promise<ToolsetInfo[]> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return localizeToolDefs(true);
  const enabled = parseEnabledToolsets(content);
  if (enabled.size === 0 && !content.includes("platform_toolsets")) return localizeToolDefs(true);
  return localizeToolDefs((key) => enabled.has(key));
}

export async function sshSetToolsetEnabled(config: SshConfig, key: string, enabled: boolean, profile?: string): Promise<boolean> {
  try {
    const configPath = remoteConfigPath(profile);
    const content = await sshReadFile(config, configPath);
    if (!content) return false;

    const current = parseEnabledToolsets(content);
    if (enabled) current.add(key); else current.delete(key);

    const toolsetLines = Array.from(current).sort().map((t) => `      - ${t}`).join("\n");
    const newSection = `  cli:\n${toolsetLines}`;

    let newContent: string;
    if (content.includes("platform_toolsets")) {
      const lines = content.split("\n");
      const result: string[] = [];
      let inPT = false, inCli = false, inserted = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimEnd();
        if (/^\s*platform_toolsets\s*:/.test(trimmed)) { inPT = true; result.push(line); continue; }
        if (inPT && /^\s+cli\s*:/.test(trimmed)) { inCli = true; result.push(newSection); inserted = true; continue; }
        if (inCli) { if (/^\s+-\s/.test(trimmed)) continue; inCli = false; result.push(line); continue; }
        if (inPT && /^\S/.test(trimmed) && trimmed !== "") { inPT = false; if (!inserted) { result.push(newSection); } }
        result.push(line);
      }
      newContent = result.join("\n");
    } else {
      newContent = content.trimEnd() + "\n\nplatform_toolsets:\n" + newSection + "\n";
    }

    await sshWriteFile(config, configPath, newContent);
    return true;
  } catch {
    return false;
  }
}

// ── Env / Config (Providers) ─────────────────────────────────────────────────

function remoteEnvPath(profile?: string): string {
  if (profile && profile !== "default") return `~/.hermes/profiles/${profile}/.env`;
  return "~/.hermes/.env";
}

export async function sshReadEnv(config: SshConfig, profile?: string): Promise<Record<string, string>> {
  const content = await sshReadFile(config, remoteEnvPath(profile));
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const k = trimmed.substring(0, eqIdx).trim();
    let v = trimmed.substring(eqIdx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) result[k] = v;
  }
  // Alias alternate env var names so the app can display them regardless of which name the server uses
  const ENV_ALIASES: Array<[string, string]> = [
    ["HA_URL", "HOMEASSISTANT_URL"],
    ["HA_TOKEN", "HOMEASSISTANT_TOKEN"],
  ];
  for (const [appKey, serverKey] of ENV_ALIASES) {
    if (!result[appKey] && result[serverKey]) result[appKey] = result[serverKey];
    if (!result[serverKey] && result[appKey]) result[serverKey] = result[appKey];
  }
  return result;
}

export async function sshSetEnvValue(config: SshConfig, key: string, value: string, profile?: string): Promise<void> {
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

export async function sshGetConfigValue(config: SshConfig, key: string, profile?: string): Promise<string | null> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return null;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^\\s*${escapedKey}:\\s*["']?([^"'\\n#]+)["']?`, "m"));
  return match ? match[1].trim() : null;
}

export async function sshSetConfigValue(config: SshConfig, key: string, value: string, profile?: string): Promise<void> {
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^(\\s*#?\\s*${escapedKey}:\\s*)["']?[^"'\\n#]*["']?`, "m");
  const updated = regex.test(content) ? content.replace(regex, `$1"${value}"`) : content;
  await sshWriteFile(config, configPath, updated);
}

// ── Sessions ─────────────────────────────────────────────────────────────────

function remoteDbPath(profile?: string): string {
  if (profile && profile !== "default") return `~/.hermes/profiles/${profile}/state.db`;
  return "~/.hermes/state.db";
}

export async function sshListSessions(config: SshConfig, limit = 30, offset = 0, profile?: string): Promise<SessionSummary[]> {
  // FIX: Pass dbPath, limit, offset as JSON on stdin instead of interpolating.
  const dbPath = remoteDbPath(profile);
  const params = JSON.stringify({ dbPath, limit, offset });

  const script = `
import sqlite3, json, os, sys
db = os.path.expanduser(_P["dbPath"])
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT id, source, started_at, ended_at, message_count, model, title "
    "FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?",
    (_P["limit"], _P["offset"])
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
    const out = await sshPython(config, script, params);
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

export async function sshGetSessionMessages(config: SshConfig, sessionId: string, profile?: string): Promise<SessionMessage[]> {
  // FIX: Pass dbPath and sessionId as JSON on stdin; use parameterized SQL.
  const dbPath = remoteDbPath(profile);
  const params = JSON.stringify({ dbPath, sessionId });

  const script = `
import sqlite3, json, os, sys
db = os.path.expanduser(_P["dbPath"])
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT id, role, content, timestamp FROM messages WHERE session_id=? ORDER BY id ASC",
    (_P["sessionId"],)
).fetchall()
print(json.dumps([{"id": r["id"], "role": r["role"], "content": r["content"], "timestamp": r["timestamp"]} for r in rows]))
conn.close()
`;
  try {
    const out = await sshPython(config, script, params);
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

export async function sshSearchSessions(config: SshConfig, query: string, limit = 20, profile?: string): Promise<SearchResult[]> {
  // FIX: Pass all params as JSON on stdin; use parameterized SQL with LIKE.
  const dbPath = remoteDbPath(profile);
  const params = JSON.stringify({ dbPath, query, limit });

  const script = `
import sqlite3, json, os, sys
db = os.path.expanduser(_P["dbPath"])
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
try:
    like_param = "%" + _P["query"] + "%"
    rows = conn.execute(
        "SELECT DISTINCT s.id, s.title, s.started_at, s.source, s.message_count, s.model, m.content as snippet "
        "FROM sessions s JOIN messages m ON m.session_id = s.id "
        "WHERE m.content LIKE ? ORDER BY s.started_at DESC LIMIT ?",
        (like_param, _P["limit"])
    ).fetchall()
    print(json.dumps([{"sessionId": r["id"], "title": r["title"], "startedAt": r["started_at"], "source": r["source"] or "cli", "messageCount": r["message_count"] or 0, "model": r["model"] or "", "snippet": (r["snippet"] or "")[:200]} for r in rows]))
except Exception as e:
    print("[]")
conn.close()
`;
  try {
    const out = await sshPython(config, script, params);
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

export async function sshListProfiles(config: SshConfig): Promise<SshProfileInfo[]> {
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
    return [{ name: "default", path: "~/.hermes", isDefault: true, isActive: true, model: "", provider: "auto", hasEnv: false, hasSoul: false, skillCount: 0, gatewayRunning: false }];
  }
}

export async function sshCreateProfile(config: SshConfig, name: string, clone: boolean): Promise<boolean> {
  try {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
    if (clone) {
      await sshExec(config, `hermes profiles create "${safe}" --clone-from default 2>&1 || mkdir -p ~/.hermes/profiles/"${safe}"`);
    } else {
      await sshExec(config, `hermes profiles create "${safe}" 2>&1 || mkdir -p ~/.hermes/profiles/"${safe}"`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function sshDeleteProfile(config: SshConfig, name: string): Promise<boolean> {
  try {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
    await sshExec(config, `hermes profiles delete "${safe}" --yes 2>&1 || rm -rf ~/.hermes/profiles/"${safe}"`);
    return true;
  } catch {
    return false;
  }
}

// ── Gateway ───────────────────────────────────────────────────────────────────

export async function sshGatewayStatus(config: SshConfig): Promise<boolean> {
  try {
    const out = await sshExec(
      config,
      `if [ -f $HOME/.hermes/gateway.pid ]; then ` +
      `pid=$(python3 -c "import json,sys; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d.get('pid',d) if isinstance(d,dict) else d)" 2>/dev/null || cat $HOME/.hermes/gateway.pid); ` +
      `kill -0 $pid 2>/dev/null && echo "running" || echo "stopped"; ` +
      `else echo "stopped"; fi`,
    );
    return out.trim() === "running";
  } catch {
    return false;
  }
}

export async function sshStartGateway(config: SshConfig): Promise<void> {
  try {
    await sshExec(config, `nohup hermes gateway start > $HOME/.hermes/gateway.log 2>&1 &`);
  } catch {
    // best effort
  }
}

export async function sshStopGateway(config: SshConfig): Promise<void> {
  try {
    await sshExec(
      config,
      `hermes gateway stop 2>/dev/null || ` +
      `(if [ -f $HOME/.hermes/gateway.pid ]; then ` +
      `pid=$(python3 -c "import json; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d['pid'] if isinstance(d,dict) else d)" 2>/dev/null); ` +
      `[ -n "$pid" ] && kill $pid 2>/dev/null; fi); true`,
    );
  } catch {
    // best effort
  }
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

export async function sshGetHermesVersion(config: SshConfig): Promise<string | null> {
  try {
    const out = await sshExec(config, `hermes --version 2>/dev/null || hermes version 2>/dev/null || echo ""`);
    return out.trim() || null;
  } catch {
    return null;
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
    // FIX: 'lines' is a number (safe), 'file' comes from allowlist (safe).
    // No user-controlled string interpolation in this command.
    const content = await sshExec(config, `tail -n ${lines} "${remotePath}" 2>/dev/null || echo ""`);
    return { content: content.trim(), path: `~/.hermes/logs/${file}` };
  } catch {
    return { content: "", path: `~/.hermes/logs/${file}` };
  }
}

// ── Platform toggles (Gateway page) ──────────────────────────────────────────

const SSH_SUPPORTED_PLATFORMS = [
  "telegram", "discord", "slack", "whatsapp", "signal",
  "matrix", "mattermost", "email", "sms", "bluebubbles",
  "dingtalk", "feishu", "wecom", "weixin", "webhooks", "home_assistant",
];

// Map from app platform keys to gateway_state.json keys (where they differ)
const PLATFORM_STATE_KEY: Record<string, string> = {
  home_assistant: "homeassistant",
};

export async function sshGetPlatformEnabled(
  config: SshConfig,
  _profile?: string,
): Promise<Record<string, boolean>> {
  try {
    const raw = await sshReadFile(config, "$HOME/.hermes/gateway_state.json");
    if (raw.trim()) {
      const state = JSON.parse(raw);
      const platforms = state.platforms || {};
      const result: Record<string, boolean> = {};
      for (const platform of SSH_SUPPORTED_PLATFORMS) {
        const stateKey = PLATFORM_STATE_KEY[platform] || platform;
        const p = platforms[stateKey];
        result[platform] = p ? p.state === "connected" || p.state === "running" : false;
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
        if (lines[i].trim() === "" || /^\s/.test(lines[i])) insertOffset += lines[i].length + 1;
        else break;
      }
      const entry = `  ${platform}:\n    enabled: ${enabled}\n`;
      updated = updated.substring(0, insertOffset) + entry + updated.substring(insertOffset);
    }
  }

  await sshWriteFile(config, configPath, updated);
}

// ── Cached sessions (Sessions screen uses listCachedSessions) ─────────────────

import type { CachedSession } from "./session-cache";

export async function sshListCachedSessions(
  config: SshConfig,
  limit = 50,
  _offset = 0,
): Promise<CachedSession[]> {
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

export async function sshRunDoctor(config: SshConfig): Promise<string> {
  try {
    const out = await sshExec(config, `hermes doctor 2>&1 || echo "hermes not found in PATH"`);
    return out.trim() || "No output from doctor.";
  } catch (err) {
    return `SSH doctor failed: ${(err as Error).message}`;
  }
}

// ── Models library ─────────────────────────────────────────────────────────────

import type { SavedModel } from "./models";

export async function sshListModels(config: SshConfig): Promise<SavedModel[]> {
  try {
    const raw = await sshReadFile(config, "$HOME/.hermes/models.json");
    if (raw.trim()) return JSON.parse(raw);
  } catch {
    // no models.json on remote yet
  }
  return [];
}

export async function sshSaveModels(config: SshConfig, models: SavedModel[]): Promise<void> {
  await sshWriteFile(config, "$HOME/.hermes/models.json", JSON.stringify(models, null, 2));
}
