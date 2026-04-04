import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import Database from 'better-sqlite3'
import { HERMES_HOME } from './installer'

const ENTRY_DELIMITER = '\n§\n'
const MEMORY_CHAR_LIMIT = 2200
const USER_CHAR_LIMIT = 1375

export interface MemoryEntry {
  index: number
  content: string
}

export interface MemoryInfo {
  memory: {
    content: string
    exists: boolean
    lastModified: number | null
    entries: MemoryEntry[]
    charCount: number
    charLimit: number
  }
  user: {
    content: string
    exists: boolean
    lastModified: number | null
    charCount: number
    charLimit: number
  }
  stats: { totalSessions: number; totalMessages: number }
}

function profileHome(profile?: string): string {
  return profile && profile !== 'default'
    ? join(HERMES_HOME, 'profiles', profile)
    : HERMES_HOME
}

function memoryPath(profile?: string): string {
  return join(profileHome(profile), 'MEMORY.md')
}

function userPath(profile?: string): string {
  return join(profileHome(profile), 'USER.md')
}

function readFileSafe(filePath: string): { content: string; exists: boolean; lastModified: number | null } {
  if (!existsSync(filePath)) {
    return { content: '', exists: false, lastModified: null }
  }
  try {
    const content = readFileSync(filePath, 'utf-8')
    const stat = statSync(filePath)
    return { content, exists: true, lastModified: Math.floor(stat.mtimeMs / 1000) }
  } catch {
    return { content: '', exists: false, lastModified: null }
  }
}

function parseMemoryEntries(content: string): MemoryEntry[] {
  if (!content.trim()) return []
  return content
    .split(ENTRY_DELIMITER)
    .map((entry, index) => ({ index, content: entry.trim() }))
    .filter((e) => e.content.length > 0)
}

function serializeEntries(entries: MemoryEntry[]): string {
  return entries.map((e) => e.content).join(ENTRY_DELIMITER)
}

function writeFileSafe(filePath: string, content: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}

function getSessionStats(profile?: string): { totalSessions: number; totalMessages: number } {
  const home = profileHome(profile)
  const dbPath = join(home, 'state.db')
  if (!existsSync(dbPath)) return { totalSessions: 0, totalMessages: 0 }

  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const sessionRow = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number } | undefined
      const messageRow = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number } | undefined
      return {
        totalSessions: sessionRow?.count ?? 0,
        totalMessages: messageRow?.count ?? 0
      }
    } finally {
      db.close()
    }
  } catch {
    return { totalSessions: 0, totalMessages: 0 }
  }
}

// ── Read ────────────────────────────────────────────

export function readMemory(profile?: string): MemoryInfo {
  const memFile = readFileSafe(memoryPath(profile))
  const userFile = readFileSafe(userPath(profile))

  return {
    memory: {
      ...memFile,
      entries: parseMemoryEntries(memFile.content),
      charCount: memFile.content.length,
      charLimit: MEMORY_CHAR_LIMIT
    },
    user: {
      ...userFile,
      charCount: userFile.content.length,
      charLimit: USER_CHAR_LIMIT
    },
    stats: getSessionStats(profile)
  }
}

// ── Write operations ────────────────────────────────

export function addMemoryEntry(content: string, profile?: string): { success: boolean; error?: string } {
  const filePath = memoryPath(profile)
  const existing = readFileSafe(filePath)
  const entries = parseMemoryEntries(existing.content)
  const newContent = serializeEntries([...entries, { index: entries.length, content: content.trim() }])

  if (newContent.length > MEMORY_CHAR_LIMIT) {
    return { success: false, error: `Would exceed memory limit (${newContent.length}/${MEMORY_CHAR_LIMIT} chars)` }
  }

  writeFileSafe(filePath, newContent)
  return { success: true }
}

export function updateMemoryEntry(index: number, content: string, profile?: string): { success: boolean; error?: string } {
  const filePath = memoryPath(profile)
  const existing = readFileSafe(filePath)
  const entries = parseMemoryEntries(existing.content)

  if (index < 0 || index >= entries.length) {
    return { success: false, error: 'Entry not found' }
  }

  entries[index] = { ...entries[index], content: content.trim() }
  const newContent = serializeEntries(entries)

  if (newContent.length > MEMORY_CHAR_LIMIT) {
    return { success: false, error: `Would exceed memory limit (${newContent.length}/${MEMORY_CHAR_LIMIT} chars)` }
  }

  writeFileSafe(filePath, newContent)
  return { success: true }
}

export function removeMemoryEntry(index: number, profile?: string): boolean {
  const filePath = memoryPath(profile)
  const existing = readFileSafe(filePath)
  const entries = parseMemoryEntries(existing.content)

  if (index < 0 || index >= entries.length) return false

  entries.splice(index, 1)
  writeFileSafe(filePath, serializeEntries(entries))
  return true
}

export function writeUserProfile(content: string, profile?: string): { success: boolean; error?: string } {
  if (content.length > USER_CHAR_LIMIT) {
    return { success: false, error: `Exceeds limit (${content.length}/${USER_CHAR_LIMIT} chars)` }
  }
  writeFileSafe(userPath(profile), content)
  return { success: true }
}
