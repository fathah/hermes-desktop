import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const { TEST_HOME, DB_PATH } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  const home = path.join(
    os.tmpdir(),
    `hermes-delete-session-test-${Date.now()}`,
  );
  return {
    TEST_HOME: home,
    DB_PATH: path.join(home, "state.db"),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

// Simulate better-sqlite3 faithfully: readonly connections reject writes
// with SQLITE_READONLY, just like the real native module.
vi.mock("better-sqlite3", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");

  interface SessionRow {
    id: string;
    source: string;
    started_at: number;
    ended_at: number | null;
    message_count: number;
    model: string;
    title: string | null;
  }

  interface MessageRow {
    id: number;
    session_id: string;
    role: string;
    content: string;
    timestamp: number;
  }

  interface Store {
    sessions: Map<string, SessionRow>;
    messages: MessageRow[];
    nextMessageId: number;
  }

  const stores = new Map<string, Store>();

  function getStore(dbPath: string): Store {
    if (!fs.existsSync(dbPath)) {
      stores.set(dbPath, {
        sessions: new Map<string, SessionRow>(),
        messages: [],
        nextMessageId: 1,
      });
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, "");
    }

    let store = stores.get(dbPath);
    if (!store) {
      store = {
        sessions: new Map<string, SessionRow>(),
        messages: [],
        nextMessageId: 1,
      };
      stores.set(dbPath, store);
    }
    return store;
  }

  class FakeStatement {
    constructor(
      private readonly sql: string,
      private readonly store: Store,
      private readonly readonlyMode: boolean,
    ) {}

    run(...args: unknown[]): { changes: number } {
      if (this.readonlyMode) {
        const isWrite =
          /\b(DELETE|INSERT|UPDATE|REPLACE|DROP|CREATE|ALTER)\b/i.test(
            this.sql,
          );
        if (isWrite) {
          const err = new Error(
            "attempt to write a readonly database",
          ) as Error & { code: string };
          err.code = "SQLITE_READONLY";
          throw err;
        }
      }

      // INSERT / REPLACE handlers (used by seedDb and production code)
      if (
        this.sql.includes("INSERT OR REPLACE INTO sessions") ||
        this.sql.includes("INSERT INTO sessions")
      ) {
        const [id, source, startedAt, messageCount, model, title] = args;
        this.store.sessions.set(String(id), {
          id: String(id),
          source: String(source),
          started_at: Number(startedAt),
          ended_at: null,
          message_count: Number(messageCount),
          model: String(model),
          title: title === null || title === undefined ? null : String(title),
        });
        return { changes: 1 };
      }

      if (this.sql.includes("INSERT INTO messages")) {
        const [sessionId, role, content, timestamp] = args;
        this.store.messages.push({
          id: this.store.nextMessageId++,
          session_id: String(sessionId),
          role: String(role),
          content: String(content),
          timestamp: Number(timestamp),
        });
        return { changes: 1 };
      }

      if (this.sql.includes("DELETE FROM messages")) {
        const sessionId = String(args[0]);
        const before = this.store.messages.length;
        this.store.messages = this.store.messages.filter(
          (m) => m.session_id !== sessionId,
        );
        return { changes: before - this.store.messages.length };
      }

      if (this.sql.includes("DELETE FROM sessions")) {
        const sessionId = String(args[0]);
        const existed = this.store.sessions.has(sessionId);
        this.store.sessions.delete(sessionId);
        return { changes: existed ? 1 : 0 };
      }

      throw new Error(`Unhandled fake run SQL: ${this.sql}`);
    }

    all(...args: unknown[]): unknown[] {
      if (
        this.sql.includes("FROM sessions s") &&
        this.sql.includes("LOWER(COALESCE")
      ) {
        const titlePattern = String(args[0])
          .replace(/^%/, "")
          .replace(/%$/, "")
          .replace(/\\/g, "")
          .toLowerCase();
        const idPattern = String(args[1])
          .replace(/^%/, "")
          .replace(/%$/, "")
          .replace(/\\/g, "")
          .toLowerCase();
        const limit = Number(args[2]);
        return Array.from(this.store.sessions.values())
          .filter((session) =>
            (session.title || "").toLowerCase().includes(titlePattern) ||
            session.id.toLowerCase().includes(idPattern),
          )
          .sort((a, b) => b.started_at - a.started_at)
          .slice(0, limit)
          .map((session) => ({
            session_id: session.id,
            title: session.title,
            started_at: session.started_at,
            source: session.source,
            message_count: session.message_count,
            model: session.model,
          }));
      }

      if (this.sql.includes("FROM sessions s")) {
        const [limit, offset] = args.map(Number);
        return Array.from(this.store.sessions.values())
          .sort((a, b) => b.started_at - a.started_at)
          .slice(offset, offset + limit);
      }

      if (this.sql.includes("FROM messages")) {
        const sessionId = String(args[0]);
        return this.store.messages
          .filter(
            (m) =>
              m.session_id === sessionId &&
              ["user", "assistant"].includes(m.role) &&
              m.content !== null,
          )
          .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
      }

      throw new Error(`Unhandled fake all SQL: ${this.sql}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    get(..._args: unknown[]): unknown {
      if (this.sql.includes("sqlite_master") && this.sql.includes("messages_fts")) {
        return undefined;
      }

      throw new Error(`Unhandled fake get SQL: ${this.sql}`);
    }
  }

  class FakeDatabase {
    private readonly store: Store;
    private readonly readonlyMode: boolean;

    constructor(dbPath: string, options?: { readonly?: boolean }) {
      this.store = getStore(dbPath);
      this.readonlyMode = options?.readonly === true;
    }

    exec(): void {
      /* no-op */
    }

    prepare(sql: string): FakeStatement {
      return new FakeStatement(sql, this.store, this.readonlyMode);
    }

    // better-sqlite3's `transaction(fn)` returns a callable that runs
    // `fn` inside a transaction. The fake doesn't need real atomicity —
    // a synchronous passthrough is enough for deleteSession's two-step
    // delete. Previously absent, which broke deleteSession's tests.
    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return ((...args: never[]) => fn(...args)) as T;
    }

    close(): void {
      /* no-op */
    }
  }

  return { default: FakeDatabase };
});

import Database from "better-sqlite3";
import {
  deleteSession,
  deleteSessions,
  listSessions,
  getSessionMessages,
  searchSessions,
} from "../src/main/sessions";

function seedDb(
  sessions: Array<{
    id: string;
    started_at: number;
    source?: string;
    message_count?: number;
    model?: string;
    title?: string | null;
    messages?: Array<{
      role: "user" | "assistant";
      content: string;
      timestamp: number;
    }>;
  }>,
): void {
  mkdirSync(TEST_HOME, { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      message_count INTEGER,
      model TEXT,
      title TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT,
      content TEXT,
      tool_call_id TEXT,
      tool_calls TEXT,
      tool_name TEXT,
      timestamp INTEGER,
      reasoning TEXT,
      reasoning_content TEXT,
      reasoning_details TEXT
    );
  `);
  const insSession = db.prepare(
    `INSERT OR REPLACE INTO sessions (id, source, started_at, ended_at, message_count, model, title)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  );
  const insMessage = db.prepare(
    `INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
  );
  for (const s of sessions) {
    insSession.run(
      s.id,
      s.source ?? "cli",
      s.started_at,
      s.message_count ?? s.messages?.length ?? 0,
      s.model ?? "gpt-4o",
      s.title ?? null,
    );
    if (s.messages) {
      for (const msg of s.messages) {
        insMessage.run(s.id, msg.role, msg.content, msg.timestamp);
      }
    }
  }
  db.close();
}

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe("deleteSession", () => {
  it("deletes the session and all its messages from the database", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "session-to-delete",
        started_at: now,
        message_count: 2,
        messages: [
          { role: "user", content: "hello", timestamp: now },
          { role: "assistant", content: "hi there", timestamp: now + 1 },
        ],
      },
      {
        id: "session-to-keep",
        started_at: now + 10,
        message_count: 1,
        messages: [{ role: "user", content: "keep me", timestamp: now + 10 }],
      },
    ]);

    // Verify preconditions: both sessions exist
    const beforeSessions = listSessions();
    expect(beforeSessions).toHaveLength(2);
    expect(beforeSessions.map((s) => s.id).sort()).toEqual([
      "session-to-delete",
      "session-to-keep",
    ]);

    const beforeMessages = getSessionMessages("session-to-delete");
    expect(beforeMessages).toHaveLength(2);

    // Act: delete the session
    expect(() => deleteSession("session-to-delete")).not.toThrow();

    // Assert: target session gone, other session untouched
    const afterSessions = listSessions();
    expect(afterSessions).toHaveLength(1);
    expect(afterSessions[0].id).toBe("session-to-keep");

    const deletedMessages = getSessionMessages("session-to-delete");
    expect(deletedMessages).toHaveLength(0);
  });

  it("clears staged attachment files for the deleted session", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "session-with-staged-files",
        started_at: now,
        message_count: 1,
        messages: [{ role: "user", content: "see attached", timestamp: now }],
      },
    ]);
    const stagingDir = join(
      TEST_HOME,
      "desktop-staging",
      "session-with-staged-files",
    );
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, "pasted.png"), "image bytes");

    expect(existsSync(stagingDir)).toBe(true);

    deleteSession("session-with-staged-files");

    expect(existsSync(stagingDir)).toBe(false);
    expect(getSessionMessages("session-with-staged-files")).toHaveLength(0);
  });

  it("does nothing when deleting a non-existent session", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "real-session",
        started_at: now,
        message_count: 1,
        messages: [{ role: "user", content: "real", timestamp: now }],
      },
    ]);

    const beforeSessions = listSessions();
    expect(beforeSessions).toHaveLength(1);

    // Deleting a non-existent session should not throw
    expect(() => deleteSession("nonexistent")).not.toThrow();

    // Existing session should still be there
    const afterSessions = listSessions();
    expect(afterSessions).toHaveLength(1);
    expect(afterSessions[0].id).toBe("real-session");
  });

  it("returns early when the database file does not exist", () => {
    // No DB seeded — HERMES_HOME/state.db doesn't exist
    expect(() => deleteSession("any-session")).not.toThrow();
  });
});

describe("searchSessions", () => {
  it("finds title-only matches when the message body does not contain the query", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "title-only-match",
        title: "Manual bulk delete search target 1780363992423",
        started_at: now,
        message_count: 1,
        messages: [
          {
            role: "user",
            content: "temporary manual bulk delete test row",
            timestamp: now,
          },
        ],
      },
    ]);

    const results = searchSessions("1780363992423");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sessionId: "title-only-match",
      title: "Manual bulk delete search target 1780363992423",
    });
    expect(results[0].snippet).toContain("<<1780363992423>>");
  });

  it("finds sessions by id suffix when the UI displays a fallback title", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "desk-old-session-295d8a",
        title: null,
        started_at: now,
        message_count: 1,
        messages: [
          {
            role: "user",
            content: "body does not include the id suffix",
            timestamp: now,
          },
        ],
      },
    ]);

    const results = searchSessions("295d");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sessionId: "desk-old-session-295d8a",
      title: null,
    });
    expect(results[0].snippet).toContain("Sessions <<295d>>8a");
  });
});

describe("deleteSessions", () => {
  it("deletes multiple sessions and all of their messages", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "bulk-delete-a",
        started_at: now,
        message_count: 1,
        messages: [{ role: "user", content: "delete a", timestamp: now }],
      },
      {
        id: "bulk-delete-b",
        started_at: now + 1,
        message_count: 1,
        messages: [
          { role: "assistant", content: "delete b", timestamp: now + 1 },
        ],
      },
      {
        id: "bulk-keep",
        started_at: now + 2,
        message_count: 1,
        messages: [{ role: "user", content: "keep", timestamp: now + 2 }],
      },
    ]);

    const result = deleteSessions(["bulk-delete-a", "bulk-delete-b"]);

    expect(result).toEqual({ requested: 2, deleted: 2 });
    expect(listSessions().map((s) => s.id)).toEqual(["bulk-keep"]);
    expect(getSessionMessages("bulk-delete-a")).toHaveLength(0);
    expect(getSessionMessages("bulk-delete-b")).toHaveLength(0);
    expect(getSessionMessages("bulk-keep")).toHaveLength(1);
  });

  it("dedupes and ignores blank session ids", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "dedupe-me",
        started_at: now,
        message_count: 1,
        messages: [{ role: "user", content: "delete", timestamp: now }],
      },
    ]);

    const result = deleteSessions([
      "",
      " ",
      "dedupe-me",
      "dedupe-me",
      " missing ",
    ]);

    expect(result).toEqual({ requested: 2, deleted: 1 });
    expect(listSessions()).toHaveLength(0);
  });

  it("clears staged attachment files for every deleted id", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      { id: "bulk-staged-a", started_at: now },
      { id: "bulk-staged-b", started_at: now + 1 },
    ]);
    const stagingA = join(TEST_HOME, "desktop-staging", "bulk-staged-a");
    const stagingB = join(TEST_HOME, "desktop-staging", "bulk-staged-b");
    mkdirSync(stagingA, { recursive: true });
    mkdirSync(stagingB, { recursive: true });
    writeFileSync(join(stagingA, "a.txt"), "a");
    writeFileSync(join(stagingB, "b.txt"), "b");

    deleteSessions(["bulk-staged-a", "bulk-staged-b"]);

    expect(existsSync(stagingA)).toBe(false);
    expect(existsSync(stagingB)).toBe(false);
  });
});
