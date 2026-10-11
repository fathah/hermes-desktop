import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRemoteOnlyMode } from "./useRemoteOnlyMode";

function deferred(): {
  promise: Promise<boolean>;
  resolve: (remote: boolean) => void;
} {
  let resolve!: (remote: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Remote mode permissions across target changes", () => {
  let changed: (() => void) | null;
  const mode = vi.fn();

  beforeEach(() => {
    changed = null;
    mode.mockReset();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        isRemoteOnlyMode: mode,
        onConnectionConfigChanged: (callback: () => void) => {
          changed = callback;
          return () => {
            if (changed === callback) changed = null;
          };
        },
      },
    });
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Renderer mode transitions]]
  it("restricts the new target immediately when switching connections on the same screen", async () => {
    const remote = deferred();
    mode.mockResolvedValueOnce(false).mockReturnValueOnce(remote.promise);
    const view = renderHook(
      ({ connectionId }) => useRemoteOnlyMode(connectionId, "gateway"),
      { initialProps: { connectionId: "local" } },
    );
    await act(async () => {});
    expect(view.result.current).toBe(false);

    view.rerender({ connectionId: "remote" });
    expect(view.result.current).toBe(true);
    expect(mode).toHaveBeenCalledTimes(2);
    await act(async () => remote.resolve(true));
    expect(view.result.current).toBe(true);
  });

  it("ignores an old connection's late local-mode reply", async () => {
    const old = deferred();
    mode.mockReturnValueOnce(old.promise).mockResolvedValueOnce(true);
    const view = renderHook(
      ({ connectionId }) => useRemoteOnlyMode(connectionId, "discover"),
      { initialProps: { connectionId: "old" } },
    );
    view.rerender({ connectionId: "new" });
    await act(async () => {});
    await act(async () => old.resolve(false));
    expect(view.result.current).toBe(true);
  });

  it("invalidates local permissions when the same connection's configuration changes", async () => {
    const remote = deferred();
    mode.mockResolvedValueOnce(false).mockReturnValueOnce(remote.promise);
    const view = renderHook(() => useRemoteOnlyMode("same-id", "gateway"));
    await act(async () => {});
    expect(view.result.current).toBe(false);
    act(() => changed?.());
    expect(view.result.current).toBe(true);
    await act(async () => remote.resolve(true));
    expect(view.result.current).toBe(true);
  });

  it("preserves resolved mode during ordinary view changes", async () => {
    const pending = deferred();
    mode.mockResolvedValueOnce(false).mockReturnValueOnce(pending.promise);
    const view = renderHook(
      ({ screen }) => useRemoteOnlyMode("same-id", screen),
      { initialProps: { screen: "chat" } },
    );
    await act(async () => {});
    view.rerender({ screen: "gateway" });
    expect(view.result.current).toBe(false);
    await act(async () => pending.resolve(false));
  });
});
