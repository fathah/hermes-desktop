import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorReadinessPanel } from "./OperatorReadinessPanel";
import type {
  OperatorReadinessAction,
  OperatorReadinessReport,
} from "../../../shared/operator-readiness";

function report(): OperatorReadinessReport {
  return {
    profile: "default",
    status: "attention",
    headline: "Ready with follow-up work",
    summary: "0 blocked, 2 need attention, 1 ready.",
    generatedAt: 1,
    items: [
      {
        id: "review",
        title: "Review queue",
        status: "attention",
        summary: "2 pending vault proposals need review.",
        action: {
          label: "Open Review Queue",
          target: { kind: "surface", surface: "review" },
        },
      },
      {
        id: "scheduler",
        title: "Scheduler",
        status: "attention",
        summary: "1 scheduled job skip recorded.",
        action: {
          label: "Open Scheduled",
          target: { kind: "modal", modal: "scheduled" },
        },
      },
      {
        id: "ai",
        title: "AI setup",
        status: "ready",
        summary: "Chat is configured and ready.",
        action: {
          label: "Open AI Setup",
          target: { kind: "settings", view: "aiSetup" },
        },
      },
    ],
  };
}

describe("OperatorReadinessPanel", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getOperatorReadiness: vi.fn().mockResolvedValue(report()),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("loads and renders the operator readiness report", async () => {
    render(<OperatorReadinessPanel profile="default" onAction={vi.fn()} />);

    expect(screen.getByText("Checking readiness...")).toBeInTheDocument();
    expect(
      await screen.findByText("Ready with follow-up work"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 pending vault proposals need review."),
    ).toBeInTheDocument();
    expect(window.hermesAPI.getOperatorReadiness).toHaveBeenCalledWith(
      "default",
    );
  });

  it("emits the selected target action for the host surface to route", async () => {
    const onAction = vi.fn<(action: OperatorReadinessAction) => void>();
    render(<OperatorReadinessPanel profile="default" onAction={onAction} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Review Queue" }),
    );

    expect(onAction).toHaveBeenCalledWith({
      label: "Open Review Queue",
      target: { kind: "surface", surface: "review" },
    });
  });
});
