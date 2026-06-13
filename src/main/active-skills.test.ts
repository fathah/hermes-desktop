import { describe, it, expect, beforeEach, vi } from "vitest";

// Isolate the active-skills logic: mock the skills catalogue (so no disk/CLI)
// and the profile resolver (so keys are deterministic). getSkillContent is the
// only thing the builder reads.
const installed = [
  {
    name: "Deep Research",
    category: "research",
    description: "multi-source research",
    path: "/skills/research/deep-research",
  },
  {
    name: "code-review",
    category: "dev",
    description: "adversarial review",
    path: "/skills/dev/code-review",
  },
];

const contentByPath: Record<string, string> = {
  "/skills/research/deep-research": "# Deep Research\nFan out and verify.",
  "/skills/dev/code-review": "# Code Review\nBe adversarial.",
};
let riskReports = installed.map((skill) => ({
  id: `skill:${skill.path}`,
  kind: "skill",
  name: skill.name,
  status: "safe",
  reviewState: "reviewed",
}));

vi.mock("./skills", () => ({
  listInstalledSkills: () => installed,
  getSkillContent: (p: string) => contentByPath[p] ?? "",
}));

const recordSkillLoaded = vi.fn();
const recordSkillInjected = vi.fn();
vi.mock("./skill-usage", () => ({
  recordSkillLoaded: (...args: unknown[]) => recordSkillLoaded(...args),
  recordSkillInjected: (...args: unknown[]) => recordSkillInjected(...args),
}));

vi.mock("./hermes/gateway-process", () => ({
  // Single deterministic profile key for the tests.
  profileKey: () => "default",
}));

vi.mock("./capability-risk-store", () => ({
  readCapabilityRiskRegistry: () => ({ reports: riskReports }),
}));

import {
  slugifySkill,
  loadActiveSkill,
  unloadActiveSkill,
  listActiveSkills,
  buildActiveSkillsSystemMessage,
  __resetActiveSkillsForTests,
} from "./active-skills";

beforeEach(() => {
  __resetActiveSkillsForTests();
  riskReports = installed.map((skill) => ({
    id: `skill:${skill.path}`,
    kind: "skill",
    name: skill.name,
    status: "safe",
    reviewState: "reviewed",
  }));
  recordSkillLoaded.mockClear();
  recordSkillInjected.mockClear();
  vi.restoreAllMocks();
});

describe("slugifySkill", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifySkill("Deep Research")).toBe("deep-research");
    expect(slugifySkill("  code-review ")).toBe("code-review");
    expect(slugifySkill("A/B Test!!")).toBe("a-b-test");
  });
});

describe("loadActiveSkill", () => {
  it("resolves by exact name", () => {
    const res = loadActiveSkill("code-review");
    expect(res.ok).toBe(true);
    expect(res.name).toBe("code-review");
    expect(res.path).toBe("/skills/dev/code-review");
    expect(res.alreadyLoaded).toBe(false);
    expect(recordSkillLoaded).toHaveBeenCalledWith(
      { name: "code-review", path: "/skills/dev/code-review" },
      undefined,
    );
  });

  it("resolves by slug (case/space-insensitive)", () => {
    const res = loadActiveSkill("deep research");
    expect(res.ok).toBe(true);
    expect(res.name).toBe("Deep Research");
  });

  it("flags a second load as alreadyLoaded", () => {
    loadActiveSkill("code-review");
    const again = loadActiveSkill("code-review");
    expect(again.ok).toBe(true);
    expect(again.alreadyLoaded).toBe(true);
    expect(listActiveSkills()).toHaveLength(1);
  });

  it("fails on an unknown skill", () => {
    const res = loadActiveSkill("does-not-exist");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("does-not-exist");
  });

  it("fails on empty input", () => {
    expect(loadActiveSkill("").ok).toBe(false);
  });

  it("requires Application Health review before loading", () => {
    riskReports = [];
    const res = loadActiveSkill("code-review");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("safety check");
  });
});

describe("unloadActiveSkill", () => {
  it("unloads one by name", () => {
    loadActiveSkill("code-review");
    loadActiveSkill("Deep Research");
    const res = unloadActiveSkill("code-review");
    expect(res.ok).toBe(true);
    expect(res.removed).toEqual(["code-review"]);
    expect(listActiveSkills().map((s) => s.name)).toEqual(["Deep Research"]);
  });

  it("unloads all when given undefined/all/*", () => {
    loadActiveSkill("code-review");
    loadActiveSkill("Deep Research");
    const res = unloadActiveSkill(undefined);
    expect(res.ok).toBe(true);
    expect(res.removed).toHaveLength(2);
    expect(listActiveSkills()).toHaveLength(0);
  });

  it("reports nothing removed for an unmatched name", () => {
    loadActiveSkill("code-review");
    const res = unloadActiveSkill("deep-research");
    expect(res.ok).toBe(false);
    expect(res.removed).toEqual([]);
  });
});

describe("buildActiveSkillsSystemMessage", () => {
  it("returns null when nothing is loaded", () => {
    expect(buildActiveSkillsSystemMessage()).toBeNull();
  });

  it("concatenates loaded skill bodies under a directive preamble", () => {
    loadActiveSkill("code-review");
    loadActiveSkill("Deep Research");
    const msg = buildActiveSkillsSystemMessage();
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe("system");
    expect(msg!.content).toContain("explicitly loaded");
    expect(msg!.content).toContain("## Skill: code-review");
    expect(msg!.content).toContain("Be adversarial.");
    expect(msg!.content).toContain("## Skill: Deep Research");
    expect(msg!.content).toContain("Fan out and verify.");
    expect(recordSkillInjected).toHaveBeenCalledWith(
      [
        { name: "code-review", path: "/skills/dev/code-review" },
        { name: "Deep Research", path: "/skills/research/deep-research" },
      ],
      undefined,
    );
  });

  it("skips skills whose content is unreadable (moved/deleted)", () => {
    contentByPath["/skills/dev/code-review"] = ""; // simulate missing file
    loadActiveSkill("code-review");
    expect(buildActiveSkillsSystemMessage()).toBeNull();
    expect(recordSkillInjected).not.toHaveBeenCalled();
    contentByPath["/skills/dev/code-review"] = "# Code Review\nBe adversarial.";
  });

  it("warns past the soft cap but still injects", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = "x".repeat(13_000);
    contentByPath["/skills/dev/code-review"] = big;
    loadActiveSkill("code-review");
    const msg = buildActiveSkillsSystemMessage();
    expect(msg!.content).toContain(big);
    expect(warn).toHaveBeenCalledOnce();
    contentByPath["/skills/dev/code-review"] = "# Code Review\nBe adversarial.";
  });
});
