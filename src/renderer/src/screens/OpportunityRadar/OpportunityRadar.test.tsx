import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunityRadar from "./OpportunityRadar";

const candidate = {
  id: "opportunity.test",
  category: "domain_recovery" as const,
  title: "Strengthen Work",
  summary: "Resolve high-value operating drag.",
  target: { type: "domain" as const, id: "domain.work" },
  sourceRefs: [{ type: "domain", id: "domain.work" }],
  evidence: [{ signal: "health_score", value: 55 }],
  strategicFit: 92,
  urgency: 78,
  confidence: 94,
  effort: 42,
  risk: 35,
  score: 68,
  recommendedAction: "Create bounded intervention.",
  whyNow: "Health drag compounds across active projects.",
  expectedUpside: "Recover focused execution capacity.",
  opportunityCost: "Delay preserves drag.",
  executionReadiness: 72,
  linkedDomainIds: ["domain.work"],
  linkedProjectIds: [],
  status: "new" as const,
};

const radar = {
  hero: { title: "Opportunity Radar", subtitle: "Evidence-backed leverage" },
  items: [candidate],
  summary: { total: 1, new: 1, captured: 0, proposed: 0, dismissedIncluded: 0, highConfidence: 1 },
  methodology: { version: "opportunity-engine-v2", formula: "transparent", sources: [], mutationPolicy: "proposal_only" as const },
};

const staged = {
  id: "opportunity-intervention.test",
  candidateId: candidate.id,
  mode: "convert_project" as const,
  status: "pending_approval" as const,
  actor: "test",
  plan: { requiresApproval: true, mutationPreview: "Create project and tasks.", rollbackHint: "No mutation before approval." },
  projectId: null,
  executionId: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("OpportunityRadar", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getHccOpportunities: vi.fn().mockResolvedValue(radar),
        actOnHccOpportunity: vi.fn(),
        stageHccOpportunityIntervention: vi.fn().mockResolvedValue(staged),
        approveHccOpportunityIntervention: vi.fn().mockResolvedValue({ ...staged, status: "approved", projectId: "PRJ-opportunity" }),
        recordHccOpportunityOutcome: vi.fn().mockResolvedValue({ status: "positive", lessonMemoryId: "mem-opportunity" }),
      } as unknown as typeof window.hermesAPI,
    });
  });

  it("renders why-now, upside, cost, readiness, and human-gated actions", async () => {
    render(<OpportunityRadar />);
    expect(await screen.findByText("Strengthen Work")).toBeInTheDocument();
    expect(screen.getByText("Health drag compounds across active projects.")).toBeInTheDocument();
    expect(screen.getByText("Recover focused execution capacity.")).toBeInTheDocument();
    expect(screen.getByText("Delay preserves drag.")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage execution" })).toBeInTheDocument();
  });

  it("stages then explicitly approves intervention", async () => {
    render(<OpportunityRadar />);
    await screen.findByText("Strengthen Work");
    fireEvent.click(screen.getByRole("button", { name: "Stage project" }));
    expect(await screen.findByText(/Intervention staged/)).toBeInTheDocument();
    expect(window.hermesAPI.stageHccOpportunityIntervention).toHaveBeenCalledWith(candidate.id, "convert_project", "", { projectName: candidate.title });
    fireEvent.click(screen.getByRole("button", { name: "Approve intervention" }));
    await waitFor(() => expect(window.hermesAPI.approveHccOpportunityIntervention).toHaveBeenCalledWith(staged.id));
  });
});
