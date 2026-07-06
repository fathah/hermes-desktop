import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDbConnection } from "./db";
import {
  deleteSessionModelOverrideForSession,
  getSessionModelOverride,
  setSessionModelOverride,
} from "./session-model-override-store";

vi.mock("./db", () => ({
  getDbConnection: vi.fn(),
}));

const mockedGetDbConnection = vi.mocked(getDbConnection);

class FakeStatement {
  constructor(
    private readonly sql: string,
    private readonly db: FakeDb,
  ) {}

  get(sessionId?: string): unknown {
    if (this.sql.includes("sqlite_master")) {
      return this.db.tableCreated
        ? { name: "desktop_session_model_overrides" }
        : undefined;
    }
    if (this.sql.includes("SELECT provider, model, base_url")) {
      return sessionId ? this.db.rows.get(sessionId) : undefined;
    }
    return undefined;
  }

  run(...args: string[]): void {
    if (this.sql.startsWith("DELETE")) {
      this.db.rows.delete(args[0]);
      return;
    }
    if (this.sql.startsWith("INSERT")) {
      const [sessionId, provider, model, baseUrl] = args;
      this.db.rows.set(sessionId, {
        provider,
        model,
        base_url: baseUrl,
      });
    }
  }

  all(): unknown[] {
    if (this.sql.startsWith("PRAGMA table_info")) {
      return ["session_id", "provider", "model", "base_url", "updated_at"].map(
        (name) => ({ name }),
      );
    }
    return [];
  }
}

class FakeDb {
  readonly rows = new Map<
    string,
    { provider: string; model: string; base_url: string }
  >();
  tableCreated = false;

  exec(): void {
    this.tableCreated = true;
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(sql.trim(), this);
  }

  close(): void {
    this.rows.clear();
  }
}

describe("session model override store", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = new FakeDb();
    mockedGetDbConnection.mockReset();
    mockedGetDbConnection.mockReturnValue(db as never);
  });

  afterEach(() => {
    db.close();
  });

  it("stores and reads provider/model routing identity without credentials", () => {
    setSessionModelOverride("s1", {
      provider: "gemini",
      model: "gemini-2.5-pro",
      baseUrl: "",
    });

    expect(getSessionModelOverride("s1")).toEqual({
      provider: "gemini",
      model: "gemini-2.5-pro",
      baseUrl: "",
    });
    const columns = db
      .prepare("PRAGMA table_info(desktop_session_model_overrides)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain("api_key");
  });

  it("clears and deletes saved overrides", () => {
    setSessionModelOverride("s1", {
      provider: "custom",
      model: "local-model",
      baseUrl: "http://localhost:11434/v1",
    });
    setSessionModelOverride("s1", null);
    expect(getSessionModelOverride("s1")).toBeNull();

    setSessionModelOverride("s2", {
      provider: "groq",
      model: "llama-3.3",
      baseUrl: "",
    });
    deleteSessionModelOverrideForSession(db as never, "s2");
    expect(getSessionModelOverride("s2")).toBeNull();
  });
});
