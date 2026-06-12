import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../you/MemoryTimeline", () => ({
  MemoryTimeline: () => <div>Learned memory timeline</div>,
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
    { name: "Daily Brief", category: "custom", description: "Brief", path: "/s/daily" },
  ]);
  api.listDisabledSkills.mockResolvedValue([
    { name: "Old Skill", category: "custom", description: "Old", path: "/s/old" },
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
  api.restoreArchivedSkill.mockResolvedValue({ success: true, output: "restored" });
  api.pinSkill.mockResolvedValue({ success: true, output: "pinned" });
  api.unpinSkill.mockResolvedValue({ success: true, output: "unpinned" });
  api.runCuratorNow.mockResolvedValue({ success: true, output: "ran" });
  api.pauseCurator.mockResolvedValue({ success: true, output: "paused" });
  api.resumeCurator.mockResolvedValue({ success: true, output: "resumed" });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("LearningSurface", () => {
  it("renders memories, skills, and curator tabs with pending memory proposals", async () => {
    render(<LearningSurface profile="default" />);

    expect(await screen.findByText("Learn This")).toBeInTheDocument();
    expect(screen.getByText("Memories")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Curator")).toBeInTheDocument();
    expect(await screen.findByText("Prefers terse answers.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Accept"));
    await waitFor(() =>
      expect(api.acceptLearningProposal).toHaveBeenCalledWith("m1", "default"),
    );
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
