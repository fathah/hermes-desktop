import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";

const { TEST_HOME, DB_PATH } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  const home = path.join(
    os.tmpdir(),
    `hermes-rename-session-test-${Date.now()}`,
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
// with SQLITE_READONLY, just like the real native module. Mirrors the fake in
// sessions-delete-session.test.ts, plus an UPDATE handler for the title column.
vi.mock("better-sqlite3", () => {
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

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");

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

      if (this.sql.includes("UPDATE sessions SET title")) {
        const [title, sessionId] = args;
        const row = this.store.sessions.get(String(sessionId));
        if (!row) return { changes: 0 };
        row.title =
          title === null || title === undefined ? null : String(title);
        return { changes: 1 };
      }

      throw new Error(`Unhandled fake run SQL: ${this.sql}`);
    }

    all(...args: unknown[]): SessionRow[] {
      if (this.sql.includes("FROM sessions s")) {
        const [limit, offset] = args.map(Number);
        return Array.from(this.store.sessions.values())
          .sort((a, b) => b.started_at - a.started_at)
          .slice(offset, offset + limit);
      }

      throw new Error(`Unhandled fake all SQL: ${this.sql}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    get(..._args: unknown[]): unknown {
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

    close(): void {
      /* no-op */
    }
  }

  return { default: FakeDatabase };
});

import Database from "better-sqlite3";
import { renameSession, listSessions } from "../src/main/sessions";

function seedDb(
  sessions: Array<{
    id: string;
    started_at: number;
    source?: string;
    message_count?: number;
    model?: string;
    title?: string | null;
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
  `);
  const insSession = db.prepare(
    `INSERT OR REPLACE INTO sessions (id, source, started_at, ended_at, message_count, model, title)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  );
  for (const s of sessions) {
    insSession.run(
      s.id,
      s.source ?? "cli",
      s.started_at,
      s.message_count ?? 0,
      s.model ?? "gpt-4o",
      s.title ?? null,
    );
  }
  db.close();
}

function titleOf(sessionId: string): string | null | undefined {
  return listSessions().find((s) => s.id === sessionId)?.title;
}

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe("renameSession", () => {
  it("updates the session title in the database", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      { id: "session-to-rename", started_at: now, title: "Old title" },
      { id: "session-to-keep", started_at: now + 10, title: "Untouched" },
    ]);

    expect(titleOf("session-to-rename")).toBe("Old title");

    expect(() =>
      renameSession("session-to-rename", "Brand new title"),
    ).not.toThrow();

    expect(titleOf("session-to-rename")).toBe("Brand new title");
    // Other sessions must be left alone.
    expect(titleOf("session-to-keep")).toBe("Untouched");
  });

  it("does nothing when renaming a non-existent session", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([{ id: "real-session", started_at: now, title: "Real" }]);

    expect(() =>
      renameSession("nonexistent", "Should not appear"),
    ).not.toThrow();

    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("real-session");
    expect(sessions[0].title).toBe("Real");
  });

  it("returns early when the database file does not exist", () => {
    // No DB seeded — HERMES_HOME/state.db doesn't exist.
    expect(() => renameSession("any-session", "Whatever")).not.toThrow();
  });
});
