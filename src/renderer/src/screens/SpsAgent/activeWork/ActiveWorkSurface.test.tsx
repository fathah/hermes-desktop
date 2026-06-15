import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActiveWorkSurface } from "./ActiveWorkSurface";

const store = vi.hoisted(() => ({
  selectPage: vi.fn(),
  setSurface: vi.fn(),
  runWork: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

function taskFixture() {
  return {
    id: "t_1",
    title: "Investigate import",
    body: "Find failure",
    assignee: "worker",
    status: "running",
    priority: 5,
    tenant: null,
    workspace_kind: "scratch",
    workspace_path: null,
    created_by: null,
    created_at: 1,
    started_at: 2,
    completed_at: null,
    result: null,
    skills: [],
    max_retries: null,
  };
}

beforeEach(() => {
  store.selectPage.mockClear();
  store.setSurface.mockClear();
  store.runWork.mockClear();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      spsListActiveWorkRuns: vi.fn().mockResolvedValue([]),
      spsCreateActiveWorkRun: vi.fn().mockResolvedValue({
        id: "work-1",
        source: "goal",
        status: "running",
        title: "Goal: Fix reports",
        goal: "Fix reports",
        criteria: [],
        artifacts: [],
        createdAt: 1,
        updatedAt: 1,
      }),
      spsUpdateActiveWorkRun: vi.fn().mockResolvedValue(null),
      kanbanListBoards: vi.fn().mockResolvedValue({ success: true, data: [] }),
      kanbanListTasks: vi.fn().mockResolvedValue({ success: true, data: [] }),
      kanbanGetTask: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({
        response: "Done",
        sessionId: "sess-1",
      }),
      abortChat: vi.fn().mockResolvedValue(undefined),
    },
  });
});

describe("ActiveWorkSurface", () => {
  it("starts a goal through /goal and records it as active work", async () => {
    render(<ActiveWorkSurface />);
    fireEvent.change(await screen.findByLabelText("Goal"), {
      target: { value: "Fix reports" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start goal" }));

    await waitFor(() => {
      expect(window.hermesAPI.sendMessage).toHaveBeenCalledWith(
        "/goal Fix reports",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        expect.stringMatching(/^goal-/),
      );
    });
    expect(window.hermesAPI.spsCreateActiveWorkRun).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "goal",
        goal: "Fix reports",
      }),
    );
  });

  it("loads task detail with runs and comments when a task is selected", async () => {
    window.hermesAPI.kanbanListTasks = vi.fn().mockResolvedValue({
      success: true,
      data: [taskFixture()],
    });
    window.hermesAPI.kanbanGetTask = vi.fn().mockResolvedValue({
      success: true,
      data: {
        task: taskFixture(),
        comments: [
          {
            id: 1,
            task_id: "t_1",
            author: "me",
            body: "Use v2 schema",
            created_at: 3,
          },
        ],
        events: [],
        parents: [],
        children: [],
        runs: [
          {
            id: 7,
            task_id: "t_1",
            profile: "worker",
            status: "running",
            outcome: null,
            summary: null,
            error: null,
            started_at: 10,
            ended_at: null,
            last_heartbeat_at: 20,
          },
        ],
        latest_summary: "Still investigating",
      },
    });

    render(<ActiveWorkSurface />);
    fireEvent.click(await screen.findByText("Investigate import"));
    expect(await screen.findByText("Use v2 schema")).toBeInTheDocument();
    expect(screen.getByText("Still investigating")).toBeInTheDocument();
    expect(screen.getByText(/Runs: 1/)).toBeInTheDocument();
  });
});
