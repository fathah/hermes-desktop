import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { profileHome, safeWriteFile } from "./utils";
import { parseMemoryLimitsConfig, type MemoryLimits } from "./memory-limits";

const ENTRY_DELIMITER = "\n§\n";

export interface MemoryEntry {
  index: number;
  content: string;
}

export interface MemoryInfo {
  memory: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    entries: MemoryEntry[];
    charCount: number;
    charLimit: number;
  };
  user: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    charCount: number;
    charLimit: number;
  };
  stats: { totalSessions: number; totalMessages: number };
}

function memoryPath(profile?: string): string {
  return join(profileHome(profile), "memories", "MEMORY.md");
}

function userPath(profile?: string): string {
  return join(profileHome(profile), "memories", "USER.md");
}

function configPath(profile?: string): string {
  return join(profileHome(profile), "config.yaml");
}

function readMemoryLimits(profile?: string): MemoryLimits {
  try {
    const filePath = configPath(profile);
    if (!existsSync(filePath)) return parseMemoryLimitsConfig("");
    return parseMemoryLimitsConfig(readFileSync(filePath, "utf-8"));
  } catch {
    return parseMemoryLimitsConfig("");
  }
}

function readFileSafe(filePath: string): {
  content: string;
  exists: boolean;
  lastModified: number | null;
} {
  if (!existsSync(filePath)) {
    return { content: "", exists: false, lastModified: null };
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    const stat = statSync(filePath);
    return {
      content,
      exists: true,
      lastModified: Math.floor(stat.mtimeMs / 1000),
    };
  } catch {
    return { content: "", exists: false, lastModified: null };
  }
}

function parseMemoryEntries(content: string): MemoryEntry[] {
  if (!content.trim()) return [];
  return content
    .split(ENTRY_DELIMITER)
    .map((entry, index) => ({ index, content: entry.trim() }))
    .filter((e) => e.content.length > 0);
}

function serializeEntries(entries: MemoryEntry[]): string {
  return entries.map((e) => e.content).join(ENTRY_DELIMITER);
}

// Use shared safeWriteFile from utils
const writeFileSafe = safeWriteFile;

function getSessionStats(profile?: string): {
  totalSessions: number;
  totalMessages: number;
} {
  const home = profileHome(profile);
  const dbPath = join(home, "state.db");
  if (!existsSync(dbPath)) return { totalSessions: 0, totalMessages: 0 };

  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const sessionRow = db
        .prepare("SELECT COUNT(*) as count FROM sessions")
        .get() as { count: number } | undefined;
      const messageRow = db
        .prepare("SELECT COUNT(*) as count FROM messages")
        .get() as { count: number } | undefined;
      return {
        totalSessions: sessionRow?.count ?? 0,
        totalMessages: messageRow?.count ?? 0,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    console.error("[memory] getSessionStats failed:", err);
    return { totalSessions: 0, totalMessages: 0 };
  }
}

// ── Read ────────────────────────────────────────────

export function readMemory(profile?: string): MemoryInfo {
  const memFile = readFileSafe(memoryPath(profile));
  const userFile = readFileSafe(userPath(profile));
  const limits = readMemoryLimits(profile);

  return {
    memory: {
      ...memFile,
      entries: parseMemoryEntries(memFile.content),
      charCount: memFile.content.length,
      charLimit: limits.memoryCharLimit,
    },
    user: {
      ...userFile,
      charCount: userFile.content.length,
      charLimit: limits.userCharLimit,
    },
    stats: getSessionStats(profile),
  };
}

/** Raw MEMORY.md content (empty string when missing) — for whole-file sync. */
export function readMemoryRaw(profile?: string): string {
  return readFileSafe(memoryPath(profile)).content;
}

/**
 * Replace MEMORY.md wholesale. Used by cloud agent sync when the remote copy
 * wins — the content is the user's own cloud copy, so no entry parsing or
 * char-limit gate applies (safeWriteFile creates `memories/` when missing).
 */
export function writeMemoryRaw(
  content: string,
  profile?: string,
): { success: boolean; error?: string } {
  try {
    safeWriteFile(memoryPath(profile), content);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ── Write operations ────────────────────────────────

export function addMemoryEntry(
  content: string,
  profile?: string,
): { success: boolean; error?: string } {
  const filePath = memoryPath(profile);
  const existing = readFileSafe(filePath);
  const entries = parseMemoryEntries(existing.content);
  const newContent = serializeEntries([
    ...entries,
    { index: entries.length, content: content.trim() },
  ]);
  const limits = readMemoryLimits(profile);

  if (newContent.length > limits.memoryCharLimit) {
    return {
      success: false,
      error: `Would exceed memory limit (${newContent.length}/${limits.memoryCharLimit} chars)`,
    };
  }

  writeFileSafe(filePath, newContent);
  return { success: true };
}

export function updateMemoryEntry(
  index: number,
  content: string,
  profile?: string,
): { success: boolean; error?: string } {
  const filePath = memoryPath(profile);
  const existing = readFileSafe(filePath);
  const entries = parseMemoryEntries(existing.content);

  if (index < 0 || index >= entries.length) {
    return { success: false, error: "Entry not found" };
  }

  entries[index] = { ...entries[index], content: content.trim() };
  const newContent = serializeEntries(entries);
  const limits = readMemoryLimits(profile);

  if (newContent.length > limits.memoryCharLimit) {
    return {
      success: false,
      error: `Would exceed memory limit (${newContent.length}/${limits.memoryCharLimit} chars)`,
    };
  }

  writeFileSafe(filePath, newContent);
  return { success: true };
}

export function removeMemoryEntry(index: number, profile?: string): boolean {
  const filePath = memoryPath(profile);
  const existing = readFileSafe(filePath);
  const entries = parseMemoryEntries(existing.content);

  if (index < 0 || index >= entries.length) return false;

  entries.splice(index, 1);
  writeFileSafe(filePath, serializeEntries(entries));
  return true;
}

export function writeUserProfile(
  content: string,
  profile?: string,
): { success: boolean; error?: string } {
  const limits = readMemoryLimits(profile);
  if (content.length > limits.userCharLimit) {
    return {
      success: false,
      error: `Exceeds limit (${content.length}/${limits.userCharLimit} chars)`,
    };
  }
  writeFileSafe(userPath(profile), content);
  return { success: true };
}
