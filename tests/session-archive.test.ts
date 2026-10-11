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
  return {
    testHome: fs.mkdtempSync(path.join(os.tmpdir(), "hermes-archive-")),
  };
});

vi.mock("../src/main/installer", () => ({ HERMES_HOME: testHome }));
vi.mock("../src/main/locale", () => ({ getAppLocale: () => "en" }));
vi.mock("../src/shared/i18n", () => ({ t: (key: string) => key }));
vi.mock("../src/main/utils", () => ({
  profileHome: (profile?: unknown) =>
    profile && profile !== "default"
      ? join(testHome, "profiles", String(profile))
      : testHome,
  activeStateDbPath: (profile?: unknown) =>
    join(
      profile && profile !== "default"
        ? join(testHome, "profiles", String(profile))
        : testHome,
      "state.db",
    ),
  getActiveProfileNameSync: () => "default",
  safeWriteFile: (path: string, data: string) => writeFileSync(path, data),
}));

// Execute the real queries with Node 22's SQLite engine. The application
// rebuilds better-sqlite3 for Electron, whose ABI differs from the test runner.
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
import { getSessionMessages, listSessions } from "../src/main/sessions";
import {
  listCachedSessions,
  syncSessionCache,
} from "../src/main/session-cache";

const databases: DatabaseSync[] = [];

function seedProfile(
  profile = "default",
  hasArchiveColumn = true,
): DatabaseSync {
  const home =
    profile === "default" ? testHome : join(testHome, "profiles", profile);
  mkdirSync(join(home, "desktop"), { recursive: true });
  const db = new DatabaseSync(join(home, "state.db"));
  databases.push(db);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT DEFAULT 'cli', started_at REAL,
      ended_at REAL, message_count INTEGER DEFAULT 1,
      model TEXT DEFAULT 'test-model', title TEXT
      ${hasArchiveColumn ? ", archived INTEGER NOT NULL DEFAULT 0" : ""}
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
      timestamp REAL, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT,
      reasoning TEXT, reasoning_content TEXT, reasoning_details TEXT
    );
  `);
  return db;
}

function addSession(db: DatabaseSync, id: string, startedAt: number): void {
  db.prepare("INSERT INTO sessions (id, started_at) VALUES (?, ?)").run(
    id,
    startedAt,
  );
  db.prepare(
    "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'user', ?, ?)",
  ).run(id, `Message for ${id}`, startedAt);
}

beforeEach(() => mkdirSync(testHome, { recursive: true }));
afterEach(() => {
  closeDbConnection();
  for (const db of databases.splice(0)) db.close();
  rmSync(testHome, { recursive: true, force: true });
});

describe("native session archive visibility", () => {
  it("excludes archived sessions from the direct local list without deleting messages", () => {
    const db = seedProfile();
    addSession(db, "visible", 100);
    addSession(db, "archived", 200);
    db.prepare("UPDATE sessions SET archived = 1 WHERE id = ?").run("archived");

    expect(listSessions().map((s) => s.id)).toEqual(["visible"]);
    expect(getSessionMessages("archived")).toEqual([
      expect.objectContaining({
        kind: "user",
        content: "Message for archived",
      }),
    ]);
  });

  it("hides native archives when populating a cold cache", () => {
    const db = seedProfile();
    addSession(db, "visible", 100);
    addSession(db, "archived", 200);
    db.prepare("UPDATE sessions SET archived = 1 WHERE id = ?").run("archived");

    expect(syncSessionCache().map((s) => s.id)).toEqual(["visible"]);
    expect(listCachedSessions().map((s) => s.id)).toEqual(["visible"]);
  });

  it("reconciles old archive and unarchive transitions with a nonempty warm cache", () => {
    const db = seedProfile();
    addSession(db, "keep", 100);
    addSession(db, "old", 200);
    expect(syncSessionCache().map((s) => s.id)).toEqual(["old", "keep"]);

    db.prepare("UPDATE sessions SET archived = 1 WHERE id = ?").run("old");
    expect(syncSessionCache().map((s) => s.id)).toEqual(["keep"]);
    expect(listCachedSessions().map((s) => s.id)).toEqual(["keep"]);

    db.prepare("UPDATE sessions SET archived = 0 WHERE id = ?").run("old");
    expect(syncSessionCache().map((s) => s.id)).toEqual(["old", "keep"]);
    expect(listCachedSessions().map((s) => s.id)).toEqual(["old", "keep"]);
    expect(getSessionMessages("old")).toEqual([
      expect.objectContaining({ kind: "user", content: "Message for old" }),
    ]);
  });

  it("discovers a restored old session that was never cached", () => {
    const db = seedProfile();
    addSession(db, "keep", 100);
    addSession(db, "restored", 200);
    db.prepare("UPDATE sessions SET archived = 1 WHERE id = ?").run("restored");
    expect(syncSessionCache().map((s) => s.id)).toEqual(["keep"]);

    db.prepare("UPDATE sessions SET archived = 0 WHERE id = ?").run("restored");
    expect(syncSessionCache().map((s) => s.id)).toEqual(["restored", "keep"]);
  });

  it("filters before paginating direct and cached lists", () => {
    const db = seedProfile();
    for (let i = 0; i < 6; i++) addSession(db, `session-${i}`, i);
    db.exec("UPDATE sessions SET archived = 1 WHERE started_at IN (3, 5)");

    expect(listSessions(2, 0).map((s) => s.id)).toEqual([
      "session-4",
      "session-2",
    ]);
    expect(listSessions(2, 2).map((s) => s.id)).toEqual([
      "session-1",
      "session-0",
    ]);
    syncSessionCache();
    expect(listCachedSessions(2, 0).map((s) => s.id)).toEqual([
      "session-4",
      "session-2",
    ]);
    expect(listCachedSessions(2, 2).map((s) => s.id)).toEqual([
      "session-1",
      "session-0",
    ]);
    expect(listCachedSessions(2, 4)).toEqual([]);
  });

  it("keeps archive transitions isolated between profiles with equal session IDs", () => {
    const defaultDb = seedProfile();
    const workDb = seedProfile("work");
    addSession(defaultDb, "shared", 100);
    addSession(workDb, "shared", 100);
    syncSessionCache();
    syncSessionCache("work");
    workDb.exec("UPDATE sessions SET archived = 1");

    expect(syncSessionCache("work")).toEqual([]);
    expect(listSessions(30, 0, "work")).toEqual([]);
    expect(syncSessionCache().map((s) => s.id)).toEqual(["shared"]);
    expect(listCachedSessions(50, 0, "work")).toEqual([]);
    workDb.exec("UPDATE sessions SET archived = 0");
    expect(syncSessionCache("work").map((s) => s.id)).toEqual(["shared"]);
  });

  it("reads legacy databases and detects an archive column added to an open database", () => {
    const db = seedProfile("default", false);
    addSession(db, "legacy", 100);
    expect(listSessions().map((s) => s.id)).toEqual(["legacy"]);
    expect(syncSessionCache().map((s) => s.id)).toEqual(["legacy"]);

    db.exec(
      "ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    );
    db.exec("UPDATE sessions SET archived = 1");
    expect(listSessions()).toEqual([]);
    expect(syncSessionCache()).toEqual([]);
    expect(getSessionMessages("legacy")).toHaveLength(1);
  });

  it("retains the last good cache during a database read failure and recovers on retry", () => {
    const db = seedProfile();
    addSession(db, "kept", 100);
    const previous = syncSessionCache();
    db.exec("ALTER TABLE sessions RENAME TO temporarily_unavailable");
    expect(syncSessionCache()).toEqual(previous);
    expect(listCachedSessions()).toEqual(previous);

    db.exec("ALTER TABLE temporarily_unavailable RENAME TO sessions");
    db.exec("UPDATE sessions SET archived = 1");
    expect(syncSessionCache()).toEqual([]);
    expect(listCachedSessions()).toEqual([]);
  });

  it("restores linked project folders along with unarchived sessions", () => {
    const db = seedProfile();
    addSession(db, "linked", 100);
    db.exec(
      "CREATE TABLE desktop_session_context_folders (session_id TEXT PRIMARY KEY, folder_path TEXT)",
    );
    db.prepare("INSERT INTO desktop_session_context_folders VALUES (?, ?)").run(
      "linked",
      "/workspace/demo",
    );
    expect(syncSessionCache()[0].contextFolder).toBe("/workspace/demo");
    db.exec("UPDATE sessions SET archived = 1");
    expect(syncSessionCache()).toEqual([]);
    db.exec("UPDATE sessions SET archived = 0");
    expect(syncSessionCache()[0].contextFolder).toBe("/workspace/demo");
    expect(listCachedSessions()[0].contextFolder).toBe("/workspace/demo");
  });
});
