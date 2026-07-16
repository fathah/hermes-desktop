import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import IntelligenceFabric from "./IntelligenceFabric";

const payload = {
  schemaVersion: "hcc-intelligence-v1",
  operatorBrief: {
    severity: "warning",
    statusLine: "Operator attention required",
    topBlocker: "1 degraded retrieval run detected",
    summary: { openCommandCount: 1, degradedRetrievalCount: 1, cognitiveMapNodeCount: 4, cognitiveMapEdgeCount: 3, contextPressureCount: 1 },
    recommendations: [{ label: "Inspect retrieval", why: "Source omitted", priority: 100 }],
  },
  retrieval: {
    contextPackId: "hcc-os",
    degraded: true,
    summary: { elapsedMs: 12, tokenCount: 420 },
    policy: { activeReader: "coding-gateway", policyVersion: "allowlist-v1" },
    selectedUnits: [{ id: "unit-1" }],
    omittedUnits: [{ id: "unit-2", omitReason: "blocked_by_policy" }],
    routingDecisions: [
      { scopeId: "gateway.coding", selected: true, reason: "reader_match" },
      { scopeId: "gateway.sovereign", selected: false, reason: "blocked_by_policy" },
    ],
    sourceEvaluation: { grounded: true },
  },
  governance: {
    pendingProposals: [{ id: "proposal-1", title: "Raise token budget", rationale: "Repeated omissions" }],
    executions: [{ id: "execution-1", status: "staged" }],
  },
  executionTopology: {
    nodes: [{ id: "command:1", kind: "command", label: "retrieval.refresh", status: "running" }],
    edges: [{ id: "edge-1", source: "actor:operator", target: "command:1", relation: "requested" }],
  },
  cognitiveMap: { summary: { nodeCount: 4, edgeCount: 3 } },
  provenance: { sources: ["os_registry", "context_pack_runtime"], mutationPolicy: "recommendations_and_staging_are_human_governed" },
};

describe("IntelligenceFabric", () => {
  const getHccIntelligence = vi.fn();
  const decide = vi.fn();
  const apply = vi.fn();
  const verify = vi.fn();
  const rollback = vi.fn();

  beforeEach(() => {
    getHccIntelligence.mockReset().mockResolvedValue(payload);
    decide.mockReset().mockResolvedValue({ ok: true });
    apply.mockReset().mockResolvedValue({ ok: true });
    verify.mockReset().mockResolvedValue({ ok: true });
    rollback.mockReset().mockResolvedValue({ ok: true });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getHccIntelligence,
        decideHccRetrievalQualityProposal: decide,
        stageHccRetrievalPolicyExecution: vi.fn(),
        applyHccRetrievalPolicyExecution: apply,
        verifyHccRetrievalPolicyExecution: verify,
        rollbackHccRetrievalPolicyExecution: rollback,
      } as unknown as typeof window.hermesAPI,
    });
  });

  it("connects briefing, retrieval, governed policy, and execution flow", async () => {
    render(<IntelligenceFabric />);

    expect(await screen.findByText("Operator Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Operator attention required")).toBeInTheDocument();
    expect(screen.getByText("Inspect retrieval")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "retrieval" }));
    expect(screen.getByText("gateway.coding")).toBeInTheDocument();
    expect(screen.getByText(/blocked_by_policy/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "policy" }));
    expect(screen.getByText("Raise token budget")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("proposal-1", "approved"));

    fireEvent.click(screen.getByRole("button", { name: "flow" }));
    expect(screen.getByText("retrieval.refresh")).toBeInTheDocument();
    expect(screen.getByText("memory nodes")).toBeInTheDocument();
  });
});
