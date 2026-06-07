import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerLocalSkill,
  lookupLocalSkill,
} from "../src/main/skills-registry";
import * as dbModule from "../src/main/db";

interface PreparedMock {
  run: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
}

class MockDatabase {
  public prepareCalls: { sql: string; params: unknown[] }[] = [];
  public runResults: unknown[] = [];
  public allResults: unknown[][] = [];
  public getResults: unknown[] = [];

  prepare(sql: string): PreparedMock {
    return {
      run: (...params: unknown[]) => {
        this.prepareCalls.push({ sql, params });
        return this.runResults.shift() || { changes: 1 };
      },
      all: (...params: unknown[]) => {
        this.prepareCalls.push({ sql, params });
        return this.allResults.shift() || [];
      },
      get: (...params: unknown[]) => {
        this.prepareCalls.push({ sql, params });
        return this.getResults.shift() || undefined;
      },
    };
  }

  transaction(fn: (list: unknown[]) => unknown): (list: unknown[]) => unknown {
    return (list: unknown[]) => fn(list);
  }
}

describe("Skills Registry", () => {
  let mockDb: MockDatabase;

  beforeEach(() => {
    mockDb = new MockDatabase();
    // Mock getSharedDb to return our mock database
    vi.spyOn(dbModule, "getSharedDb").mockReturnValue(
      mockDb as unknown as ReturnType<typeof dbModule.getSharedDb>,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("can register a skill", async () => {
    const mockSkill = {
      name: "Test Skill",
      description: "Test description",
      keywords: "test, mock",
      status: "active",
      entrypoint: "/path/to/main.py",
      dependencies: "[]",
    };

    const result = await registerLocalSkill(mockSkill);
    expect(result.success).toBe(true);

    expect(mockDb.prepareCalls.length).toBe(1);
    expect(mockDb.prepareCalls[0].sql).toContain("INSERT INTO skills_registry");
    expect(mockDb.prepareCalls[0].params).toEqual([
      "Test Skill",
      "Test description",
      "test, mock",
      "active",
      "/path/to/main.py",
      "[]",
    ]);
  });

  it("can lookup a skill", async () => {
    const mockSkillEntry = {
      id: 1,
      name: "Test Skill",
      description: "Test description",
      keywords: "test, mock",
      status: "active",
      entrypoint: "/path/to/main.py",
      dependencies: "[]",
    };

    mockDb.allResults.push([mockSkillEntry]);

    const result = await lookupLocalSkill("test");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Test Skill");

    expect(mockDb.prepareCalls.length).toBe(1);
    expect(mockDb.prepareCalls[0].sql).toContain(
      "SELECT * FROM skills_registry",
    );
    expect(mockDb.prepareCalls[0].params).toEqual([
      "%test%",
      "%test%",
      "%test%",
    ]);
  });

  it("handles multi-word lookup queries correctly", async () => {
    mockDb.allResults.push([]);

    await lookupLocalSkill("resize image");
    expect(mockDb.prepareCalls.length).toBe(1);
    expect(mockDb.prepareCalls[0].sql).toContain(" AND ");
    expect(mockDb.prepareCalls[0].params.length).toBe(6); // 2 words * 3 columns
  });
});
