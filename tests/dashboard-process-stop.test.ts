// @vitest-environment node
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { afterEach, expect, it, vi } from "vitest";

const taskkill = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ execFile: taskkill }));
import { stopDashboardProcess } from "../src/main/dashboard-process-stop";
function child(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid: 1234,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  }) as unknown as ChildProcess;
}
afterEach(() => {
  vi.useRealTimers();
  taskkill.mockReset();
});

// @lat: [[dashboard-shutdown#Windows process tree]]
it("uses bounded non-shell Windows tree termination and confirms the actual owned child's exit", async () => {
  vi.useFakeTimers();
  const proc = child();
  const stopped = stopDashboardProcess(proc, "win32");
  let complete = false;
  void stopped.then(() => {
    complete = true;
  });
  expect(taskkill).toHaveBeenCalledWith(
    "taskkill",
    ["/PID", "1234", "/T", "/F"],
    expect.objectContaining({ timeout: 2000, windowsHide: true }),
    expect.any(Function),
  );
  taskkill.mock.calls[0][3](null);
  await Promise.resolve();
  expect(complete).toBe(false);
  proc.emit("exit", 0);
  expect(await stopped).toBe(true);
  await vi.advanceTimersByTimeAsync(4000);
  expect(proc.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not equate a sent kill signal with exit and bounds an unconfirmed shutdown", async () => {
  vi.useFakeTimers();
  const proc = child();
  const stopped = stopDashboardProcess(proc, "linux");
  expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  await vi.advanceTimersByTimeAsync(2000);
  expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  await vi.advanceTimersByTimeAsync(1000);
  expect(await stopped).toBe(false);
  expect(proc.listenerCount("exit")).toBe(0);
});

it("falls back once when taskkill fails and still waits for exit", async () => {
  vi.useFakeTimers();
  const proc = child();
  const stopped = stopDashboardProcess(proc, "win32");
  taskkill.mock.calls[0][3](new Error("unavailable"));
  expect(proc.kill).toHaveBeenCalledTimes(1);
  proc.emit("exit", 1);
  expect(await stopped).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
