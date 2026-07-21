import { render, screen } from "@testing-library/react";
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

describe("ProjectDetail", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getHccProjectDetail: vi.fn().mockResolvedValue(project),
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
  });
});
