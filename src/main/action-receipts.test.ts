import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("action receipt log", () => {
  let previousHermesHome: string | undefined;
  let homes: string[] = [];

  afterEach(async () => {
    if (previousHermesHome === undefined) {
      delete process.env.HERMES_HOME;
    } else {
      process.env.HERMES_HOME = previousHermesHome;
    }
    vi.resetModules();
    await Promise.all(
      homes.map((home) => rm(home, { recursive: true, force: true })),
    );
    homes = [];
  });

  async function loadWithHome(): Promise<typeof import("./action-receipts")> {
    previousHermesHome = process.env.HERMES_HOME;
    const home = await mkdtemp(join(tmpdir(), "action-receipts-"));
    homes.push(home);
    process.env.HERMES_HOME = home;
    vi.resetModules();
    return import("./action-receipts");
  }

  it("writes newest receipts first and respects an empty limit", async () => {
    const {
      appendActionReceipt,
      actionReceiptLogPath,
      readRecentActionReceipts,
    } = await loadWithHome();

    appendActionReceipt(
      {
        ts: 1,
        source: "assistant",
        action: "approval",
        outcome: "requested",
        summary: "Approval requested",
      },
      "work",
    );
    appendActionReceipt(
      {
        ts: 2,
        source: "provider",
        action: "credential",
        outcome: "saved",
        summary: "openai",
        apiKey: "sk-proj-should-not-persist",
      },
      "work",
    );

    expect(readRecentActionReceipts(0, "work")).toEqual([]);
    expect(readRecentActionReceipts(1, "work")).toEqual([
      {
        ts: 2,
        source: "provider",
        action: "credential",
        outcome: "saved",
        profile: "work",
        summary: "openai",
      },
    ]);

    const raw = await readFile(actionReceiptLogPath("work"), "utf-8");
    expect(raw).not.toContain("sk-proj");
  });
});
