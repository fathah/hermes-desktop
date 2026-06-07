import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerLocalSkill, lookupLocalSkill } from "../src/main/skills-registry";
import * as dbModule from "../src/main/db";

class MockDatabase {
  public prepareCalls: { sql: string; params: any[] }[] = [];
  public runResults: any[] = [];
  public allResults: any[] = [];
  public getResults: any[] = [];

  prepare(sql: string) {
    return {
      run: (...params: any[]) => {
        this.prepareCalls.push({ sql, params });
        return this.runResults.shift() || { changes: 1 };
      },
      all: (...params: any[]) => {
        this.prepareCalls.push({ sql, params });
        return this.allResults.shift() || [];
      },
      get: (...params: any[]) => {
        this.prepareCalls.push({ sql, params });
        return this.getResults.shift() || undefined;
      }
    };
  }

  transaction(fn: any) {
    return (list: any[]) => fn(list);
  }
}

describe("Skills Registry", () => {
  let mockDb: MockDatabase;

  beforeEach(() => {
    mockDb = new MockDatabase();
    // Mock getSharedDb to return our mock database
    vi.spyOn(dbModule, "getSharedDb").mockReturnValue(mockDb as any);
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
      dependencies: "[]"
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
      "[]"
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
      dependencies: "[]"
    };

    mockDb.allResults.push([mockSkillEntry]);

    const result = await lookupLocalSkill("test");
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Test Skill");

    expect(mockDb.prepareCalls.length).toBe(1);
    expect(mockDb.prepareCalls[0].sql).toContain("SELECT * FROM skills_registry");
    expect(mockDb.prepareCalls[0].params).toEqual(["%test%", "%test%", "%test%"]);
  });

  it("handles multi-word lookup queries correctly", async () => {
    mockDb.allResults.push([]);

    await lookupLocalSkill("resize image");
    expect(mockDb.prepareCalls.length).toBe(1);
    expect(mockDb.prepareCalls[0].sql).toContain(" AND ");
    expect(mockDb.prepareCalls[0].params.length).toBe(6); // 2 words * 3 columns
  });
});
