import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../you/MemoryTimeline", () => ({
  MemoryTimeline: () => <div>Learned memory timeline</div>,
}));

const { setSurface } = vi.hoisted(() => ({ setSurface: vi.fn() }));

vi.mock("../store", () => ({
  useStore: (selector: (state: { setSurface: typeof setSurface }) => unknown) =>
    selector({ setSurface }),
}));

import { LearningSurface } from "./LearningSurface";

const api = {
  listLearningProposals: vi.fn(),
  acceptLearningProposal: vi.fn(),
  dismissLearningProposal: vi.fn(),
  rollbackLearningProposal: vi.fn(),
  createLearningProposal: vi.fn(),
  listInstalledSkills: vi.fn(),
  listDisabledSkills: vi.fn(),
  setSkillEnabled: vi.fn(),
  getSkillContent: vi.fn(),
  createSkill: vi.fn(),
  discoverLocalSkills: vi.fn(),
  importLocalSkill: vi.fn(),
  generateSkillFromRepo: vi.fn(),
  listSkillUsage: vi.fn(),
  getCuratorStatus: vi.fn(),
  runCuratorNow: vi.fn(),
  pauseCurator: vi.fn(),
  resumeCurator: vi.fn(),
  listArchivedSkills: vi.fn(),
  restoreArchivedSkill: vi.fn(),
  pinSkill: vi.fn(),
  unpinSkill: vi.fn(),
  spsListAssistantRecipes: vi.fn(),
  spsCreateAssistantRecipe: vi.fn(),
  spsUpdateAssistantRecipe: vi.fn(),
  spsDeleteAssistantRecipe: vi.fn(),
  spsRunAssistantRecipe: vi.fn(),
  spsListAssistantRecipeRuns: vi.fn(),
  spsSaveAssistantRecipeRun: vi.fn(),
  spsCreateVaultProposal: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
  api.listLearningProposals.mockResolvedValue([
    {
      id: "m1",
      kind: "memory",
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
      body: "Prefers terse answers.",
      reason: "The user corrected a long response.",
    },
  ]);
  api.acceptLearningProposal.mockResolvedValue({ ok: true });
  api.dismissLearningProposal.mockResolvedValue({ ok: true });
  api.rollbackLearningProposal.mockResolvedValue({ ok: true });
  api.createLearningProposal.mockResolvedValue({ ok: true });
  api.listInstalledSkills.mockResolvedValue([
    {
      name: "Daily Brief",
      category: "custom",
      description: "Brief",
      path: "/s/daily",
    },
  ]);
  api.listDisabledSkills.mockResolvedValue([
    {
      name: "Old Skill",
      category: "custom",
      description: "Old",
      path: "/s/old",
    },
  ]);
  api.setSkillEnabled.mockResolvedValue({ success: true });
  api.getSkillContent.mockResolvedValue("# Daily Brief\n\nDo the brief.");
  api.createSkill.mockResolvedValue({ success: true });
  api.discoverLocalSkills.mockResolvedValue([]);
  api.importLocalSkill.mockResolvedValue({ success: true });
  api.generateSkillFromRepo.mockResolvedValue({
    success: true,
    draft: {
      name: "repo-helper",
      description: "Helps in repo.",
      body: "# Repo Helper\n\nUse repo conventions.",
    },
  });
  api.listSkillUsage.mockResolvedValue({
    "/s/daily": {
      name: "Daily Brief",
      path: "/s/daily",
      loadCount: 2,
      injectedCount: 1,
      lastLoadedAt: 1,
      lastUsedAt: 1,
    },
  });
  api.getCuratorStatus.mockResolvedValue("Curator is running");
  api.listArchivedSkills.mockResolvedValue("old-skill\nunused-skill");
  api.restoreArchivedSkill.mockResolvedValue({
    success: true,
    output: "restored",
  });
  api.pinSkill.mockResolvedValue({ success: true, output: "pinned" });
  api.unpinSkill.mockResolvedValue({ success: true, output: "unpinned" });
  api.runCuratorNow.mockResolvedValue({ success: true, output: "ran" });
  api.pauseCurator.mockResolvedValue({ success: true, output: "paused" });
  api.resumeCurator.mockResolvedValue({ success: true, output: "resumed" });
  api.spsListAssistantRecipes.mockResolvedValue([
    {
      id: "r1",
      name: "Research brief",
      kind: "research-brief",
      description: "Research a topic.",
      job: "Research the topic.",
      inputs: "A topic.",
      output: "A briefing.",
      allowedActions: ["read_workspace", "search_web", "draft_content"],
      reviewMode: "review-first",
      skillName: "assistant-research-brief",
      skillPath: "/s/assistant-research-brief",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  api.spsListAssistantRecipeRuns.mockResolvedValue([
    {
      id: "run1",
      recipeId: "r1",
      recipeName: "Research brief",
      input: "Focus on risks.",
      resultText: "Brief finished.",
      status: "success",
      createdAt: 1,
      durationMs: 25,
      savedProposalId: "vp1",
      savedPageId: "assistant-results/research-brief-19700101000000",
      trigger: "manual",
    },
  ]);
  api.spsCreateAssistantRecipe.mockResolvedValue({
    ok: true,
    recipe: {
      id: "r2",
      name: "Article Agent",
      kind: "article-writer",
      description: "",
      job: "Draft articles.",
      inputs: "Topic.",
      output: "Article.",
      allowedActions: ["read_workspace", "draft_content"],
      reviewMode: "review-first",
      skillName: "assistant-article-agent",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    },
  });
  api.spsUpdateAssistantRecipe.mockResolvedValue({ ok: true });
  api.spsDeleteAssistantRecipe.mockResolvedValue({ ok: true });
  api.spsRunAssistantRecipe.mockResolvedValue({
    ok: true,
    run: {
      id: "run2",
      recipeId: "r1",
      recipeName: "Research brief",
      input: "",
      resultText: "Brief finished.",
      status: "success",
      createdAt: 2,
      durationMs: 30,
      trigger: "manual",
    },
    result: { kind: "chat", reply: ["Brief finished."] },
  });
  api.spsSaveAssistantRecipeRun.mockResolvedValue({
    ok: true,
    proposalId: "vp2",
    pageId: "assistant-results/research-brief-19700101000002",
  });
  api.spsCreateVaultProposal.mockResolvedValue({ id: "vp1" });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("LearningSurface", () => {
  it("renders memories, skills, and curator tabs with pending memory proposals", async () => {
    render(<LearningSurface profile="default" />);

    expect(await screen.findByText("Learn This")).toBeInTheDocument();
    expect(screen.getByText("Assistants")).toBeInTheDocument();
    expect(screen.getByText("Memories")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Curator")).toBeInTheDocument();
    expect(await screen.findByText("Build an Assistant")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Memories"));
    expect(
      await screen.findByText("Prefers terse answers."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Accept"));
    await waitFor(() =>
      expect(api.acceptLearningProposal).toHaveBeenCalledWith("m1", "default"),
    );
  });

  it("creates a saved assistant recipe from the form", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.change(await screen.findByLabelText("Assistant template"), {
      target: { value: "article-writer" },
    });
    fireEvent.change(screen.getByLabelText("Assistant name"), {
      target: { value: "Article Agent" },
    });
    fireEvent.change(screen.getByLabelText("Audience"), {
      target: { value: "Founders" },
    });
    fireEvent.change(screen.getByLabelText("Tone"), {
      target: { value: "Clear" },
    });
    fireEvent.change(screen.getByLabelText("Length"), {
      target: { value: "Short post" },
    });
    fireEvent.click(screen.getByText("Create assistant"));

    await waitFor(() =>
      expect(api.spsCreateAssistantRecipe).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Article Agent",
          kind: "article-writer",
          job: expect.stringContaining("Audience: Founders"),
          inputs: expect.stringContaining("Tone: Clear"),
          output: expect.stringContaining("Length: Short post"),
          reviewMode: "review-first",
        }),
        "default",
      ),
    );
  });

  it("runs a saved assistant recipe", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.click(await screen.findByText("Run"));

    await waitFor(() =>
      expect(api.spsRunAssistantRecipe).toHaveBeenCalledWith(
        "r1",
        "",
        "default",
      ),
    );
    expect(await screen.findByText("Brief finished.")).toBeInTheDocument();
  });

  it("queues the latest assistant result for vault review", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.change(await screen.findByLabelText("Assistant run input"), {
      target: { value: "Focus on risks." },
    });
    fireEvent.click(screen.getByText("Run"));
    fireEvent.click(await screen.findByText("Send to review"));

    await waitFor(() =>
      expect(api.spsSaveAssistantRecipeRun).toHaveBeenCalledWith(
        "run2",
        "default",
      ),
    );
    expect(setSurface).toHaveBeenCalledWith("review");
  });

  it("shows compact assistant run history", async () => {
    render(<LearningSurface profile="default" />);

    expect(await screen.findByText(/saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("View past runs"));
    expect(screen.getAllByText(/saved/).length).toBeGreaterThan(1);
  });

  it("creates a pending skill proposal from a repo draft", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.click(await screen.findByText("Skills"));
    fireEvent.change(screen.getByLabelText("Repository path"), {
      target: { value: "/tmp/repo" },
    });
    fireEvent.click(screen.getByText("Generate draft"));

    await waitFor(() =>
      expect(api.createLearningProposal).toHaveBeenCalledWith(
        {
          kind: "skill",
          draft: {
            name: "repo-helper",
            description: "Helps in repo.",
            category: "custom",
            body: "# Repo Helper\n\nUse repo conventions.",
          },
          source: { type: "repo", path: "/tmp/repo" },
        },
        "default",
      ),
    );
  });

  it("restores archived curator skills", async () => {
    render(<LearningSurface profile="default" />);

    fireEvent.click(await screen.findByText("Curator"));
    fireEvent.click(await screen.findByText("Restore old-skill"));

    await waitFor(() =>
      expect(api.restoreArchivedSkill).toHaveBeenCalledWith(
        "old-skill",
        "default",
      ),
    );
  });
});
