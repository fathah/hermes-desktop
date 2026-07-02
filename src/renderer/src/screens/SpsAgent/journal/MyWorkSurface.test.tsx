import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorReadinessReport } from "../../../../../shared/operator-readiness";

const store = vi.hoisted(() => ({
  journalDate: "2026-06-30",
  setJournalDate: vi.fn(),
  createJournalEntry: vi.fn(),
  setSurface: vi.fn(),
  setScheduledOpen: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("./JournalCalendar", () => ({
  JournalCalendar: () => <div>Journal calendar</div>,
}));

vi.mock("./DayTimeline", () => ({
  DayTimeline: () => <div>Day timeline</div>,
}));

vi.mock("./useJournalEntries", () => ({
  useJournalEntries: () => [],
  groupByDate: () => ({}),
}));

vi.mock("../cockpit/CockpitSurface", () => ({
  QuickActions: () => <div>Quick actions</div>,
  Glance: () => <div>At a glance</div>,
  PinnedNotes: () => <div>Pinned notes</div>,
  AgentStatus: () => <div>Assistant status</div>,
}));

vi.mock("../activeWork/ActiveWorkSurface", () => ({
  ActiveWorkSurface: () => <div>Active work</div>,
}));

vi.mock("../review/ReviewQueueSurface", () => ({
  ReviewQueueSurface: () => <div>Review queue</div>,
}));

function readinessReport(): OperatorReadinessReport {
  return {
    profile: "default",
    status: "attention",
    headline: "Ready with follow-up work",
    summary: "0 blocked, 1 need attention, 0 ready.",
    generatedAt: 1,
    items: [
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
    ],
  };
}

import { MyWorkSurface } from "./MyWorkSurface";

describe("MyWorkSurface operator readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getOperatorReadiness: vi.fn().mockResolvedValue(readinessReport()),
        srList: vi.fn().mockResolvedValue([]),
        listCronJobs: vi.fn().mockResolvedValue([]),
      },
    });
  });

  afterEach(() => {
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("shows readiness on the Work surface and opens Scheduled from the panel", async () => {
    render(<MyWorkSurface />);

    expect(
      await screen.findByText("Ready with follow-up work"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Scheduled" }));

    expect(store.setScheduledOpen).toHaveBeenCalledWith(true);
  });

  it("uses Scheduled vocabulary on the scheduled tab", async () => {
    const api = window.hermesAPI as unknown as {
      srList: ReturnType<typeof vi.fn>;
      listCronJobs: ReturnType<typeof vi.fn>;
    };
    api.srList.mockResolvedValue([
      {
        id: "sr_1",
        kind: "research",
        topic: "AI agent launches",
        pageId: "ai-agent-launches",
        cadence: "weekly",
        hour: 8,
        autoApply: false,
        enabled: true,
        createdAt: 1,
        lastRunAt: 0,
        lastChangeHash: "",
      },
    ]);
    api.listCronJobs.mockResolvedValue([
      {
        id: "cron_1",
        name: "Smoke skipped job",
        schedule: "*/5 * * * *",
        prompt: "Run the smoke job.",
        state: "active",
        enabled: true,
        next_run_at: null,
        last_run_at: null,
        last_status: "skipped",
        last_error: null,
        repeat: null,
        deliver: [],
        skills: [],
        script: null,
      },
    ]);

    render(<MyWorkSurface />);
    fireEvent.click(screen.getByRole("tab", { name: "Scheduled" }));

    expect(
      await screen.findByText(
        "Topic monitors and agent jobs stay visible here. New output goes to review before it changes your workspace.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage scheduled items" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Topic monitor ·/)).toBeInTheDocument();
    expect(screen.getByText(/Agent job ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Signal Brief/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/background jobs/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Manage rules/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/scheduled rules/i)).not.toBeInTheDocument();
  });
});
