import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stableT = (key: string): string => key;
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: stableT }),
}));
vi.mock("../../components/OrbLoader", () => ({
  OrbLoader: (): React.JSX.Element => <div data-testid="loader" />,
}));

import Kanban from "./Kanban";

function installApi(): void {
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
});
