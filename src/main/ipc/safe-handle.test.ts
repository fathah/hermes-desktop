import { describe, it, expect, vi } from "vitest";

// safe-handle.ts imports electron (for ipcMain) and ../log (which pulls
// ../installer → HERMES_HOME → the electron chain). Stub both so this unit can
// exercise the pure error-shaping logic without Electron in the loop. Only
// `describeIpcError` is tested here; `safeHandle`'s effects (ipcMain.handle
// registration + log.error) live behind these boundaries by design.
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("../installer", () => ({
  HERMES_HOME: "/tmp/hermes-safe-handle-test",
}));

import { describeIpcError } from "./safe-handle";

describe("describeIpcError", () => {
  it("carries the channel and message for a normal Error", () => {
    const { message, fields } = describeIpcError(
      "save-workspace",
      new Error("disk full"),
    );
    expect(message).toBe("disk full");
    expect(fields.channel).toBe("save-workspace");
    expect(fields.message).toBe("disk full");
    expect(typeof fields.stack).toBe("string");
  });

  it("stringifies a non-Error throw and omits the stack", () => {
    const { message, fields } = describeIpcError("ping", "boom");
    expect(message).toBe("boom");
    expect(fields.message).toBe("boom");
    expect(fields.stack).toBeUndefined();
  });

  it("redacts a secret embedded in the error message", () => {
    const key = "sk-ant-api03-" + "A".repeat(80) + "AA";
    const { message, fields } = describeIpcError(
      "remote-call",
      new Error(`auth failed for ${key}`),
    );
    expect(message).not.toContain(key);
    expect(message).toContain("[REDACTED]");
    expect(fields.message).not.toContain(key);
  });

  it("redacts a secret that only appears in the stack trace", () => {
    const key = "ghp_" + "b".repeat(36);
    const err = new Error("request rejected");
    err.stack = `Error: request rejected\n    at fetch (${key})`;
    const { fields } = describeIpcError("remote-call", err);
    expect(fields.stack).toBeDefined();
    expect(fields.stack).not.toContain(key);
    expect(fields.stack).toContain("[REDACTED]");
  });
});
