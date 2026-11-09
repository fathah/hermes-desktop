// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { writeFileSync } = vi.hoisted(() => ({ writeFileSync: vi.fn() }));

vi.mock("fs", async (original) => ({
  ...(await original<typeof import("fs")>()),
  existsSync: () => true,
  writeFileSync,
  unlinkSync: vi.fn(),
}));
vi.mock("../src/main/config", () => ({
  getConnectionConfig: vi.fn(),
  getModelConfig: vi.fn(),
  hasOAuthCredentials: vi.fn(),
}));
vi.mock("child_process", async (original) => {
  const { EventEmitter } = await import("events");
  return {
    ...(await original<typeof import("child_process")>()),
    spawn: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 87));
      return child;
    },
  };
});

import { runInstall } from "../src/main/installer";

describe("Windows installer verification result", () => {
  it("cannot accept verification failure because older Agent binaries exist", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    try {
      Object.defineProperty(process, "platform", {
        ...descriptor,
        value: "win32",
      });
      const progress = vi.fn();
      await expect(runInstall(progress)).rejects.toThrow("verification failed");
      expect(
        progress.mock.calls.some(([event]) =>
          String(event.log).includes("installed successfully"),
        ),
      ).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", descriptor);
    }
  });
});

describe("Windows installer wrapper encoding", () => {
  it("writes exactly one UTF-8 BOM so PowerShell 5.1 keeps a non-ASCII profile path", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    const hermesHome = "C:\\Users\\Michał\\AppData\\Local\\hermes";
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    try {
      Object.defineProperty(process, "platform", {
        ...descriptor,
        value: "win32",
      });
      vi.stubEnv("HERMES_HOME", hermesHome);
      writeFileSync.mockClear();
      // The installer fixes IS_WINDOWS and HERMES_HOME when it is evaluated.
      vi.resetModules();
      const { runInstall } = await import("../src/main/installer");

      await expect(runInstall(vi.fn())).rejects.toThrow("verification failed");

      const [, text, options] = writeFileSync.mock.calls.find(([path]) =>
        String(path).endsWith(".ps1"),
      )!;
      const bytes = Buffer.from(text, options.encoding);
      expect(bytes.subarray(0, bom.length)).toEqual(bom);
      expect(bytes.indexOf(bom, bom.length)).toBe(-1);
      expect(text).toContain(`$hermesHome = '${hermesHome}'`);
    } finally {
      Object.defineProperty(process, "platform", descriptor);
      vi.unstubAllEnvs();
    }
  });
});
