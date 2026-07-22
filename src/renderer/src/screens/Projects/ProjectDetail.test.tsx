import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectDetail from "./ProjectDetail";

const project = {
  id: "project.hcc",
  name: "HCC OS",
  status: "active",
  purpose: "Operate life through canonical projects and domains.",
  strategic_relevance: "critical",
  momentum_score: 72,
  clarity_score: 81,
  risk_score: 35,
  dependency_health: "healthy",
  review_cadence: "weekly",
  milestones: ["War Room grounded"],
  blockers: [],
  outputs: ["Native shell"],
  linked_domains: [{ id: "domain.work", name: "Work", health_score: 78, neglect_risk: "medium" }],
  linked_gateways: [{ id: "coding-gateway", displayName: "Coding Gateway", status: "active" }],
  linked_tools: [{ id: "tool.review", label: "Review generator" }],
  references: [{ id: "ref.master", title: "HCC Master Plan", summary: "Canonical product thesis." }],
  memory_capsules: [{ id: "mem.1", kind: "decision", summary: "Projects are primary execution objects.", body: "", scope_type: "project", domain_ids: [], project_ids: ["project.hcc"], gateway_ids: [], tool_ids: [], importance: "high", confidence: "high", freshness: "fresh", sensitivity: "local", promotion_state: "promoted", source_type: "manual", contradiction_state: "none" }],
};

const genome = {
  projectId: "project.hcc", currentVersion: 1, contentHash: "abc123456789abcdef", source: "project_baseline",
  genome: {
    purpose: project.purpose, strategicThesis: "HCC becomes a verified operating system.", definitionOfDone: "Native loop verified end to end.",
    principles: ["Evidence before claims"], nonNegotiables: ["No silent mutation"], successMetrics: ["Full green tests"],
    constraints: ["Local-first"], riskBoundaries: ["Human approval"], preferredPatterns: [], rejectedPatterns: [], referenceIds: ["ref.master"],
    decisionRecords: [], skillGrowth: {}, executionHeuristics: ["Working code first"], verifiedOutcomes: [], failureLessons: [],
  },
  versions: [{ version: 1, contentHash: "abc123456789abcdef", source: "project_baseline", actor: "system", createdAt: 1, genome: {} }],
  proposals: [], alignments: [], latestAlignment: null,
  summary: { versionCount: 1, pendingProposals: 0, alignmentCount: 0 },
};

describe("ProjectDetail", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getHccProjectDetail: vi.fn().mockResolvedValue(project),
        getHccProjectGenome: vi.fn().mockResolvedValue(genome),
        stageHccProjectGenomeProposal: vi.fn().mockResolvedValue({ status: "pending_approval" }),
        decideHccProjectGenomeProposal: vi.fn(),
        rollbackHccProjectGenome: vi.fn(),
        transitionHccProject: vi.fn(),
      } as unknown as typeof window.hermesAPI,
    });
  });

  it("renders canonical project relationships instead of raw ids", async () => {
    render(<ProjectDetail projectId="project.hcc" />);

    expect(await screen.findByText("HCC OS")).toBeInTheDocument();
    expect(screen.getByText("Execution context")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Coding Gateway")).toBeInTheDocument();
    expect(screen.getByText("Review generator")).toBeInTheDocument();
    expect(screen.getByText("HCC Master Plan")).toBeInTheDocument();
    expect(screen.getByText("Projects are primary execution objects.")).toBeInTheDocument();
    expect(screen.getByText(/Version 1/)).toBeInTheDocument();
    expect(screen.getByText("HCC becomes a verified operating system.")).toBeInTheDocument();
    expect(screen.getByText("Evidence before claims")).toBeInTheDocument();
    expect(screen.getByText("No explicit alignment evidence")).toBeInTheDocument();
  });

  it("stages genome mutation without applying it", async () => {
    render(<ProjectDetail projectId="project.hcc" />);
    await screen.findByText(/Version 1/);
    fireEvent.change(screen.getByLabelText("Genome strategic thesis"), { target: { value: "Verified HCC compounds operator advantage." } });
    fireEvent.change(screen.getByLabelText("Genome principles"), { target: { value: "Working code first\nNative parity" } });
    fireEvent.change(screen.getByLabelText("Genome evidence rationale"), { target: { value: "Dogfood evidence supports a stronger contract." } });
    fireEvent.click(screen.getByRole("button", { name: "Stage mutation · no apply" }));
    await waitFor(() => expect(window.hermesAPI.stageHccProjectGenomeProposal).toHaveBeenCalledWith("project.hcc", expect.objectContaining({
      baseVersion: 1,
      patch: expect.objectContaining({ strategicThesis: "Verified HCC compounds operator advantage.", principles: ["Working code first", "Native parity"] }),
    })));
    expect(await screen.findByText(/Current version remains unchanged/)).toBeInTheDocument();
  });
});
