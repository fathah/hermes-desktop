import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemoryCenter from "./MemoryCenter";

const capsule = {
  id: "mem.1", kind: "decision", summary: "Keep projects canonical.", body: "Backend owns project truth.",
  scope_type: "project", scope_id: "project.hcc", domain_ids: [], project_ids: ["project.hcc"], gateway_ids: [], tool_ids: [],
  importance: "high", confidence: "high", freshness: "fresh", sensitivity: "local", promotion_state: "promoted", source_type: "manual", contradiction_state: "none",
  linked_projects: [{ id: "project.hcc", name: "HCC OS", status: "active" }], linked_domains: [], linked_gateways: [], linked_tools: [],
};

describe("MemoryCenter", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getHccMemoryCapsules: vi.fn().mockResolvedValue({ items: [capsule], total: 1, scopeSummary: { project: 1 } }),
        getHccMemoryPacket: vi.fn().mockResolvedValue({ packet_type: "tiny", summary: { count: 1, availableMatches: 1, elapsedMs: 1 }, items: [capsule] }),
        getHccMemoryGovernance: vi.fn().mockResolvedValue({ items: [{ id: "case.1", capsuleId: "mem.1", issueType: "contradiction", status: "pending", evidence: [{ type: "fact", id: "counter" }] }], summary: { pending: 1, resolved: 0, contradictions: 1, stale: 0, sensitive: 0, neverPromote: 0 } }),
        decideHccMemoryGovernanceCase: vi.fn(),
      } as unknown as typeof window.hermesAPI,
    });
  });

  it("renders logical partitions and canonical linked labels", async () => {
    render(<MemoryCenter />);
    expect(await screen.findByText("Memory Center")).toBeInTheDocument();
    expect(screen.getByText("Logical scope distribution")).toBeInTheDocument();
    expect(screen.getByText("project 1")).toBeInTheDocument();
    expect(screen.getByText("HCC OS")).toBeInTheDocument();
    expect(screen.getByText("Memory governance queue")).toBeInTheDocument();
    expect(screen.getByText("contradiction · mem.1")).toBeInTheDocument();
  });
});
