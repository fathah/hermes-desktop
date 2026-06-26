import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { appendSpsPulse, readRecentSpsPulses } from "./sps-pulse";

describe("SPS pulse markdown log", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "sps-pulse-"));
  });

  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it("seeds a readable pulse page and lists newest pulses first", async () => {
    await appendSpsPulse(vault, {
      ts: "2026-06-26T00:00:00.000Z",
      source: "wiki",
      kind: "ingest",
      summary: "Filed inbox",
    });
    await appendSpsPulse(vault, {
      ts: "2026-06-26T01:00:00.000Z",
      source: "assistant",
      kind: "approval",
      summary: "Approval requested",
      refs: [{ kind: "run", id: "run-1" }],
    });

    const body = await readFile(join(vault, "pulse.md"), "utf-8");
    expect(body).toContain('title: "Pulse"');
    expect(body).toContain("# Workspace pulse");
    expect(body.match(/# Workspace pulse/g)).toHaveLength(1);
    expect(body).toContain("wiki/ingest | Filed inbox");

    const pulses = await readRecentSpsPulses(vault, 1);
    expect(pulses).toEqual([
      {
        ts: "2026-06-26T01:00:00.000Z",
        source: "assistant",
        kind: "approval",
        summary: "Approval requested",
        refs: [{ kind: "run", id: "run-1" }],
      },
    ]);
    expect(await readRecentSpsPulses(vault, 0)).toEqual([]);
  });
});
