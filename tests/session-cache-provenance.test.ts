// @vitest-environment node
import Database from "better-sqlite3";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, expect, it, vi } from "vitest";

const { testHome } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    testHome: fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cache-source-")),
  };
});
vi.mock("better-sqlite3", async (importOriginal) =>
  process.platform === "linux"
    ? importOriginal()
    : {
        default: class {
          private db: DatabaseSync;
          constructor(path: string, options?: { readonly?: boolean }) {
            this.db = new DatabaseSync(path, { readOnly: options?.readonly });
          }
          exec(sql: string): void {
            this.db.exec(sql);
          }
          prepare(sql: string): ReturnType<DatabaseSync["prepare"]> {
            return this.db.prepare(sql);
          }
          close(): void {
            this.db.close();
          }
        },
      },
);
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
  safeWriteFile: (path: string, data: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, data);
  },
}));
import * as dbModule from "../src/main/db";
import {
  listCachedSessions,
  syncSessionCache,
} from "../src/main/session-cache";

const opened: Database.Database[] = [];
const deskId = "desk-1789288537424-93cea475-ccf9-412a-84a9-e22a929ac194";
function home(profile = "default"): string {
  return profile === "default" ? testHome : join(testHome, "profiles", profile);
}
function cachePath(profile = "default"): string {
  return join(home(profile), "desktop", "sessions.json");
}
function seed(
  profile = "default",
  id = deskId,
  name = "state.db",
): Database.Database {
  mkdirSync(join(home(profile), "desktop"), { recursive: true });
  const db = new Database(join(home(profile), name));
  opened.push(db);
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT DEFAULT 'desktop', started_at INTEGER DEFAULT 100, message_count INTEGER DEFAULT 1, model TEXT DEFAULT 'test', title TEXT, archived INTEGER DEFAULT 0);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp INTEGER);`);
  db.prepare("INSERT INTO sessions(id,title) VALUES (?,?)").run(
    id,
    "Ping-pong strategy",
  );
  return db;
}
function legacy(profile = "default"): string {
  mkdirSync(join(home(profile), "desktop"), { recursive: true });
  const text = JSON.stringify({
    sessions: [
      {
        id: "ghost",
        title: "PONG",
        startedAt: 200,
        source: "desktop",
        messageCount: 1,
        model: "test",
        contextFolder: null,
      },
    ],
    lastSync: 100,
  });
  writeFileSync(cachePath(profile), text);
  return text;
}
afterEach(() => {
  vi.restoreAllMocks();
  dbModule.closeDbConnection();
  for (const db of opened.splice(0)) db.close();
  rmSync(testHome, { recursive: true, force: true });
});

// @lat: [[sidebar-navigation#Session cache provenance#Unverified legacy outage]]
it("never returns legacy cache rows during actual database open failure", () => {
  mkdirSync(testHome, { recursive: true });
  writeFileSync(join(testHome, "state.db"), "not a SQLite database");
  const oldCache = legacy();
  expect(listCachedSessions()).toEqual([]);
  expect(syncSessionCache()).toEqual([]);
  expect(readFileSync(cachePath(), "utf8")).toBe(oldCache);
});

// @lat: [[sidebar-navigation#Session cache provenance#First successful upgrade]]
it("rebuilds legacy history from real SQLite without ID or title heuristics", () => {
  seed();
  legacy();
  expect(listCachedSessions()).toEqual([]);
  expect(syncSessionCache()).toMatchObject([
    { id: deskId, title: "Ping-pong strategy" },
  ]);
  expect(listCachedSessions()).toMatchObject([
    { id: deskId, title: "Ping-pong strategy" },
  ]);
  expect(JSON.parse(readFileSync(cachePath(), "utf8")).source).toMatchObject({
    profile: "default",
    dbPath: join(testHome, "state.db"),
  });
});

// @lat: [[sidebar-navigation#Session cache provenance#Proven offline generation]]
it("retains proven cached history when the unchanged file generation cannot open", () => {
  seed();
  syncSessionCache();
  dbModule.closeDbConnection();
  const unavailable = vi
    .spyOn(dbModule, "getDbConnection")
    .mockReturnValueOnce(null);
  expect(syncSessionCache()).toMatchObject([
    { id: deskId, title: "Ping-pong strategy" },
  ]);
  expect(unavailable).toHaveBeenCalledTimes(1);
  expect(listCachedSessions()).toHaveLength(1);
});

// @lat: [[sidebar-navigation#Session cache provenance#Open connection replacement]]
it("reopens a cached SQLite handle when the file at its path is replaced", () => {
  seed();
  syncSessionCache();
  const replacement = seed("default", "api-new-generation", "replacement.db");
  replacement.close();
  opened.pop();
  renameSync(join(testHome, "replacement.db"), join(testHome, "state.db"));
  expect(listCachedSessions()).toEqual([]);
  expect(syncSessionCache().map((row) => row.id)).toEqual([
    "api-new-generation",
  ]);
  expect(listCachedSessions().map((row) => row.id)).toEqual([
    "api-new-generation",
  ]);
});

// @lat: [[sidebar-navigation#Session cache provenance#Mid-sync replacement]]
it("never stamps old rows with a file generation replaced during the query", () => {
  seed();
  syncSessionCache();
  const oldCache = readFileSync(cachePath(), "utf8");
  const replacement = seed("default", "new-database", "replacement.db");
  replacement.close();
  opened.pop();
  const connection = dbModule.getDbConnection(true)!;
  const prepare = connection.prepare.bind(connection);
  vi.spyOn(connection, "prepare").mockImplementation((sql: string) => {
    const statement = prepare(sql);
    if (!sql.includes("FROM sessions s")) return statement;
    return {
      all: (...parameters: unknown[]) => {
        const rows = statement.all(...parameters);
        renameSync(
          join(testHome, "replacement.db"),
          join(testHome, "state.db"),
        );
        return rows;
      },
    } as Database.Statement;
  });
  expect(syncSessionCache()).toEqual([]);
  expect(readFileSync(cachePath(), "utf8")).toBe(oldCache);
  expect(listCachedSessions()).toEqual([]);
  vi.restoreAllMocks();
  expect(syncSessionCache().map((row) => row.id)).toEqual(["new-database"]);
});

// @lat: [[sidebar-navigation#Session cache provenance#Profile generation isolation]]
it("never rescues an unverifiable named cache from another profile's valid database", () => {
  seed();
  seed("_work", "api-other-profile");
  syncSessionCache();
  syncSessionCache("_work");
  const defaultCache = readFileSync(cachePath(), "utf8");
  writeFileSync(cachePath("_work"), defaultCache);
  expect(listCachedSessions(50, 0, "_work")).toEqual([]);
  expect(syncSessionCache("_work").map((row) => row.id)).toEqual([
    "api-other-profile",
  ]);
  expect(listCachedSessions().map((row) => row.id)).toEqual([deskId]);
});
