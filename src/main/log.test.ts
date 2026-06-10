import { describe, it, expect, vi } from "vitest";

// Keep the logger's HERMES_HOME dependency from pulling the installer/electron
// chain into this unit test — we only exercise the pure formatting + rotation
// decision here.
vi.mock("./installer", () => ({ HERMES_HOME: "/tmp/hermes-log-test" }));

import { formatLogLine, shouldRotate } from "./log";

describe("formatLogLine", () => {
  const ts = 1_700_000_000_000;

  it("wraps a string payload as a msg field with level/scope/ts", () => {
    const line = formatLogLine("info", "gateway", "started", ts);
    expect(line.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: "info",
      scope: "gateway",
      msg: "started",
    });
    expect(parsed.ts).toBe(new Date(ts).toISOString());
  });

  it("spreads an object payload as structured fields", () => {
    const line = formatLogLine(
      "error",
      "ipc",
      {
        channel: "save",
        message: "EACCES",
      },
      ts,
    );
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: "error",
      scope: "ipc",
      channel: "save",
      message: "EACCES",
    });
  });

  it("emits exactly one JSON line (no embedded newlines)", () => {
    const line = formatLogLine("warn", "scope", { a: 1 }, ts);
    expect(line.trimEnd().includes("\n")).toBe(false);
  });
});

describe("shouldRotate", () => {
  it("is false below the threshold", () => {
    expect(shouldRotate(100, 1000)).toBe(false);
  });

  it("is true at or above the threshold", () => {
    expect(shouldRotate(1000, 1000)).toBe(true);
    expect(shouldRotate(1001, 1000)).toBe(true);
  });
});
