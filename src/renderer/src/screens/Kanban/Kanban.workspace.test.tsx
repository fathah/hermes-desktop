import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stableT = (key: string): string => key;
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: stableT }),
}));
vi.mock("../../components/OrbLoader", () => ({
  OrbLoader: (): React.JSX.Element => <div data-testid="loader" />,
}));

import Kanban from "./Kanban";

let connectionChanged: () => void;
const unsubscribe = vi.fn();

function installApi(): void {
  unsubscribe.mockReset();
  window.localStorage.clear();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      kanbanListBoards: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            slug: "default",
            name: "Default",
            is_current: true,
            total: 0,
            counts: {},
          },
        ],
      }),
      kanbanListTasks: vi.fn().mockResolvedValue({ success: true, data: [] }),
      kanbanListClaw3dHqTasks: vi
        .fn()
        .mockResolvedValue({ success: false, error: "not available" }),
      kanbanCreateTask: vi
        .fn()
        .mockResolvedValue({ success: true, data: { id: "t1" } }),
      listProfiles: vi.fn().mockResolvedValue([]),
      selectFolder: vi.fn().mockResolvedValue("/Users/me/project"),
      kanbanCompleteTask: vi.fn().mockResolvedValue({ success: true }),
      onConnectionConfigChanged: vi.fn((listener: () => void) => {
        connectionChanged = listener;
        return unsubscribe;
      }),
    },
  });
}

async function openWorkspaceField(): Promise<void> {
  fireEvent.click(await screen.findByText("kanban.newTask"));
  fireEvent.change(await screen.findByLabelText("Workspace"), {
    target: { value: "dir" },
  });
}

describe("Kanban workspace folder", () => {
  beforeEach(installApi);

  it("local: picks a folder on this machine with Browse", async () => {
    render(<Kanban visible />);
    await openWorkspaceField();
    const input = screen.getByPlaceholderText(
      "kanban.workspaceNoFolder",
    ) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    fireEvent.click(screen.getByText("kanban.browse"));
    expect(window.hermesAPI.selectFolder).toHaveBeenCalled();
  });

  it("remote: the path is typed (it lives on the server) and Browse is not offered", async () => {
    render(<Kanban visible remoteMode />);
    await openWorkspaceField();
    const input = screen.getByPlaceholderText(
      "kanban.workspaceServerPath",
    ) as HTMLInputElement;
    expect(input.readOnly).toBe(false);
    expect(screen.queryByText("kanban.browse")).toBeNull();
    fireEvent.change(input, { target: { value: "/srv/app" } });
    expect(input.value).toBe("/srv/app");
    expect(window.hermesAPI.selectFolder).not.toHaveBeenCalled();
  });

  // @lat: [[kanban#Kanban board tab#Remote target lifecycle#SSH virtual board preference]]
  it("loads real remote tasks even when the saved SSH virtual board was HQ", async () => {
    window.localStorage.setItem("hermes:kanban:active-board", "__claw3d_hq__");
    render(<Kanban visible remoteMode />);
    await screen.findByText("kanban.newTask");
    expect(window.hermesAPI.kanbanListTasks).toHaveBeenCalled();
    expect(document.querySelector(".kanban-hq-banner")).toBeNull();
  });

  // @lat: [[kanban#Kanban board tab#Remote target lifecycle#Profile changes]]
  it("discards a late old-profile board before actions can use the new profile", async () => {
    let finishA!: (value: unknown) => void;
    const pendingA = new Promise((resolve) => (finishA = resolve));
    const task = (id: string): Record<string, unknown> => ({
      id,
      title: id,
      status: "ready",
      priority: 0,
      skills: [],
      created_at: null,
    });
    vi.mocked(window.hermesAPI.kanbanListTasks).mockImplementation(
      ({ profile } = {}) =>
        (profile === "A"
          ? pendingA
          : Promise.resolve({
              success: true,
              data: [task("task-B")],
            })) as ReturnType<typeof window.hermesAPI.kanbanListTasks>,
    );
    const { rerender } = render(<Kanban profile="A" visible remoteMode />);
    await waitFor(() =>
      expect(window.hermesAPI.kanbanListTasks).toHaveBeenCalled(),
    );
    rerender(<Kanban profile="B" visible remoteMode />);
    await screen.findByText("task-B", { selector: ".kanban-card-title" });
    await act(async () => {
      finishA({ success: true, data: [task("task-A")] });
      await pendingA;
    });
    expect(screen.queryByText("task-A")).toBeNull();
    fireEvent.click(screen.getByTitle("kanban.cardMarkDone"));
    await waitFor(() =>
      expect(window.hermesAPI.kanbanCompleteTask).toHaveBeenCalledWith(
        "task-B",
        undefined,
        "B",
      ),
    );
  });

  // @lat: [[kanban#Kanban board tab#Remote target lifecycle#Connection edits]]
  it("resets tasks and forms on an in-place connection edit and ignores its late reply", async () => {
    let finishOld!: (value: unknown) => void;
    const pendingOld = new Promise((resolve) => (finishOld = resolve));
    vi.mocked(window.hermesAPI.kanbanListTasks).mockImplementationOnce(
      () => pendingOld as ReturnType<typeof window.hermesAPI.kanbanListTasks>,
    );
    const { unmount } = render(<Kanban profile="work" visible remoteMode />);
    await waitFor(() =>
      expect(window.hermesAPI.kanbanListTasks).toHaveBeenCalledTimes(1),
    );
    act(() => connectionChanged());
    await screen.findByText("kanban.newTask");
    await act(async () => {
      finishOld({
        success: true,
        data: [{ id: "old-task", title: "old-target-task", skills: [] }],
      });
      await pendingOld;
    });
    expect(screen.queryByText("old-target-task")).toBeNull();
    await openWorkspaceField();
    fireEvent.change(
      screen.getByPlaceholderText("kanban.workspaceServerPath"),
      {
        target: { value: "/srv/old-target" },
      },
    );
    act(() => connectionChanged());
    await screen.findByText("kanban.newTask");
    expect(screen.queryByDisplayValue("/srv/old-target")).toBeNull();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
