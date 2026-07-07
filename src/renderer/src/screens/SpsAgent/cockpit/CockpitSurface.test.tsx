import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorReadinessReport } from "../../../../../shared/operator-readiness";
import type { RoutinesStatusReport } from "../../../../../shared/routines-status";
import type { ApprovalState } from "../../../lib/approval";
import type { CockpitWidget } from "../store/storeTypes";

const store = vi.hoisted(() => ({
  cockpit: [] as CockpitWidget[],
  reorderCockpit: vi.fn(),
  setCockpitSpan: vi.fn(),
  removeCockpitWidget: vi.fn(),
  addCockpitWidget: vi.fn(),
  resetCockpit: vi.fn(),
  setSurface: vi.fn(),
  setScheduledOpen: vi.fn(),
  setResearchOpen: vi.fn(),
  setTemplatesOpen: vi.fn(),
  setPaletteOpen: vi.fn(),
  setTweaksOpen: vi.fn(),
  workApprovals: { queue: [], safe: [] } as ApprovalState,
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

function routinesReport(): RoutinesStatusReport {
  return {
    generatedAt: "2026-07-07T00:00:00.000Z",
    status: "healthy",
    scheduler: {
      skipCount: 0,
      lastSkipAt: null,
      lastReason: null,
    },
    updateRoutines: [],
    ownerRoutineJobs: [],
    closedAppGateway: null,
    ownerDelivery: {
      status: "not-configured",
      summary: "No owner channels configured.",
      lastDeliveredAt: null,
      lastError: null,
    },
  };
}

describe("CockpitSurface operator readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.cockpit = [];
    store.workApprovals = { queue: [], safe: [] };
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getOperatorReadiness: vi.fn().mockResolvedValue(readinessReport()),
        getRoutinesStatus: vi.fn().mockResolvedValue(routinesReport()),
        getAppVersion: vi.fn().mockResolvedValue("0.5.4"),
        getHermesUpstreamWatchState: vi.fn().mockResolvedValue({
          availableUpdate: null,
        }),
        spsIndexQuery: vi.fn().mockResolvedValue([]),
        spsNagGet: vi.fn().mockResolvedValue(null),
        equityListAlerts: vi.fn().mockResolvedValue([]),
        onEquityAlert: vi.fn().mockReturnValue(() => {}),
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

    fireEvent.click(screen.getByRole("button", { name: "Open Review Queue" }));
    expect(store.setSurface).toHaveBeenCalledWith("review");
  });

  it("exposes operator widgets in the add-widget menu", async () => {
    render(<CockpitSurface />);

    fireEvent.click(screen.getByRole("button", { name: /add widget/i }));

    expect(screen.getByText("Overdue tasks & nags")).toBeInTheDocument();
    expect(screen.getByText("Inbox triage")).toBeInTheDocument();
    expect(screen.getByText("Engine & updates")).toBeInTheDocument();
    expect(screen.getByText("Equity alerts")).toBeInTheDocument();
  });

  it("renders operator widget empty states", async () => {
    store.cockpit = [
      { kind: "operatorTasks", span: 2 },
      { kind: "operatorInbox", span: 1 },
      { kind: "operatorBrief", span: 1 },
      { kind: "operatorApprovals", span: 1 },
      { kind: "equityAlerts", span: 1 },
    ];

    render(<CockpitSurface />);

    expect(
      await screen.findByText("No overdue tasks or active nags."),
    ).toBeInTheDocument();
    expect(screen.getByText("Inbox triage is clear.")).toBeInTheDocument();
    expect(
      screen.getByText("Morning brief job has not been created."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No pending workspace approvals."),
    ).toBeInTheDocument();
    expect(screen.getByText("No equity alerts yet.")).toBeInTheDocument();
  });

  it("renders operator widget error states", async () => {
    store.cockpit = [{ kind: "operatorTasks", span: 2 }];
    window.hermesAPI.spsIndexQuery = vi
      .fn()
      .mockRejectedValueOnce(new Error("Index down"));

    render(<CockpitSurface />);

    expect(await screen.findByText("Index down")).toBeInTheDocument();
  });
});
