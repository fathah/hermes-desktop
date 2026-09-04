import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeAgent } from "./office3d/core/types";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock("./office3d/Office3D", () => ({
  default: ({ agents }: { agents: OfficeAgent[] }) => (
    <div data-testid="office-agents">
      {agents.map((agent) => `${agent.id}:${agent.status}`).join(",")}
    </div>
  ),
}));

vi.mock("./OneChatModal", () => ({
  default: () => null,
}));

vi.mock("./RepInteractionPanel", () => ({
  default: () => null,
}));

import Office from "./Office";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const profile = {
  id: "agent",
  name: "Agent",
  path: "/profiles/agent",
  isDefault: true,
  isActive: true,
  model: "test-model",
  provider: "test-provider",
  hasEnv: true,
  hasSoul: true,
  skillCount: 0,
  gatewayRunning: false,
};

describe("Office status polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps status requests single-flight and ignores a result from the previous profile", async () => {
    const alphaTasks = deferred<{
      success: boolean;
      data: Array<{ assignee: string; status: string }>;
    }>();
    const betaTasks = deferred<{
      success: boolean;
      data: Array<{ assignee: string; status: string }>;
    }>();
    const kanbanListTasks = vi
      .fn()
      .mockImplementationOnce(() => alphaTasks.promise)
      .mockImplementationOnce(() => betaTasks.promise)
      .mockResolvedValue({ success: true, data: [] });

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listProfiles: vi.fn().mockResolvedValue([profile]),
        kanbanListTasks,
        getGpuStatus: vi.fn().mockRejectedValue(new Error("not available")),
        reenableGpu: vi.fn().mockResolvedValue(false),
      },
    });

    const view = render(<Office visible={true} profile="alpha" />);
    await act(async () => {});
    expect(kanbanListTasks).toHaveBeenCalledTimes(1);
    expect(kanbanListTasks).toHaveBeenLastCalledWith({
      status: "running",
      profile: "alpha",
    });

    await act(async () => {
      view.rerender(<Office visible={true} profile="beta" />);
      await vi.advanceTimersByTimeAsync(12_000);
    });

    // The alpha IPC is still pending, so neither the profile change nor three
    // interval ticks may start another Kanban subprocess.
    expect(kanbanListTasks).toHaveBeenCalledTimes(1);

    await act(async () => {
      alphaTasks.resolve({
        success: true,
        data: [{ assignee: "agent", status: "running" }],
      });
      await Promise.resolve();
    });

    // Once alpha settles, the queued immediate load for beta starts, but the
    // stale alpha result must never render its Working state.
    expect(kanbanListTasks).toHaveBeenCalledTimes(2);
    expect(kanbanListTasks).toHaveBeenLastCalledWith({
      status: "running",
      profile: "beta",
    });
    expect(screen.getByTestId("office-agents").textContent).not.toContain(
      "agent:working",
    );

    await act(async () => {
      betaTasks.resolve({ success: true, data: [] });
      await Promise.resolve();
    });

    expect(screen.getByTestId("office-agents").textContent).toContain(
      "agent:idle",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(kanbanListTasks).toHaveBeenCalledTimes(3);
  });

  it("keeps a rejected profile request single-flight until pending Kanban IPC settles", async () => {
    const pendingTasks = deferred<{
      success: boolean;
      data: Array<{ assignee: string; status: string }>;
    }>();
    const listProfiles = vi
      .fn()
      .mockRejectedValueOnce(new Error("profiles unavailable"))
      .mockResolvedValue([profile]);
    const kanbanListTasks = vi
      .fn()
      .mockImplementationOnce(() => pendingTasks.promise)
      .mockResolvedValue({ success: true, data: [] });

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listProfiles,
        kanbanListTasks,
        getGpuStatus: vi.fn().mockRejectedValue(new Error("not available")),
        reenableGpu: vi.fn().mockResolvedValue(false),
      },
    });

    render(<Office visible={true} profile="alpha" />);
    await act(async () => {});
    const refresh = screen.getByRole("button", { name: "office.refresh" });

    fireEvent.click(refresh);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    // The profile failure must not release the shared request while the Kanban
    // subprocess is still pending, despite manual and timer-driven refreshes.
    expect(listProfiles).toHaveBeenCalledTimes(1);
    expect(kanbanListTasks).toHaveBeenCalledTimes(1);
    expect(refresh).toBeDisabled();

    await act(async () => {
      pendingTasks.resolve({ success: true, data: [] });
      await Promise.resolve();
    });

    // The original listProfiles failure still clears the load normally, and a
    // later polling tick can start a fresh pair of status requests.
    expect(refresh).not.toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(listProfiles).toHaveBeenCalledTimes(2);
    expect(kanbanListTasks).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("office-agents").textContent).toContain(
      "agent:idle",
    );
  });

  it("queries status immediately when the visible profile changes after a settled load", async () => {
    const betaTasks = deferred<{
      success: boolean;
      data: Array<{ assignee: string; status: string }>;
    }>();
    const kanbanListTasks = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockImplementationOnce(() => betaTasks.promise);

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listProfiles: vi.fn().mockResolvedValue([profile]),
        kanbanListTasks,
        getGpuStatus: vi.fn().mockRejectedValue(new Error("not available")),
        reenableGpu: vi.fn().mockResolvedValue(false),
      },
    });

    const view = render(<Office visible={true} profile="alpha" />);
    await act(async () => {});
    expect(kanbanListTasks).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(<Office visible={true} profile="beta" />);
      await Promise.resolve();
    });

    expect(kanbanListTasks).toHaveBeenCalledTimes(2);
    expect(kanbanListTasks).toHaveBeenLastCalledWith({
      status: "running",
      profile: "beta",
    });

    await act(async () => {
      betaTasks.resolve({ success: true, data: [] });
      await Promise.resolve();
    });

    await act(async () => {
      view.rerender(<Office visible={false} profile="beta" />);
      await Promise.resolve();
    });
    await act(async () => {
      view.rerender(<Office visible={true} profile="beta" />);
      await Promise.resolve();
    });
    expect(kanbanListTasks).toHaveBeenCalledTimes(2);
  });

  it("finishes a queued profile load after a manual request is superseded", async () => {
    const staleAlphaTasks = deferred<{
      success: boolean;
      data: Array<{ assignee: string; status: string }>;
    }>();
    const betaTasks = deferred<{
      success: boolean;
      data: Array<{ assignee: string; status: string }>;
    }>();
    const kanbanListTasks = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockImplementationOnce(() => staleAlphaTasks.promise)
      .mockImplementationOnce(() => betaTasks.promise);

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listProfiles: vi.fn().mockResolvedValue([profile]),
        kanbanListTasks,
        getGpuStatus: vi.fn().mockRejectedValue(new Error("not available")),
        reenableGpu: vi.fn().mockResolvedValue(false),
      },
    });

    const view = render(<Office visible={true} profile="alpha" />);
    await act(async () => {});
    const refresh = screen.getByRole("button", { name: "office.refresh" });
    expect(refresh).not.toBeDisabled();

    fireEvent.click(refresh);
    await act(async () => {});
    expect(refresh).toBeDisabled();
    expect(kanbanListTasks).toHaveBeenCalledTimes(2);

    await act(async () => {
      view.rerender(<Office visible={true} profile="beta" />);
      await Promise.resolve();
    });
    expect(kanbanListTasks).toHaveBeenCalledTimes(2);

    await act(async () => {
      staleAlphaTasks.resolve({
        success: true,
        data: [{ assignee: "agent", status: "running" }],
      });
      await Promise.resolve();
    });

    expect(kanbanListTasks).toHaveBeenCalledTimes(3);
    expect(kanbanListTasks).toHaveBeenLastCalledWith({
      status: "running",
      profile: "beta",
    });
    expect(refresh).toBeDisabled();
    expect(screen.getByTestId("office-agents").textContent).not.toContain(
      "agent:working",
    );

    await act(async () => {
      betaTasks.resolve({ success: true, data: [] });
      await Promise.resolve();
    });

    expect(screen.getByTestId("office-agents").textContent).toContain(
      "agent:idle",
    );
    expect(refresh).not.toBeDisabled();
  });
});
