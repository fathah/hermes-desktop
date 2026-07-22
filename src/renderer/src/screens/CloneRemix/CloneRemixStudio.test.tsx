import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CloneRemixStudio from "./CloneRemixStudio";

const clone = {
  id: "clone-test",
  app_name: "Operator Remix",
  source_url: "https://example.com",
  source_name: "Example",
  parity_pct: 82,
  status: "materialized",
  category: "productivity",
  intelligence: {
    mode: "remix",
    intent: "calm operator shell",
    sourceAnalysis: {
      contentHash: "abc1234567890",
      structure: { sections: 4, navigation: 1, forms: 1, interactiveElements: 8 },
      visualTokens: { colors: ["#112233"], fonts: ["Inter"] },
    },
    tasteProfile: { liked: [{ sentiment: "liked", dimension: "layout", signal: "clear hierarchy" }], disliked: [], total: 1 },
    projectId: "PRJ-clone",
    referenceId: "ref.clone.clone-test",
    derivedTaskIds: ["task-1", "task-2", "task-3", "task-4"],
    materializedArtifact: { directory: "/tmp/clone-test", files: ["manifest.json"] },
  },
};

describe("CloneRemixStudio", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getHccClonedApps: vi.fn().mockResolvedValue({ items: [clone] }),
        createHccClonedApp: vi.fn(),
        compareHccClonedApp: vi.fn(),
        materializeHccClonedApp: vi.fn(),
        recordHccCloneTaste: vi.fn(),
        linkHccCloneProject: vi.fn(),
        finalizeHccCloneLearning: vi.fn(),
      } as unknown as typeof window.hermesAPI,
    });
  });

  it("renders evidence, taste, project linkage, and compound workflow", async () => {
    render(<CloneRemixStudio />);

    expect(await screen.findByText("Clone & Remix Studio")).toBeInTheDocument();
    expect(screen.getByText("Evidence workflow · Operator Remix")).toBeInTheDocument();
    expect(screen.getByText("Reference evidence")).toBeInTheDocument();
    expect(screen.getByText("Taste decisions")).toBeInTheDocument();
    expect(screen.getByText("clear hierarchy")).toBeInTheDocument();
    expect(screen.getByText("Project: PRJ-clone")).toBeInTheDocument();
    expect(screen.getByText("Derived tasks: 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7. Compound lessons" })).toBeInTheDocument();
  });

  it("records explicit liked and disliked taste decisions", async () => {
    render(<CloneRemixStudio />);
    await screen.findByText("Evidence workflow · Operator Remix");
    fireEvent.change(screen.getByLabelText("Liked taste signal"), { target: { value: "fast visual scan" } });
    fireEvent.change(screen.getByLabelText("Disliked taste signal"), { target: { value: "hidden navigation" } });
    fireEvent.click(screen.getByRole("button", { name: "3. Save taste" }));

    await waitFor(() => expect(window.hermesAPI.recordHccCloneTaste).toHaveBeenCalledWith(
      "clone-test",
      expect.arrayContaining([
        expect.objectContaining({ sentiment: "liked", signal: "fast visual scan" }),
        expect.objectContaining({ sentiment: "disliked", signal: "hidden navigation" }),
      ]),
    ));
  });
});
