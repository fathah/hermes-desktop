import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSkill: vi.fn(),
  listInstalledSkills: vi.fn(),
}));

vi.mock("../src/main/skills", () => ({
  createSkill: mocks.createSkill,
  listInstalledSkills: mocks.listInstalledSkills,
}));

import {
  OWNER_MOBILE_WORKSPACE_SKILL_CATEGORY,
  OWNER_MOBILE_WORKSPACE_SKILL_NAME,
  __resetOwnerMobileWorkspaceSkillForTests,
  buildOwnerMobileWorkspaceSkillBody,
  ensureOwnerMobileWorkspaceSkill,
} from "../src/main/mobile-workspace-skill";

describe("owner mobile workspace skill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetOwnerMobileWorkspaceSkillForTests();
    mocks.listInstalledSkills.mockReturnValue([]);
    mocks.createSkill.mockReturnValue({
      success: true,
      path: "/tmp/profile/skills/workspace/sps-workspace-mobile",
    });
  });

  it("builds a Telegram-ready skill body from the ontology source", () => {
    const body = buildOwnerMobileWorkspaceSkillBody(`# Ontology

- Task: status, due_date, assignee.
- Note: markdown page in the SPS vault.
`);

    expect(body).toContain("Source: docs/ONTOLOGY.md");
    expect(body).toContain("what's overdue?");
    expect(body).toContain("add this as a task");
    expect(body).toContain("approval-aware");
    expect(body).toContain(
      "Phone-created tasks are review-first SPS task captures with source: telegram/mobile, route: human by default",
    );
    expect(body).toContain("no context: include promotion");
    expect(body).toContain("- Task: status, due_date, assignee.");
  });

  it("creates the profile skill when it is missing", () => {
    const result = ensureOwnerMobileWorkspaceSkill("work");

    expect(result).toEqual({
      created: true,
      existing: false,
      path: "/tmp/profile/skills/workspace/sps-workspace-mobile",
    });
    expect(mocks.createSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        name: OWNER_MOBILE_WORKSPACE_SKILL_NAME,
        category: OWNER_MOBILE_WORKSPACE_SKILL_CATEGORY,
        body: expect.stringContaining("Common Phone Intents"),
        profile: "work",
      }),
    );
  });

  it("does not duplicate an existing profile skill", () => {
    mocks.listInstalledSkills.mockReturnValue([
      {
        name: OWNER_MOBILE_WORKSPACE_SKILL_NAME,
        category: OWNER_MOBILE_WORKSPACE_SKILL_CATEGORY,
        description: "",
        path: "/tmp/profile/skills/workspace/sps-workspace-mobile",
      },
    ]);

    const result = ensureOwnerMobileWorkspaceSkill("work");

    expect(result).toEqual({
      created: false,
      existing: true,
      path: "/tmp/profile/skills/workspace/sps-workspace-mobile",
    });
    expect(mocks.createSkill).not.toHaveBeenCalled();
  });
});
