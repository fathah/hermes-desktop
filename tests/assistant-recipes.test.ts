import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const { TEST_HOME, assistantSpy } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "assistant-recipes-test-")),
  );
  return {
    TEST_HOME: path.join(base, "hermes"),
    assistantSpy: vi.fn(async () => ({ kind: "chat", reply: ["ok"] })),
  };
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

vi.mock("../src/main/sps-agent", () => ({
  spsAssistant: assistantSpy,
}));

vi.mock("../src/main/cronjobs", () => ({
  createCronJob: vi.fn(async () => ({ success: true })),
  listCronJobs: vi.fn(async () => [{ id: "cron1", name: "assistant-recipe:" }]),
  pauseCronJob: vi.fn(async () => ({ success: true })),
  removeCronJob: vi.fn(async () => ({ success: true })),
  resumeCronJob: vi.fn(async () => ({ success: true })),
}));

import {
  createAssistantRecipe,
  listAssistantRecipeRuns,
  listAssistantRecipes,
  runAssistantRecipe,
  saveAssistantRecipeRun,
  updateAssistantRecipe,
} from "../src/main/assistant-recipes";

beforeEach(() => {
  assistantSpy.mockClear();
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

describe("assistant recipe store", () => {
  it("creates a recipe and a profile skill", async () => {
    const created = await createAssistantRecipe({
      name: "Article Agent",
      kind: "article-writer",
      description: "Drafts articles from a topic.",
      job: "Research, outline, draft, and review an article.",
      inputs: "Topic, audience, and tone.",
      output: "A polished article draft.",
      allowedActions: ["read_workspace", "search_web", "draft_content"],
    });

    expect(created.ok).toBe(true);
    expect(created.recipe).toMatchObject({
      name: "Article Agent",
      skillName: "assistant-article-agent",
      reviewMode: "review-first",
      enabled: true,
    });
    expect(listAssistantRecipes()).toHaveLength(1);

    const skillFile = join(
      TEST_HOME,
      "skills",
      "assistant-recipes",
      "assistant-article-agent",
      "SKILL.md",
    );
    expect(existsSync(skillFile)).toBe(true);
    const body = readFileSync(skillFile, "utf-8");
    expect(body).toContain("## Allowed actions");
    expect(body).toContain("Review-first");
  });

  it("updates recipe metadata without rewriting the skill", async () => {
    const created = await createAssistantRecipe({
      name: "Meeting Helper",
      kind: "meeting-debrief",
      job: "Summarize meeting notes.",
      inputs: "Raw meeting notes.",
      output: "Decisions and action items.",
      allowedActions: ["read_workspace", "draft_content"],
    });

    const updated = await updateAssistantRecipe(created.recipe!.id, {
      enabled: false,
      reviewMode: "auto-apply",
    });

    expect(updated.ok).toBe(true);
    expect(updated.recipe).toMatchObject({
      enabled: false,
      reviewMode: "auto-apply",
    });
  });

  it("keeps high-risk actions review-first", async () => {
    const created = await createAssistantRecipe({
      name: "File Helper",
      kind: "file-processor",
      job: "Process files.",
      inputs: "Files.",
      output: "Summaries.",
      allowedActions: ["process_files", "draft_content"],
      reviewMode: "auto-apply",
    });

    expect(created.ok).toBe(true);
    expect(created.recipe?.reviewMode).toBe("review-first");
  });

  it("rejects scheduled assistants that can send messages", async () => {
    const created = await createAssistantRecipe({
      name: "Messenger",
      kind: "research-brief",
      job: "Research and message.",
      inputs: "Topic.",
      output: "Message.",
      allowedActions: ["send_messages", "draft_content"],
      schedule: { enabled: true, cadence: "daily", hour: 8 },
    });

    expect(created).toEqual({
      ok: false,
      error: "Scheduled assistants cannot send messages.",
    });
  });

  it("stores safe schedule metadata for schedulable templates", async () => {
    const created = await createAssistantRecipe({
      name: "Morning Brief",
      kind: "morning-briefing",
      job: "Prepare a morning brief.",
      inputs: "Workspace notes.",
      output: "Daily brief.",
      allowedActions: ["read_workspace", "draft_content", "schedule_runs"],
      schedule: { enabled: true, cadence: "daily", hour: 8 },
    });

    expect(created.ok).toBe(true);
    expect(created.recipe?.schedule).toMatchObject({
      enabled: true,
      cadence: "daily",
      hour: 8,
    });
  });

  it("runs an enabled recipe through the SPS assistant path", async () => {
    const created = await createAssistantRecipe({
      name: "Researcher",
      kind: "research-brief",
      job: "Research a topic.",
      inputs: "A user topic.",
      output: "A short brief.",
      allowedActions: ["read_workspace", "search_web", "draft_content"],
    });

    const result = await runAssistantRecipe(
      created.recipe!.id,
      "AI agents for beginners",
    );

    expect(result.ok).toBe(true);
    expect(result.run).toMatchObject({
      recipeId: created.recipe!.id,
      recipeName: "Researcher",
      status: "success",
      resultText: "ok",
    });
    expect(result.prompt).toContain('Use the "assistant-researcher"');
    expect(assistantSpy).toHaveBeenCalledWith(
      expect.stringContaining("AI agents for beginners"),
      { pageTitle: "Researcher", blocks: [], notes: [] },
      undefined,
      true,
    );
    expect(listAssistantRecipes()[0].lastRunAt).toBeTruthy();
    expect(listAssistantRecipeRuns(created.recipe!.id)).toHaveLength(1);
  });

  it("records failed runs in history", async () => {
    assistantSpy.mockRejectedValueOnce(new Error("gateway down"));
    const created = await createAssistantRecipe({
      name: "Researcher",
      kind: "research-brief",
      job: "Research a topic.",
      inputs: "A user topic.",
      output: "A short brief.",
      allowedActions: ["read_workspace", "search_web", "draft_content"],
    });

    const result = await runAssistantRecipe(created.recipe!.id, "AI agents");

    expect(result.ok).toBe(false);
    expect(result.run).toMatchObject({
      recipeId: created.recipe!.id,
      status: "error",
      error: "gateway down",
    });
    expect(listAssistantRecipeRuns(created.recipe!.id)[0]).toMatchObject({
      status: "error",
    });
  });

  it("saves a successful run as a vault proposal and marks it saved", async () => {
    const created = await createAssistantRecipe({
      name: "Researcher",
      kind: "research-brief",
      job: "Research a topic.",
      inputs: "A user topic.",
      output: "A short brief.",
      allowedActions: ["read_workspace", "search_web", "draft_content"],
    });
    const result = await runAssistantRecipe(created.recipe!.id, "AI agents");

    const saved = await saveAssistantRecipeRun(result.run!.id);

    expect(saved.ok).toBe(true);
    expect(saved.proposalId).toMatch(/^vp_/);
    expect(saved.pageId).toMatch(/^assistant-results\/researcher-/);
    expect(listAssistantRecipeRuns(created.recipe!.id)[0]).toMatchObject({
      savedProposalId: saved.proposalId,
      savedPageId: saved.pageId,
    });
  });

  it("returns a clear error when saving a missing run", async () => {
    const saved = await saveAssistantRecipeRun("missing");

    expect(saved).toEqual({
      ok: false,
      error: "Assistant run not found.",
    });
  });
});
