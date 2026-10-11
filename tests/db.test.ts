import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getDbConnection, closeDbConnection } from "../src/main/db";
import { activeStateDbPath } from "../src/main/utils";

// Define hoisted mocks (Vitest allows variables prefixed with 'mock')
const { mockClose, mockDatabaseConstructor, mockStatSync } = vi.hoisted(() => {
  const mockClose = vi.fn();
  const mockDatabaseConstructor = vi.fn().mockImplementation(() => {
    return {
      close: mockClose,
      open: true,
    };
  });
  const mockStatSync = vi.fn();
  return { mockClose, mockDatabaseConstructor, mockStatSync };
});

vi.mock("better-sqlite3", () => {
  return {
    default: vi.fn().mockImplementation(function (
      dbPath: string,
      options: unknown,
    ) {
      return mockDatabaseConstructor(dbPath, options);
    }),
  };
});

// Mock the selected path and its physical file generation
vi.mock("../src/main/utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/main/utils")>();
  return {
    ...original,
    activeStateDbPath: vi.fn(),
  };
});

// Lazy evaluation prevents reference errors during hoisting
vi.mock("fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("fs")>();
  return {
    ...original,
    statSync: (path: string, options: unknown) => mockStatSync(path, options),
    default: {
      ...original,
      statSync: (path: string, options: unknown) => mockStatSync(path, options),
    },
  };
});

describe("Database connection caching", () => {
  const dbPath1 = "/fake/path/state1.db";
  const dbPath2 = "/fake/path/state2.db";

  beforeEach(() => {
    mockClose.mockReset();
    mockDatabaseConstructor.mockClear();
    mockStatSync.mockReset();
    vi.mocked(activeStateDbPath).mockReset();
    mockStatSync.mockReturnValue({
      dev: 1n,
      ino: 1n,
      birthtimeNs: 1n,
      isFile: () => true,
    });
  });

  afterEach(() => {
    closeDbConnection();
  });

  it("returns null if database file does not exist", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);
    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const db = getDbConnection();
    expect(db).toBeNull();
    expect(mockDatabaseConstructor).not.toHaveBeenCalled();
  });

  it("caches database connection for same path and readonly status", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);

    const db1 = getDbConnection(true);
    const db2 = getDbConnection(true);

    expect(db1).not.toBeNull();
    expect(db2).not.toBeNull();
    expect(db1).toBe(db2); // Cached same connection
    expect(mockDatabaseConstructor).toHaveBeenCalledTimes(1);
  });

  it("resolves an explicitly requested profile instead of active profile state", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);

    expect(getDbConnection(true, "work")).not.toBeNull();
    expect(activeStateDbPath).toHaveBeenCalledWith("work");
  });

  it("re-creates connection if database path changes (e.g. profile switch)", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);
    const db1 = getDbConnection(true);

    vi.mocked(activeStateDbPath).mockReturnValue(dbPath2);
    const db2 = getDbConnection(true);

    expect(db1).not.toBeNull();
    expect(db2).not.toBeNull();
    expect(db1).not.toBe(db2); // Different connection because path changed
    expect(mockDatabaseConstructor).toHaveBeenCalledTimes(2);
    expect(mockClose).toHaveBeenCalledTimes(1); // Old connection closed
  });

  it("re-creates connection if readonly status changes", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);

    const dbRead = getDbConnection(true);
    const dbWrite = getDbConnection(false);

    expect(dbRead).not.toBeNull();
    expect(dbWrite).not.toBeNull();
    expect(dbRead).not.toBe(dbWrite); // Different connection because mode changed
    expect(mockDatabaseConstructor).toHaveBeenCalledTimes(2);
    expect(mockClose).toHaveBeenCalledTimes(1); // Old connection closed
  });

  it("closes connection on closeDbConnection", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);

    const db = getDbConnection(true);
    expect(db).not.toBeNull();

    closeDbConnection();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
