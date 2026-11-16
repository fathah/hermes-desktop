// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventEmitter } from "events";

const dialogs = vi.hoisted(
  () =>
    [] as Array<{
      webContents: EventEmitter;
      close: () => void;
      isDestroyed: () => boolean;
    }>,
);

vi.mock("electron", async () => {
  const { EventEmitter } = await import("events");
  const ipcMain = new EventEmitter();
  return {
    ipcMain,
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: vi.fn(),
      });
      destroyed = false;
      constructor() {
        super();
        dialogs.push(this);
      }
      close(): void {
        this.destroyed = true;
        this.emit("closed");
      }
      isDestroyed(): boolean {
        return this.destroyed;
      }
      loadURL(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

import { ipcMain } from "electron";
import { showPasswordDialog } from "../src/main/askpass";
import { ASKPASS_SUBMIT_CHANNEL } from "../src/shared/askpass";

afterEach(() => {
  for (const dialog of dialogs) if (!dialog.isDestroyed()) dialog.close();
  dialogs.length = 0;
  ipcMain.removeAllListeners();
});

describe("native credential prompt cancellation", () => {
  // @lat: [[main-server-requests#Native prompt cancellation]]
  it("closes a withdrawn prompt and removes its IPC listener", async () => {
    const controller = new AbortController();
    const pending = showPasswordDialog(null, "Enter a secret", {
      signal: controller.signal,
    });
    expect(ipcMain.listenerCount(ASKPASS_SUBMIT_CHANNEL)).toBe(1);
    controller.abort();
    await expect(pending).resolves.toBeNull();
    expect(dialogs[0].isDestroyed()).toBe(true);
    expect(ipcMain.listenerCount(ASKPASS_SUBMIT_CHANNEL)).toBe(0);
  });

  it("cannot submit an old dialog's value into a replacement prompt", async () => {
    const controller = new AbortController();
    const old = showPasswordDialog(null, "Old request", {
      signal: controller.signal,
    });
    const oldSender = dialogs[0].webContents;
    controller.abort();
    await expect(old).resolves.toBeNull();
    const replacement = showPasswordDialog(null, "Replacement request");
    let completed = false;
    void replacement.then(() => {
      completed = true;
    });
    ipcMain.emit(ASKPASS_SUBMIT_CHANNEL, { sender: oldSender }, "stale-value");
    await Promise.resolve();
    expect(completed).toBe(false);
    ipcMain.emit(
      ASKPASS_SUBMIT_CHANNEL,
      { sender: dialogs[1].webContents },
      "current-value",
    );
    await expect(replacement).resolves.toBe("current-value");
    expect(ipcMain.listenerCount(ASKPASS_SUBMIT_CHANNEL)).toBe(0);
  });

  it("does not create a dialog for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      showPasswordDialog(null, "Withdrawn request", {
        signal: controller.signal,
      }),
    ).resolves.toBeNull();
    expect(dialogs).toHaveLength(0);
  });
});
