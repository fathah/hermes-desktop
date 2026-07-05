import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

const {
  handlers,
  resolveSpsVaultDirMock,
  writeSpsCaptureMock,
  listRecentScreenshotsMock,
} = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  resolveSpsVaultDirMock: vi.fn(() => "/vault"),
  writeSpsCaptureMock: vi.fn(async () => ({ success: true, id: "cap_1" })),
  listRecentScreenshotsMock: vi.fn(async () => []),
}));

vi.mock("electron", () => ({
  clipboard: {
    readImage: () => ({
      isEmpty: () => true,
      toPNG: () => Buffer.alloc(0),
    }),
  },
}));

vi.mock("../safe-handle", () => ({
  safeHandle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, async (...args: unknown[]) => fn(...args));
  },
}));

vi.mock("../../sps-agent", () => ({
  spsUnfurl: vi.fn(async () => ({ title: "", desc: "" })),
}));

vi.mock("../../sps-capture", () => ({
  writeSpsCapture: writeSpsCaptureMock,
}));

vi.mock("../../sps-storage", () => ({
  resolveSpsVaultDir: resolveSpsVaultDirMock,
}));

vi.mock("../../recent-screenshots", () => ({
  importClipboardScreenshot: vi.fn(),
  importRecentScreenshot: vi.fn(),
  listRecentScreenshots: listRecentScreenshotsMock,
}));

vi.mock("../connection-guards", () => ({
  requireLocalWorkspace: vi.fn(),
}));

import { registerSpsCaptureIpc } from "./capture";

function handler(channel: string): (...args: unknown[]) => unknown {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`missing handler: ${channel}`);
  return fn;
}

describe("SPS capture IPC validation", () => {
  beforeEach(() => {
    handlers.clear();
    resolveSpsVaultDirMock.mockClear();
    writeSpsCaptureMock.mockClear();
    listRecentScreenshotsMock.mockClear();
    registerSpsCaptureIpc();
  });

  it("rejects a hostile profile before resolving or writing the vault", async () => {
    await expect(
      handler("sps-capture")(
        {} as IpcMainInvokeEvent,
        { source: "quick-note", body: "hello", capturedAt: 1 },
        "../escape",
      ),
    ).rejects.toThrow(/profile/i);

    expect(resolveSpsVaultDirMock).not.toHaveBeenCalled();
    expect(writeSpsCaptureMock).not.toHaveBeenCalled();
  });

  it("rejects a hostile profile even on read-only screenshot listing", async () => {
    await expect(
      handler("sps-list-recent-screenshots")(
        {} as IpcMainInvokeEvent,
        "bad\u0000profile",
      ),
    ).rejects.toThrow(/profile/i);

    expect(listRecentScreenshotsMock).not.toHaveBeenCalled();
  });
});
