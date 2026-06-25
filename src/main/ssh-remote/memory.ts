import type { MemoryProviderInfo } from "../installer";
import type { MemoryInfo } from "../memory";
import type { SshConfig } from "../ssh-tunnel";
import { pythonJsonInput, sshPython, sshReadFile, sshWriteFile } from "./core";
import { sshGetConfigValue } from "./config";

// ── Memory ───────────────────────────────────────────────────────────────────

const ENTRY_DELIMITER = "\n§\n";
const MEMORY_CHAR_LIMIT = 2200;
// Matches Hermes' own cap (config.yaml `memory_char_limit: 2200`); was 1375.
const USER_CHAR_LIMIT = 2200;

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

export async function sshAddMemoryEntry(
  config: SshConfig,
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const current = await sshReadFile(config, remoteMemoryPath(profile));
  const entries = parseMemoryEntries(current);
  const newContent = serializeEntries([
    ...entries,
    { index: entries.length, content: content.trim() },
  ]);
  if (newContent.length > MEMORY_CHAR_LIMIT) {
    return {
      success: false,
      error: `Would exceed memory limit (${newContent.length}/${MEMORY_CHAR_LIMIT} chars)`,
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
  const current = await sshReadFile(config, remoteMemoryPath(profile));
  const entries = parseMemoryEntries(current);
  if (index < 0 || index >= entries.length)
    return { success: false, error: "Entry not found" };
  entries[index] = { ...entries[index], content: content.trim() };
  const newContent = serializeEntries(entries);
  if (newContent.length > MEMORY_CHAR_LIMIT) {
    return {
      success: false,
      error: `Would exceed memory limit (${newContent.length}/${MEMORY_CHAR_LIMIT} chars)`,
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
  if (content.length > USER_CHAR_LIMIT) {
    return {
      success: false,
      error: `Exceeds limit (${content.length}/${USER_CHAR_LIMIT} chars)`,
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
    "recall-sqlite": {"description": "memory.providers.recall-sqlite", "envVars": []},
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
