import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "./parseSlashCommand";

describe("parseSlashCommand", () => {
  it("parses valid command with arguments", () => {
    const res = parseSlashCommand("  /model  gpt-4o  ");
    expect(res).toEqual({
      ok: true,
      command: {
        rawInput: "  /model  gpt-4o  ",
        name: "model",
        normalizedName: "model",
        args: "gpt-4o",
      },
    });
  });

  it("parses valid command without arguments", () => {
    const res = parseSlashCommand("/status");
    expect(res).toEqual({
      ok: true,
      command: {
        rawInput: "/status",
        name: "status",
        normalizedName: "status",
        args: "",
      },
    });
  });

  it("normalizes uppercase command name", () => {
    const res = parseSlashCommand("/COMPress here");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.command.name).toBe("COMPress");
      expect(res.command.normalizedName).toBe("compress");
      expect(res.command.args).toBe("here");
    }
  });

  it("preserves argument case and internal whitespace", () => {
    const res = parseSlashCommand(
      "/explain   Const Foo = 'BAR'  \n next line ",
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.command.args).toBe("Const Foo = 'BAR'  \n next line");
    }
  });

  it("rejects non-slash input", () => {
    const res = parseSlashCommand("hello world");
    expect(res.ok).toBe(false);
  });

  it("rejects empty slash", () => {
    expect(parseSlashCommand("/").ok).toBe(false);
    expect(parseSlashCommand("   /   ").ok).toBe(false);
  });
});
