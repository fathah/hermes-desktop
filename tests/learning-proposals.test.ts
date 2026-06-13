import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const { TEST_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "learning-proposals-test-")),
  );
  return { TEST_HOME: path.join(base, "hermes") };
});

vi.mock("../src/main/utils", async () => {
  const actual =
    await vi.importActual<typeof import("../src/main/utils")>(
      "../src/main/utils",
    );
  return {
    ...actual,
    profileHome: () => TEST_HOME,
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_REPO: join(TEST_HOME, "hermes-agent"),
  HERMES_PYTHON: "/usr/bin/python3",
  hermesCliArgs: (a: string[]) => a,
  getEnhancedPath: () => "",
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
}));

import {
  acceptLearningProposal,
  createLearningProposal,
  listLearningProposals,
  rollbackLearningProposal,
} from "../src/main/learning-proposals";
import { readMemory } from "../src/main/memory";
import { listDisabledSkills, listInstalledSkills } from "../src/main/skills";

beforeEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

describe("learning proposal store", () => {
  it("returns an empty list when the sidecar does not exist", () => {
    expect(listLearningProposals()).toEqual([]);
  });

  it("creates and persists a pending memory proposal", () => {
    const created = createLearningProposal({
      kind: "memory",
      body: "Prefers terse answers.",
      reason: "User corrected a verbose reply.",
      source: { type: "session", id: "s1", title: "Style discussion" },
    });

    expect(created.ok).toBe(true);
    expect(created.proposal).toMatchObject({
      kind: "memory",
      status: "pending",
      body: "Prefers terse answers.",
      reason: "User corrected a verbose reply.",
    });
    expect(listLearningProposals()).toHaveLength(1);
  });

  it("accepts a memory proposal and can roll it back when unchanged", () => {
    const created = createLearningProposal({
      kind: "memory",
      body: "Tracks India PSU baskets.",
      source: { type: "manual" },
    });
    const id = created.proposal!.id;

    const accepted = acceptLearningProposal(id);
    expect(accepted.ok).toBe(true);
    expect(readMemory().memory.entries.map((e) => e.content)).toContain(
      "Tracks India PSU baskets.",
    );

    const rolledBack = rollbackLearningProposal(id);
    expect(rolledBack.ok).toBe(true);
    expect(readMemory().memory.entries.map((e) => e.content)).not.toContain(
      "Tracks India PSU baskets.",
    );
  });

  it("accepts a skill proposal and rollback disables the created skill", () => {
    const created = createLearningProposal({
      kind: "skill",
      draft: {
        name: "Daily Brief",
        description: "Prepare a short daily brief.",
        category: "custom",
        body: "# Daily Brief\n\nSummarize the day.",
      },
      source: { type: "manual" },
    });
    const id = created.proposal!.id;

    const accepted = acceptLearningProposal(id);
    expect(accepted.ok).toBe(true);
    expect(listInstalledSkills().map((s) => s.name)).toContain("Daily Brief");

    const rolledBack = rollbackLearningProposal(id);
    expect(rolledBack.ok).toBe(true);
    expect(listInstalledSkills().map((s) => s.name)).not.toContain(
      "Daily Brief",
    );
    expect(listDisabledSkills().map((s) => s.name)).toContain("Daily Brief");
    expect(
      existsSync(join(TEST_HOME, "skills-disabled", "custom", "daily-brief")),
    ).toBe(true);
  });
});
