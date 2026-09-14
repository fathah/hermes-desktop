// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";

const { testHome } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  return { testHome: fs.mkdtempSync(path.join(os.tmpdir(), "hermes-rename-")) };
});
vi.mock("../src/main/locale", () => ({ getAppLocale: () => "en" }));
vi.mock("../src/shared/i18n", () => ({ t: (key: string) => key }));
vi.mock("../src/main/utils", () => ({
  profileHome: (profile?: unknown) =>
    join(testHome, String(profile || "default")),
  activeStateDbPath: (profile?: unknown) =>
    join(testHome, String(profile || "default"), "state.db"),
  getActiveProfileNameSync: () => "default",
  safeWriteFile: vi.fn((path: string, data: string) =>
    writeFileSync(path, data),
  ),
}));
vi.mock("../src/main/session-context-folder-store", () => ({
  getSessionContextFolders: () => new Map(),
}));
vi.mock("better-sqlite3", () => ({
  default: class {
    private db: DatabaseSync;
    constructor(path: string, options?: { readonly?: boolean }) {
      this.db = new DatabaseSync(path, { readOnly: options?.readonly });
    }
    prepare(sql: string): ReturnType<DatabaseSync["prepare"]> {
      return this.db.prepare(sql);
    }
    close(): void {
      this.db.close();
    }
  },
}));

import { closeDbConnection } from "../src/main/db";
import {
  listCachedSessions,
  syncSessionCache,
  updateSessionTitle,
} from "../src/main/session-cache";
import { safeWriteFile } from "../src/main/utils";

const databases: DatabaseSync[] = [];
function seed(profile = "default", modern = true): DatabaseSync {
  const dir = join(testHome, profile);
  mkdirSync(join(dir, "desktop"), { recursive: true });
  const db = new DatabaseSync(join(dir, "state.db"));
  databases.push(db);
  db.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY, title TEXT UNIQUE, source TEXT DEFAULT 'cli',
    started_at REAL DEFAULT 1, message_count INTEGER DEFAULT 1, model TEXT DEFAULT 'test'
    ${modern ? ", title_source TEXT DEFAULT 'llm'" : ""}
  ); INSERT INTO sessions (id, title) VALUES ('same-id', 'Original'), ('other', 'Taken');`);
  syncSessionCache(profile);
  return db;
}
beforeEach(() => mkdirSync(testHome, { recursive: true }));
afterEach(() => {
  closeDbConnection();
  for (const db of databases.splice(0)) db.close();
  rmSync(testHome, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("durable session titles", () => {
  // @lat: [[sidebar-navigation#Sidebar recent sessions#Row context menu#Rename persistence#User title provenance]]
  it("records user provenance and keeps a late automatic title from replacing a rename", () => {
    const db = seed();
    updateSessionTitle("same-id", "Chosen name");
    expect(
      db
        .prepare(
          "SELECT title, title_source FROM sessions WHERE id = 'same-id'",
        )
        .get(),
    ).toEqual({ title: "Chosen name", title_source: "user" });
    // An automatic writer may replace derived/LLM titles, never user titles.
    db.prepare(
      "UPDATE sessions SET title = 'Late generated name' WHERE id = 'same-id' AND title_source != 'user'",
    ).run();
    expect(syncSessionCache().find((row) => row.id === "same-id")?.title).toBe(
      "Chosen name",
    );
  });

  it("keeps old Agent schemas writable without adding columns", () => {
    const db = seed("default", false);
    updateSessionTitle("same-id", "Legacy rename");
    expect(
      db.prepare("SELECT title FROM sessions WHERE id = 'same-id'").get()
        ?.title,
    ).toBe("Legacy rename");
  });

  it("rejects duplicate and missing rows without changing the cache", () => {
    const db = seed();
    expect(() => updateSessionTitle("same-id", "Taken")).toThrow(
      "renameDuplicate",
    );
    expect(() => updateSessionTitle("missing", "Unused")).toThrow(
      "renameNotFound",
    );
    expect(
      db.prepare("SELECT title FROM sessions WHERE id = 'same-id'").get()
        ?.title,
    ).toBe("Original");
    expect(
      listCachedSessions().find((row) => row.id === "same-id")?.title,
    ).toBe("Original");
  });

  // @lat: [[sidebar-navigation#Sidebar recent sessions#Row context menu#Rename persistence#Cache mirror recovery]]
  it("repairs an old session's failed cache mirror from its committed database title", () => {
    const db = seed();
    vi.mocked(safeWriteFile).mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    updateSessionTitle("same-id", "Durable despite cache failure");
    expect(
      db.prepare("SELECT title FROM sessions WHERE id = 'same-id'").get()
        ?.title,
    ).toBe("Durable despite cache failure");
    expect(
      listCachedSessions().find((row) => row.id === "same-id")?.title,
    ).toBe("Original");
    syncSessionCache();
    expect(
      listCachedSessions().find((row) => row.id === "same-id")?.title,
    ).toBe("Durable despite cache failure");
  });

  it("renames only the requested profile even when another profile has the same session ID", () => {
    const defaultDb = seed();
    const namedDb = seed("named");
    updateSessionTitle("same-id", "Named profile title", "named");
    expect(
      namedDb.prepare("SELECT title FROM sessions WHERE id = 'same-id'").get()
        ?.title,
    ).toBe("Named profile title");
    expect(
      defaultDb.prepare("SELECT title FROM sessions WHERE id = 'same-id'").get()
        ?.title,
    ).toBe("Original");
    expect(
      listCachedSessions(50, 0, "default").find((row) => row.id === "same-id")
        ?.title,
    ).toBe("Original");
  });
});
