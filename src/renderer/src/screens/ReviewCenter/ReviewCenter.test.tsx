import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewCenter from "./ReviewCenter";

const review = {
  hero: { title: "Review Center", subtitle: "Turn signals into deliberate corrections." },
  reviewItems: [{ id: "review.domain.health", scope_type: "domain", scope_id: "domain.health", label: "Health", review_cadence: "weekly", urgency: "high", health_score: 55, base_risk: 45, propagated_risk: 70, dependency_count: 2, dependency_priority: 70, prompts: ["What changed since the last review?", "Which open loop creates the most drag?"] }],
  interventions: [],
  memoryPacket: { packet_type: "review", summary: { count: 0, availableMatches: 0, elapsedMs: 1 }, items: [] },
  summary: { total: 1, highUrgency: 1, domainReviews: 1, projectReviews: 0, interventions: 0, graphEdgeCount: 2, elevatedDependencyRisk: 1 },
};

describe("ReviewCenter", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getHccReviewCenter: vi.fn().mockResolvedValue(review),
        getHccGovernanceProposals: vi.fn().mockResolvedValue({ items: [] }),
        stageHccReviewIntervention: vi.fn(),
        actOnHccGovernanceProposal: vi.fn(),
      } as unknown as typeof window.hermesAPI,
    });
  });

  it("shows corrective review prompts before governed intervention", async () => {
    render(<ReviewCenter onOpenProject={vi.fn()} onOpenDomain={vi.fn()} onOpenMemory={vi.fn()} />);
    expect(await screen.findByText("Review Center")).toBeInTheDocument();
    expect(screen.getByText("What changed since the last review?")).toBeInTheDocument();
    expect(screen.getByText("Which open loop creates the most drag?")).toBeInTheDocument();
    expect(screen.getByText("No intervention proposals staged.")).toBeInTheDocument();
  });
});
