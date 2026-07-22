import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CaptureInbox from "./CaptureInbox";

const captured = {
  id: "inbox-1", title: "Task: verify offline merge", content: "Task: verify offline merge", status: "classified", tags: [], domainIds: [],
  classification: { targetType: "project_task", targetId: "PRJ-HCC-OS", confidence: .88, method: "deterministic_rules", evidence: [{ signal: "task_intent", value: "matched" }] },
  provenance: { sourceType: "text", capturedBy: "test", capturedAt: 1 }, route: null,
  events: [{ id: "event-1", eventType: "capture.created", actor: "test", createdAt: 1 }],
};
const center = { items: [captured], total: 1, summary: { classified: 1, pendingApproval: 0, applied: 0, rejected: 0, ambiguous: 0 } };

describe("CaptureInbox", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", { configurable: true, value: {
      getHccCaptures: vi.fn().mockResolvedValue(center), createHccCapture: vi.fn().mockResolvedValue(captured),
      stageHccCapture: vi.fn().mockResolvedValue({ id: "route-1", status: "pending_approval" }), decideHccCaptureRoute: vi.fn(),
    } as unknown as typeof window.hermesAPI });
  });

  it("renders deterministic classification evidence and mutation-free staging", async () => {
    render(<CaptureInbox />);
    expect(await screen.findByText("Capture Inbox")).toBeInTheDocument();
    expect(screen.getByText("88% · deterministic_rules")).toBeInTheDocument();
    expect(screen.getByText("task_intent: \"matched\"")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stage route · no apply" }));
    await waitFor(() => expect(window.hermesAPI.stageHccCapture).toHaveBeenCalledWith("inbox-1"));
    expect(window.hermesAPI.decideHccCaptureRoute).not.toHaveBeenCalled();
  });

  it("captures raw input with explicit source and target", async () => {
    render(<CaptureInbox />);
    await screen.findByText("Capture Inbox");
    fireEvent.change(screen.getByLabelText("Capture content"), { target: { value: "Decision: protect local data" } });
    fireEvent.change(screen.getByLabelText("Capture source type"), { target: { value: "voice" } });
    fireEvent.change(screen.getByLabelText("Capture explicit target"), { target: { value: "memory_capsule" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture and classify" }));
    await waitFor(() => expect(window.hermesAPI.createHccCapture).toHaveBeenCalledWith(expect.objectContaining({ content: "Decision: protect local data", sourceType: "voice", intendedTarget: "memory_capsule" })));
  });
});
