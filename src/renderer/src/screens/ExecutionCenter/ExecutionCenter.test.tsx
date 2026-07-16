import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExecutionCenter from "./ExecutionCenter";

const execution = {
  id: "exec_1",
  kind: "handoff",
  action: "gateway.ask",
  sourceGateway: "coding-gateway",
  targetGateway: "project-builder-gateway",
  requestedBy: "operator",
  approvedBy: null,
  riskLevel: "low",
  requiresApproval: true,
  status: "pending_approval",
  transport: "hermes-runs-api",
  endpoint: "http://127.0.0.1:18653",
  remoteRunId: null,
  idempotencyKey: "hcc-test",
  attemptCount: 0,
  maxAttempts: 3,
  linkedCommandId: null,
  linkedHandoffId: "handoff_1",
  payload: { task: "Return a verified result" },
  result: null,
  error: null,
  createdAt: 1,
  updatedAt: 1,
  audit: [{ id: "a1", event_type: "execution.proposed", actor: "operator", note: "", payload: {}, created_at: 1 }],
  artifacts: [],
};

const executor = {
  gatewayId: "project-builder-gateway",
  displayName: "Project Builder Gateway",
  endpoint: "http://127.0.0.1:18653",
  transport: "hermes-runs-api",
  controlActions: ["gateway.ask"],
  available: true,
};

describe("ExecutionCenter", () => {
  const getHccExecutions = vi.fn();
  const getHccExecutors = vi.fn();
  const decideHccExecution = vi.fn();
  const createHccExecution = vi.fn();
  const refreshHccExecution = vi.fn();
  const retryHccExecution = vi.fn();
  const rollbackHccExecution = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getHccExecutions.mockResolvedValue({ items: [execution], count: 1, pendingApproval: 1, active: 0, failed: 0 });
    getHccExecutors.mockResolvedValue({ items: [executor], count: 1 });
    decideHccExecution.mockResolvedValue({ ...execution, status: "running" });
    createHccExecution.mockResolvedValue(execution);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { getHccExecutions, getHccExecutors, decideHccExecution, createHccExecution, refreshHccExecution, retryHccExecution, rollbackHccExecution } as unknown as typeof window.hermesAPI,
    });
  });

  it("renders pending approval and dispatches only after operator approval", async () => {
    render(<ExecutionCenter />);
    expect(await screen.findByText("Execution Center")).toBeInTheDocument();
    expect(screen.getAllByText("Return a verified result")).toHaveLength(2);
    expect(screen.getByText("awaiting approval")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Approve & dispatch" }).click();
    });
    await waitFor(() => expect(decideHccExecution).toHaveBeenCalledWith("exec_1", "approve", "desktop-operator", expect.stringContaining("approved")));
  });

  it("shows durable audit and artifact output for completed executions", async () => {
    getHccExecutions.mockResolvedValue({
      items: [{ ...execution, status: "succeeded", remoteRunId: "run_1", result: { output: "real artifact" }, artifacts: [{ id: "art_1", kind: "agent_output", name: "Gateway output", content: {}, created_at: 2 }] }],
      count: 1,
      pendingApproval: 0,
      active: 0,
      failed: 0,
    });
    render(<ExecutionCenter />);
    expect(await screen.findByText("real artifact")).toBeInTheDocument();
    expect(screen.getByText("Gateway output")).toBeInTheDocument();
    expect(screen.getByText("execution.proposed")).toBeInTheDocument();
  });
});
