import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutinesStatusReport } from "../../../../../shared/routines-status";
import { RoutinesStatusPanel } from "./RoutinesStatusPanel";

function report(
  patch: Partial<RoutinesStatusReport> = {},
): RoutinesStatusReport {
  return {
    generatedAt: "2026-07-07T00:00:00.000Z",
    status: "healthy",
    scheduler: { skipCount: 0, lastSkipAt: null, lastReason: null },
    updateRoutines: [
      {
        id: "desktop-update",
        label: "Desktop updates",
        enabled: true,
        lastStatus: "ok",
        lastCheckedAt: "2026-07-07T00:00:00.000Z",
        lastError: null,
      },
      {
        id: "hermes-agent-update",
        label: "Hermes Agent updates",
        enabled: true,
        lastStatus: "ok",
        lastCheckedAt: "2026-07-07T00:00:00.000Z",
        lastError: null,
      },
    ],
    ownerRoutineJobs: [
      {
        id: "job1",
        name: "owner-routine:morning-brief",
        schedule: "0 7 * * *",
        state: "active",
        enabled: true,
        nextRunAt: "2026-07-08T07:00:00.000Z",
        lastRunAt: "2026-07-07T07:00:00.000Z",
        lastStatus: "ok",
        lastError: null,
        deliver: ["local"],
      },
    ],
    closedAppGateway: {
      status: "healthy",
      message: "ok",
      lastCheckedAt: "2026-07-07T00:00:00.000Z",
      lastRestartAt: null,
      lastOutageMs: 0,
      lastError: null,
    },
    ownerDelivery: {
      status: "not-configured",
      summary: "Owner delivery preferences are not configured yet.",
      lastDeliveredAt: null,
      lastError: null,
    },
    ...patch,
  };
}

describe("RoutinesStatusPanel", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getRoutinesStatus: vi.fn().mockResolvedValue(report()),
      },
    });
  });

  afterEach(() => {
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("renders a healthy read-only routines summary", async () => {
    render(<RoutinesStatusPanel pendingApprovals={0} />);

    expect(await screen.findByText("Routines status")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Scheduler skips")).toBeInTheDocument();
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("renders warning state for skips and pending approvals", async () => {
    vi.mocked(window.hermesAPI.getRoutinesStatus).mockResolvedValueOnce(
      report({
        status: "warning",
        scheduler: {
          skipCount: 2,
          lastSkipAt: Date.UTC(2026, 6, 7),
          lastReason: "lock held",
        },
      }),
    );

    render(<RoutinesStatusPanel pendingApprovals={1} />);

    expect(await screen.findByText("Attention")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/lock held/)).toBeInTheDocument();
  });

  it("renders failure state for routine errors", async () => {
    vi.mocked(window.hermesAPI.getRoutinesStatus).mockResolvedValueOnce(
      report({
        status: "failure",
        updateRoutines: [
          {
            id: "desktop-update",
            label: "Desktop updates",
            enabled: true,
            lastStatus: "failed",
            lastCheckedAt: "2026-07-07T00:00:00.000Z",
            lastError: "download failed",
          },
        ],
      }),
    );

    render(<RoutinesStatusPanel />);

    expect(await screen.findByText("Failure")).toBeInTheDocument();
    expect(screen.getByText("download failed")).toBeInTheDocument();
  });

  it("renders the last owner delivery result", async () => {
    vi.mocked(window.hermesAPI.getRoutinesStatus).mockResolvedValueOnce(
      report({
        status: "warning",
        ownerDelivery: {
          status: "warning",
          summary: "Skipped owner delivery: quiet-hours.",
          lastDeliveredAt: "2026-07-07T07:00:00.000Z",
          lastError: null,
        },
      }),
    );

    render(<RoutinesStatusPanel />);

    expect(await screen.findByText("Attention")).toBeInTheDocument();
    expect(
      screen.getByText("Skipped owner delivery: quiet-hours."),
    ).toBeInTheDocument();
  });
});
