import { describe, expect, it, vi } from "vitest";

vi.mock("node-pty", () => ({ spawn: vi.fn() }));

import { resolveTerminalShell } from "./integrated-terminal";

describe("integrated terminal shell selection", () => {
  it("uses the configured login shell on Unix", () => {
    expect(resolveTerminalShell("darwin", { SHELL: "/bin/fish" })).toEqual({
      command: "/bin/fish",
      args: ["-l"],
    });
  });

  it("falls back to PowerShell on Windows", () => {
    expect(resolveTerminalShell("win32", {})).toEqual({
      command: "powershell.exe",
      args: ["-NoLogo"],
    });
  });
});
