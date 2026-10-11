// @vitest-environment node
import { EventEmitter } from "events";
import type { App } from "electron";
import { expect, it, vi } from "vitest";
import { registerManagedQuit } from "../src/main/app/managed-quit";

// @lat: [[dashboard-shutdown#Synchronous quit admission]]
it("closes launch admission in the first quit event before asynchronous cleanup starts", async () => {
  let blocked = false;
  const begin = vi.fn(() => {
    blocked = true;
  });
  const cleanup = vi.fn(async () => {
    expect(blocked).toBe(true);
  });
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() });
  registerManagedQuit(app as unknown as App, cleanup, begin);
  app.emit("before-quit", { preventDefault: vi.fn() });
  expect(blocked).toBe(true);
  expect(cleanup).not.toHaveBeenCalled();
  app.emit("before-quit", { preventDefault: vi.fn() });
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
  expect(begin).toHaveBeenCalledTimes(1);
});

// @lat: [[dashboard-shutdown#Electron waits for cleanup]]
it("prevents repeated Electron quit until asynchronous owned-process cleanup settles", async () => {
  let finish!: () => void;
  const cleanup = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() });
  registerManagedQuit(app as unknown as App, cleanup);
  const first = { preventDefault: vi.fn() };
  app.emit("before-quit", first);
  app.emit("before-quit", first);
  await Promise.resolve();
  expect(first.preventDefault).toHaveBeenCalledTimes(2);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(app.quit).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
  const resumed = { preventDefault: vi.fn() };
  app.emit("before-quit", resumed);
  expect(resumed.preventDefault).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("resumes quit when cleanup rejects instead of trapping the app in a prevented quit", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() });
  registerManagedQuit(app as unknown as App, async () => {
    throw new Error("failed");
  });
  app.emit("before-quit", { preventDefault: vi.fn() });
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
  error.mockRestore();
});
