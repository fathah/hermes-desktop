import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "fs";

// Keep the logger's HERMES_HOME dependency from pulling the installer/electron
// chain into this unit test. A per-run temp home lets the MED-10 error-sink
// tests exercise the real file writes.
const TEST_HOME = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os") as typeof import("os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  return path.join(os.tmpdir(), `hermes-log-test-${process.pid}`);
});
vi.mock("./installer/paths", () => ({ HERMES_HOME: TEST_HOME }));

import {
  clearErrorLog,
  formatLogError,
  formatLogLine,
  hermesErrorLogPath,
  log,
  readErrorLogTail,
  scrubSecrets,
  shouldRotate,
} from "./log";

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

describe("formatLogError", () => {
  it("uses Error.message instead of serializing Error as an empty object", () => {
    expect(formatLogError(new Error("disk full"))).toBe("disk full");
  });

  it("keeps string and JSON-serializable payloads readable", () => {
    expect(formatLogError("plain failure")).toBe("plain failure");
    expect(formatLogError({ code: "EACCES" })).toBe('{"code":"EACCES"}');
  });
});

describe("scrubSecrets", () => {
  it("redacts bearer tokens, API-key shapes, and secret JSON fields", () => {
    const line = JSON.stringify({
      msg: "request failed",
      authorization: "Bearer abcdef1234567890",
      apiKey: "sk-ABCDEFGHIJKLMNOP1234",
      detail: '{"password":"hunter2-super-secret"}',
    });
    const scrubbed = scrubSecrets(line);
    expect(scrubbed).not.toContain("abcdef1234567890");
    expect(scrubbed).not.toContain("sk-ABCDEFGHIJKLMNOP1234");
    expect(scrubbed).not.toContain("hunter2-super-secret");
    expect(scrubbed).toContain("request failed");
  });

  it("leaves ordinary lines untouched", () => {
    const line = '{"msg":"remote list error","error":"fetch failed"}';
    expect(scrubSecrets(line)).toBe(line);
  });
});

describe("error sink (MED-10)", () => {
  beforeEach(() => {
    // NOTE: don't rm the logs dir — the logger's ensureInit() only creates it
    // once per process; clearing the file is enough isolation here.
    clearErrorLog();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("appends error and warn records but not info", () => {
    log.error("crash", { msg: "uncaughtException", error: "boom" });
    log.warn("updater", { msg: "disabled" });
    log.info("gateway", { msg: "started" });

    const tail = readErrorLogTail(10);
    expect(tail).toHaveLength(2);
    expect(tail[0]).toContain("uncaughtException");
    expect(tail[1]).toContain("disabled");
    expect(tail.join("\n")).not.toContain("started");
  });

  it("scrubs secrets before the record hits disk", () => {
    log.error("net", {
      msg: "request failed",
      header: "Bearer abcdef1234567890",
    });
    const raw = readFileSync(hermesErrorLogPath(), "utf-8");
    expect(raw).not.toContain("abcdef1234567890");
    expect(raw).toContain("Bearer [redacted]");
  });

  it("clearErrorLog empties the sink", () => {
    log.error("crash", { msg: "one" });
    expect(readErrorLogTail(10)).toHaveLength(1);
    clearErrorLog();
    expect(readErrorLogTail(10)).toHaveLength(0);
    expect(existsSync(hermesErrorLogPath())).toBe(true);
  });

  it("readErrorLogTail returns only the last N records", () => {
    for (let i = 0; i < 5; i++) log.error("loop", { msg: `err-${i}` });
    const tail = readErrorLogTail(2);
    expect(tail).toHaveLength(2);
    expect(tail[0]).toContain("err-3");
    expect(tail[1]).toContain("err-4");
  });
});
