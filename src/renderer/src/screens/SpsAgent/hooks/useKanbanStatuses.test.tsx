// useKanbanStatuses.test.tsx — the shared poller behind the delegated-row agent
// badge. One kanbanListTasks fetch feeds every visible delegated row, degrades
// silently when Kanban is unavailable, and never polls when nothing is delegated.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useKanbanStatuses } from "./useKanbanStatuses";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useKanbanStatuses", () => {
  it("resolves each delegated id to its live Kanban status", async () => {
    const list = vi.fn().mockResolvedValue({
      success: true,
      data: [
        { id: "k-1", status: "running" },
        { id: "k-2", status: "done" },
      ],
    });
    stubApi({ kanbanListTasks: list });
    const { result } = renderHook(() => useKanbanStatuses(["k-1", "k-2"]));
    await waitFor(() =>
      expect(result.current.statusFor("k-1")).toBe("running"),
    );
    expect(result.current.statusFor("k-2")).toBe("done");
    expect(result.current.statusFor("unknown-id")).toBeUndefined();
  });

  it("does not touch Kanban when no rows are delegated", () => {
    const list = vi.fn();
    stubApi({ kanbanListTasks: list });
    const { result } = renderHook(() => useKanbanStatuses([]));
    expect(list).not.toHaveBeenCalled();
    expect(result.current.statusFor("k-1")).toBeUndefined();
  });

  it("degrades to no statuses when Kanban is unavailable", async () => {
    const list = vi.fn().mockResolvedValue({ success: false, error: "remote" });
    stubApi({ kanbanListTasks: list });
    const { result } = renderHook(() => useKanbanStatuses(["k-1"]));
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(result.current.statusFor("k-1")).toBeUndefined();
  });

  it("never throws when the api method is missing", () => {
    stubApi({});
    const { result } = renderHook(() => useKanbanStatuses(["k-1"]));
    expect(result.current.statusFor("k-1")).toBeUndefined();
  });

  it("picks up a status change on the next poll cycle", async () => {
    vi.useFakeTimers();
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: "k-1", status: "running" }],
      })
      .mockResolvedValue({
        success: true,
        data: [{ id: "k-1", status: "done" }],
      });
    stubApi({ kanbanListTasks: list });
    const { result } = renderHook(() => useKanbanStatuses(["k-1"]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // flush the immediate first fetch
    });
    expect(result.current.statusFor("k-1")).toBe("running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000); // next interval tick
    });
    expect(result.current.statusFor("k-1")).toBe("done");
    expect(list).toHaveBeenCalledTimes(2);
  });
});
