import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorReadinessReport } from "../../../../../shared/operator-readiness";

const store = vi.hoisted(() => ({
  cockpit: [],
  reorderCockpit: vi.fn(),
  setCockpitSpan: vi.fn(),
  removeCockpitWidget: vi.fn(),
  addCockpitWidget: vi.fn(),
  resetCockpit: vi.fn(),
  setSurface: vi.fn(),
  setScheduledOpen: vi.fn(),
}));

const openSettings = vi.hoisted(() => vi.fn());

vi.mock("../store", () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("../../../lib/openSettings", () => ({ openSettings }));

function readinessReport(): OperatorReadinessReport {
  return {
    profile: "default",
    status: "blocked",
    headline: "Blocked before serious use",
    summary: "1 blocked, 1 need attention, 0 ready.",
    generatedAt: 1,
    items: [
      {
        id: "ai",
        title: "AI setup",
        status: "blocked",
        summary: "Anthropic API key is missing.",
        action: {
          label: "Open AI Setup",
          target: { kind: "settings", view: "aiSetup" },
        },
      },
      {
        id: "review",
        title: "Review queue",
        status: "attention",
        summary: "1 pending vault proposal needs review.",
        action: {
          label: "Open Review Queue",
          target: { kind: "surface", surface: "review" },
        },
      },
    ],
  };
}

import { CockpitSurface } from "./CockpitSurface";

describe("CockpitSurface operator readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getOperatorReadiness: vi.fn().mockResolvedValue(readinessReport()),
      },
    });
  });

  afterEach(() => {
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("shows readiness and routes fix actions from the cockpit", async () => {
    render(<CockpitSurface />);

    expect(
      await screen.findByText("Blocked before serious use"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open AI Setup" }));
    expect(openSettings).toHaveBeenCalledWith("aiSetup");

    fireEvent.click(
      screen.getByRole("button", { name: "Open Review Queue" }),
    );
    expect(store.setSurface).toHaveBeenCalledWith("review");
  });
});
