import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import os from "os";

interface FakeDbInstance {
  dbPath: string;
  options?: unknown;
  closed: boolean;
  pragmas: string[];
}

type DbPoolTestGlobal = typeof globalThis & {
  __dbInstances?: FakeDbInstance[];
};

vi.mock("better-sqlite3", () => {
  class FakeDatabase implements FakeDbInstance {
    public closed = false;
    public pragmas: string[] = [];
    constructor(
      public dbPath: string,
      public options?: unknown,
    ) {
      const testGlobal = globalThis as DbPoolTestGlobal;
      if (!testGlobal.__dbInstances) {
        testGlobal.__dbInstances = [];
      }
      testGlobal.__dbInstances.push(this);
    }
    pragma(sql: string): void {
      this.pragmas.push(sql);
    }
    close(): void {
      this.closed = true;
    }
  }
  return {
    default: FakeDatabase,
  };
});

import {
  getSharedDb,
  closeSharedDb,
  initializeMetadataTable,
} from "../src/main/db";
import * as utils from "../src/main/utils";

const TEST_DIR = join(os.tmpdir(), `hermes-db-pool-test-${Date.now()}`);
const DB_PATH_1 = join(TEST_DIR, "state.db");
const PROFILE_DIR = join(TEST_DIR, "profiles", "other_profile");
const DB_PATH_2 = join(PROFILE_DIR, "state.db");

describe("Database Connection Caching", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(PROFILE_DIR, { recursive: true });
    // Seed files so existsSync returns true
    writeFileSync(DB_PATH_1, "");
    writeFileSync(DB_PATH_2, "");
    (globalThis as DbPoolTestGlobal).__dbInstances = [];
  });

  afterEach(() => {
    closeSharedDb();
    rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
    delete (globalThis as DbPoolTestGlobal).__dbInstances;
  });

  it("returns the same database connection instance on repeated calls", () => {
    vi.spyOn(utils, "activeStateDbPath").mockReturnValue(DB_PATH_1);

    const first = getSharedDb(true);
    const second = getSharedDb(true);

    expect(first).toBeDefined();
    expect(second).toBe(first);

    const dbInstances = (globalThis as DbPoolTestGlobal).__dbInstances || [];
    expect(dbInstances.length).toBe(1);
    expect(dbInstances[0].dbPath).toBe(DB_PATH_1);
  });

  it("configures WAL and synchronous pragmas when opening read-write", () => {
    vi.spyOn(utils, "activeStateDbPath").mockReturnValue(DB_PATH_1);

    const db = getSharedDb(false);
    expect(db).toBeDefined();

    const dbInstances = (globalThis as DbPoolTestGlobal).__dbInstances || [];
    expect(dbInstances.length).toBe(1);
    expect(dbInstances[0].pragmas).toContain("journal_mode = WAL");
    expect(dbInstances[0].pragmas).toContain("synchronous = NORMAL");
  });

  it("does not create a missing database for read-only access", () => {
    const missingPath = join(TEST_DIR, "missing-readonly", "state.db");
    vi.spyOn(utils, "activeStateDbPath").mockReturnValue(missingPath);

    const db = getSharedDb(true);
    expect(db).toBeNull();

    const dbInstances = (globalThis as DbPoolTestGlobal).__dbInstances || [];
    expect(dbInstances.length).toBe(0);
  });

  it("opens a writable connection when the database file is missing", () => {
    const missingPath = join(TEST_DIR, "missing-writable", "state.db");
    vi.spyOn(utils, "activeStateDbPath").mockReturnValue(missingPath);

    const db = getSharedDb(false);
    expect(db).toBeDefined();

    const dbInstances = (globalThis as DbPoolTestGlobal).__dbInstances || [];
    expect(dbInstances.length).toBe(1);
    expect(dbInstances[0].dbPath).toBe(missingPath);
    expect(dbInstances[0].options).toEqual({});
  });

  it("recycles connection and opens a new one when active database path changes", () => {
    const pathSpy = vi.spyOn(utils, "activeStateDbPath");

    // Start with DB 1
    pathSpy.mockReturnValue(DB_PATH_1);
    const db1 = getSharedDb(true);
    expect(db1).toBeDefined();

    const dbInstances = (globalThis as DbPoolTestGlobal).__dbInstances || [];
    expect(dbInstances.length).toBe(1);

    // Switch to DB 2
    pathSpy.mockReturnValue(DB_PATH_2);
    const db2 = getSharedDb(true);
    expect(db2).toBeDefined();
    expect(db2).not.toBe(db1);
    expect(dbInstances.length).toBe(2);
    expect(dbInstances[0].closed).toBe(true); // First DB is closed

    // Verify calling it again retains DB 2 connection
    const db2Again = getSharedDb(true);
    expect(db2Again).toBe(db2);
    expect(dbInstances.length).toBe(2);
  });

  it("does not create a metadata trigger when the messages table is missing", () => {
    const preparedSql: string[] = [];
    const runSql: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      prepare: vi.fn((sql: string) => {
        preparedSql.push(sql);
        return {
          get: () => undefined,
          run: () => {
            runSql.push(sql);
            if (sql.includes("AFTER DELETE ON messages")) {
              throw new Error("messages table missing");
            }
          },
        };
      }),
    };

    initializeMetadataTable(db as never);

    expect(runSql.some((sql) => sql.includes("messages_metadata"))).toBe(true);
    expect(
      preparedSql.some((sql) => sql.includes("AFTER DELETE ON messages")),
    ).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("creates the metadata cleanup trigger when the messages table exists", () => {
    const runSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        get: () => (sql.includes("sqlite_master") ? { name: "messages" } : {}),
        run: () => runSql.push(sql),
      })),
    };

    initializeMetadataTable(db as never);

    expect(runSql.some((sql) => sql.includes("AFTER DELETE ON messages"))).toBe(
      true,
    );
  });
});
