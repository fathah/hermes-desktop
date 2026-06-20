import { describe, expect, it, vi } from "vitest";

const { appendFileSyncMock } = vi.hoisted(() => ({
  appendFileSyncMock: vi.fn(),
}));

vi.mock("fs", () => {
  const fns = {
    appendFileSync: appendFileSyncMock,
    existsSync: () => true,
    mkdirSync: () => {},
  };
  return { ...fns, default: fns };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-home",
}));

import { appendAuditLog } from "../src/main/audit-log";

describe("appendAuditLog", () => {
  it("appends one JSONL entry without rewriting the whole file", () => {
    appendAuditLog({
      ts: 1,
      action: "auto-approve",
      command: "ls",
      runId: "run-1",
      profile: "default",
    });

    expect(appendFileSyncMock).toHaveBeenCalledWith(
      "/tmp/hermes-home/logs/audit.log",
      JSON.stringify({
        ts: 1,
        action: "auto-approve",
        command: "ls",
        runId: "run-1",
        profile: "default",
      }) + "\n",
      { encoding: "utf-8", mode: 0o600 },
    );
  });
});
