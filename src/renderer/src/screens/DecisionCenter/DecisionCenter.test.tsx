import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DecisionCenter from "./DecisionCenter";

const decision = { id: "decision-1", title: "Choose architecture", question: "Which path?", status: "pending_decision", criteria: [{ id: "quality", label: "Quality", weight: 5 }], profileSnapshot: { values: ["craft"], principles: ["evidence"], hardConstraints: ["local-first"] }, recommendation: { recommendedOptionId: "complete", rationale: "Highest eligible evidence-adjusted score (92)", method: "weighted" }, selectedOptionId: null, decisionRecord: null, options: [{ id: "complete", label: "Complete slice", description: "", scores: { quality: 95 }, valueAlignment: { craft: 90 }, principleAlignment: { evidence: 100 }, violatedConstraints: [], evidence: [{ type: "test", id: "1" }], score: 92, eligible: true, constraintViolations: [], evidenceCount: 1, coverage: { criteria: ["quality"], values: ["craft"], principles: ["evidence"] } }, { id: "shallow", label: "UI only", description: "", scores: { quality: 30 }, valueAlignment: {}, principleAlignment: {}, violatedConstraints: ["local-first"], evidence: [], score: 22, eligible: false, constraintViolations: ["local-first"], evidenceCount: 0, coverage: { criteria: ["quality"], values: [], principles: [] } }], outcomes: [], events: [] };
const center = { items: [decision], total: 1, summary: { draft: 0, pendingDecision: 1, decided: 0, reviewed: 0 } };

describe("DecisionCenter", () => {
  beforeEach(() => Object.defineProperty(window, "hermesAPI", { configurable: true, value: { getHccDecisions: vi.fn().mockResolvedValue(center), createHccDecision: vi.fn(), evaluateHccDecision: vi.fn(), commitHccDecision: vi.fn(), recordHccDecisionOutcome: vi.fn() } as unknown as typeof window.hermesAPI }));

  it("renders recommendation, value coverage, and constraint violations", async () => {
    render(<DecisionCenter />);
    expect(await screen.findByText("Decision & Value Alignment")).toBeInTheDocument();
    expect(screen.getByText("Recommendation · complete")).toBeInTheDocument();
    expect(screen.getByText("score 92")).toBeInTheDocument();
    expect(screen.getByText("Violates: local-first")).toBeInTheDocument();
    expect(screen.getByText("Evidence 1 · coverage 1/1")).toBeInTheDocument();
  });

  it("requires rationale then commits a human decision", async () => {
    render(<DecisionCenter />); await screen.findByText("Choose architecture");
    fireEvent.change(screen.getByLabelText("Decision rationale decision-1"), { target: { value: "Best evidence-backed option." } });
    fireEvent.click(screen.getByRole("button", { name: "Commit this option" }));
    await waitFor(() => expect(window.hermesAPI.commitHccDecision).toHaveBeenCalledWith("decision-1", "complete", "Best evidence-backed option.", undefined));
  });
});
