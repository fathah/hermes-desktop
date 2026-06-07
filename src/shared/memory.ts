// Shared memory IPC types — single source of truth for the MEMORY.md / USER.md
// read result. Producer: src/main/memory.ts (readMemory). Contract:
// src/preload/index.d.ts. Consumers: the Personalization + You renderer surfaces.
//
// Previously the preload contract declared a NARROWER shape (content/exists/
// lastModified only), so the renderer cast `as unknown as { ... MemoryFile }` to
// recover charLimit — an unsafe cast that hid this very mismatch. Defining the
// real shape once removes the cast.

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
