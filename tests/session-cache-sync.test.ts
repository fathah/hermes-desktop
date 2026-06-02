import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";

// vi.hoisted runs before module imports, so we can't reference imported
// helpers here — use the bare Node modules via require.
const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(
      os.tmpdir(),
      `hermes-session-cache-test-${Date.now()}`,
    ),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  hermesCliArgs: (args: string[] = []) => ["/dev/null", ...args],
  getEnhancedPath: () => process.env.PATH || "",
}));

// Stub the i18n + locale modules so the cache code doesn't need the
// renderer-side translation files at test time.
vi.mock("../src/shared/i18n", () => ({
  t: (key: string) => key,
}));
vi.mock("../src/main/locale", () => ({
  getAppLocale: () => "en",
}));

vi.mock("better-sqlite3", () => {
  // The app rebuilds better-sqlite3 for Electron during postinstall, while
  // Vitest runs under Node. Mock the tiny DB surface this unit test needs so
  // npm ci && npm test does not depend on native module ABI state.
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
    ) {}

    run(...args: unknown[]): { changes: number } {
      if (this.sql.includes("INSERT OR REPLACE INTO sessions")) {
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

      throw new Error(`Unhandled fake run SQL: ${this.sql}`);
    }

    all(
      ...args: unknown[]
    ): SessionRow[] | Array<{ id: string; message_count: number }> {
      if (this.sql.includes("FROM sessions s")) {
        const threshold = Number(args[0] ?? 0);
        return Array.from(this.store.sessions.values())
          .filter((session) => session.started_at > threshold)
          .sort((a, b) => b.started_at - a.started_at);
      }

      // Phase-2 refresh query introduced for issue #226:
      //   SELECT id, message_count FROM sessions WHERE id IN (?, ?, …)
      if (
        this.sql.includes("SELECT id, message_count FROM sessions") &&
        this.sql.includes("WHERE id IN")
      ) {
        const ids = args.map(String);
        return ids
          .map((id) => this.store.sessions.get(id))
          .filter((s): s is SessionRow => !!s)
          .map((s) => ({ id: s.id, message_count: s.message_count }));
      }

      throw new Error(`Unhandled fake all SQL: ${this.sql}`);
    }

    get(...args: unknown[]): { content: string } | undefined {
      if (this.sql.includes("SELECT content FROM messages")) {
        const sessionId = String(args[0]);
        const match = this.store.messages
          .filter(
            (message) =>
              message.session_id === sessionId &&
              message.role === "user" &&
              message.content !== null,
          )
          .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)[0];
        return match ? { content: match.content } : undefined;
      }

      throw new Error(`Unhandled fake get SQL: ${this.sql}`);
    }
  }

  class FakeDatabase {
    private readonly store: Store;

    constructor(dbPath: string) {
      this.store = getStore(dbPath);
    }

    exec(): void {
      /* Schema creation is a no-op for the in-memory fake. */
    }

    prepare(sql: string): FakeStatement {
      return new FakeStatement(sql, this.store);
    }

    close(): void {
      /* no-op */
    }
  }

  return { default: FakeDatabase };
});

import Database from "better-sqlite3";
import { syncSessionCache } from "../src/main/session-cache";

const CACHE_FILE = join(TEST_HOME, "desktop", "sessions.json");
const DB_PATH = join(TEST_HOME, "state.db");

function seedDb(
  sessions: Array<{
    id: string;
    started_at: number;
    source?: string;
    message_count?: number;
    model?: string;
    title?: string | null;
    firstUserMessage?: string;
  }>,
): void {
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
      timestamp INTEGER
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
      s.message_count ?? 0,
      s.model ?? "gpt-4o",
      s.title ?? null,
    );
    if (s.firstUserMessage) {
      insMessage.run(s.id, "user", s.firstUserMessage, s.started_at);
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

describe("syncSessionCache", () => {
  it("returns an empty list when no DB exists yet", () => {
    expect(syncSessionCache()).toEqual([]);
  });

  it("on first sync, ingests all sessions and generates titles", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "s1",
        started_at: now,
        message_count: 2,
        firstUserMessage: "How do I write a Python decorator?",
      },
      {
        id: "s2",
        started_at: now + 100,
        message_count: 4,
        firstUserMessage: "Explain RAII in Rust",
      },
    ]);

    const result = syncSessionCache();
    expect(result).toHaveLength(2);
    // Sorted by startedAt DESC
    expect(result[0].id).toBe("s2");
    expect(result[1].id).toBe("s1");
    expect(result[0].title).toContain("RAII");
    expect(result[1].title).toContain("Python decorator");
    expect(existsSync(CACHE_FILE)).toBe(true);
  });

  it("treats an empty cache with a stale lastSync as a cold cache", () => {
    const oldStart = Math.floor(Date.now() / 1000) - 86400 * 14;
    seedDb([
      {
        id: "old-hidden-session",
        started_at: oldStart,
        message_count: 3,
        firstUserMessage: "Recover this older session",
      },
    ]);

    mkdirSync(join(TEST_HOME, "desktop"), { recursive: true });
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({
        sessions: [],
        lastSync: Math.floor(Date.now() / 1000),
      }),
      "utf-8",
    );

    const result = syncSessionCache();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "old-hidden-session",
      messageCount: 3,
    });
    expect(result[0].title).toContain("Recover this older session");
  });

  it("updates messageCount on existing sessions without duplicating them (issue #16 regression)", () => {
    // Use a future started_at so the 5-minute incremental sync window
    // (lastSync - 300) still catches the row on the second sync.
    const future = Math.floor(Date.now() / 1000) + 600;
    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 2,
        firstUserMessage: "hi",
      },
    ]);
    syncSessionCache();

    // Bump message_count on the same session.
    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 9,
        firstUserMessage: "hi",
      },
    ]);
    const result = syncSessionCache();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
    expect(result[0].messageCount).toBe(9);
  });

  it("appends new sessions on subsequent syncs without losing old ones", () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 1,
        firstUserMessage: "a",
      },
    ]);
    syncSessionCache();

    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 1,
        firstUserMessage: "a",
      },
      {
        id: "s2",
        started_at: future + 200,
        message_count: 5,
        firstUserMessage: "b",
      },
    ]);
    const result = syncSessionCache();

    expect(result.map((r) => r.id)).toEqual(["s2", "s1"]);
  });

  it("refreshes messageCount for old sessions outside the lastSync window (issue #226)", () => {
    // Session started well before the 5-minute incremental sync window
    // looks (lastSync - 300). Without the Phase 2 refresh, the cache
    // pegs messageCount at whatever was first observed — the user
    // reports the symptom as "messageCount records only 15 messages
    // when there are actually 200+".
    const oldStart = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
    seedDb([
      {
        id: "old-session",
        started_at: oldStart,
        message_count: 1,
        firstUserMessage: "first",
      },
    ]);
    // First sync acquires the session at messageCount: 1.
    const first = syncSessionCache();
    expect(first).toHaveLength(1);
    expect(first[0].messageCount).toBe(1);

    // Simulate the user accumulating many messages over time — the
    // session's started_at stays put (well in the past) but its
    // message_count grows.
    seedDb([
      {
        id: "old-session",
        started_at: oldStart,
        message_count: 200,
        firstUserMessage: "first",
      },
    ]);
    const second = syncSessionCache();

    expect(second).toHaveLength(1);
    expect(second[0].id).toBe("old-session");
    expect(second[0].messageCount).toBe(200);
    // Title and other metadata are preserved (Phase 2 only touches the
    // count field — no re-running of title generation).
    expect(second[0].title).toContain("first");
  });

  it("prunes cached sessions that no longer exist in state.db", () => {
    const oldStart = Math.floor(Date.now() / 1000) - 86400 * 14;
    seedDb([
      {
        id: "still-present",
        started_at: oldStart,
        message_count: 3,
        firstUserMessage: "keep me",
      },
    ]);

    mkdirSync(join(TEST_HOME, "desktop"), { recursive: true });
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({
        sessions: [
          {
            id: "already-deleted",
            title: "Already deleted",
            startedAt: oldStart,
            source: "api_server",
            messageCount: 1,
            model: "gpt-5.5",
          },
          {
            id: "still-present",
            title: "Keep me",
            startedAt: oldStart,
            source: "api_server",
            messageCount: 1,
            model: "gpt-5.5",
          },
        ],
        lastSync: Math.floor(Date.now() / 1000),
      }),
      "utf-8",
    );

    const result = syncSessionCache();

    expect(result.map((s) => s.id)).toEqual(["still-present"]);
    expect(result[0].messageCount).toBe(3);
  });

  it("refreshes some old, leaves others untouched, all in one sync", () => {
    // Mix: one session inside the lastSync window (handled by Phase 1)
    // and two outside it (handled by Phase 2). All three counts grow
    // between syncs; both phases should keep the cache accurate.
    const now = Math.floor(Date.now() / 1000);
    const oldA = now - 86400 * 7;
    const oldB = now - 86400 * 3;
    const future = now + 600;

    seedDb([
      {
        id: "old-a",
        started_at: oldA,
        message_count: 5,
        firstUserMessage: "a",
      },
      {
        id: "old-b",
        started_at: oldB,
        message_count: 10,
        firstUserMessage: "b",
      },
      {
        id: "new-c",
        started_at: future,
        message_count: 1,
        firstUserMessage: "c",
      },
    ]);
    syncSessionCache();

    seedDb([
      {
        id: "old-a",
        started_at: oldA,
        message_count: 50,
        firstUserMessage: "a",
      },
      {
        id: "old-b",
        started_at: oldB,
        message_count: 25,
        firstUserMessage: "b",
      },
      {
        id: "new-c",
        started_at: future,
        message_count: 7,
        firstUserMessage: "c",
      },
    ]);
    const result = syncSessionCache();

    const byId = new Map(result.map((r) => [r.id, r] as const));
    expect(byId.get("old-a")?.messageCount).toBe(50);
    expect(byId.get("old-b")?.messageCount).toBe(25);
    expect(byId.get("new-c")?.messageCount).toBe(7);
  });

  it("updates title and model on existing sessions when DB values change", () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 2,
        model: "gpt-4o",
        title: "Old title",
        firstUserMessage: "hi",
      },
    ]);
    const first = syncSessionCache();
    expect(first[0].title).toBe("Old title");
    expect(first[0].model).toBe("gpt-4o");

    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 5,
        model: "claude-sonnet-4-20250514",
        title: "Updated title",
        firstUserMessage: "hi",
      },
    ]);
    const second = syncSessionCache();

    expect(second).toHaveLength(1);
    expect(second[0].title).toBe("Updated title");
    expect(second[0].model).toBe("claude-sonnet-4-20250514");
    expect(second[0].messageCount).toBe(5);
  });

  it("handles a large existing cache without quadratic blowup (issue #16)", () => {
    // 1500 existing sessions in cache, then sync sees same 1500 but with
    // bumped message counts. The pre-fix O(N²) implementation took >2s here
    // on commodity hardware; the O(N) implementation should finish in well
    // under 500ms.
    const N = 1500;
    const future = Math.floor(Date.now() / 1000) + 600;
    const sessions = Array.from({ length: N }, (_, i) => ({
      id: `s${i}`,
      started_at: future + i,
      message_count: 1,
      firstUserMessage: `message ${i}`,
    }));
    seedDb(sessions);
    syncSessionCache(); // first sync — populates cache

    // Bump every message_count and re-sync.
    seedDb(sessions.map((s) => ({ ...s, message_count: s.message_count + 1 })));
    const start = Date.now();
    const result = syncSessionCache();
    const elapsed = Date.now() - start;

    expect(result).toHaveLength(N);
    expect(result.every((r) => r.messageCount === 2)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  }, 30000);
});
