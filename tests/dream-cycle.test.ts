import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const mocks = vi.hoisted(() => ({
  chatCompletionOnce: vi.fn(),
  deliverDailyBrief: vi.fn(),
  getSpsNoteIndex: vi.fn(),
  logError: vi.fn(),
  parseFrontmatter: vi.fn(),
  rebuild: vi.fn(),
  resolveSpsVaultDir: vi.fn(),
}));

vi.mock("../src/main/note-index", () => ({
  getSpsNoteIndex: mocks.getSpsNoteIndex,
  parseFrontmatter: mocks.parseFrontmatter,
}));

vi.mock("../src/main/sps-storage", () => ({
  resolveSpsVaultDir: mocks.resolveSpsVaultDir,
}));

vi.mock("../src/main/hermes/chat-client", () => ({
  chatCompletionOnce: mocks.chatCompletionOnce,
}));

vi.mock("../src/main/daily-brief-delivery", () => ({
  deliverDailyBrief: mocks.deliverDailyBrief,
}));

vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => "active-profile",
}));

vi.mock("../src/main/log", () => ({
  formatLogError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  log: {
    error: mocks.logError,
    info: vi.fn(),
  },
}));

import { runDreamCycle } from "../src/main/dream-cycle";

function seedDreamCycle(vaultDir: string): void {
  writeFileSync(
    join(vaultDir, "Existing.md"),
    "---\ntitle: Existing\n---\n# Existing\nBody",
  );
  mocks.getSpsNoteIndex.mockResolvedValue({
    query: () => [{ path: "Existing.md", title: "Existing" }],
    lint: () => ({ brokenLinks: [], orphans: [] }),
    rebuild: mocks.rebuild,
  });
  mocks.parseFrontmatter.mockReturnValue({
    props: { summary: "Existing summary" },
    body: "# Existing\nBody",
  });
  mocks.chatCompletionOnce.mockResolvedValue({
    content: "# Daily Brief\n\nReady for review.",
  });
  mocks.deliverDailyBrief.mockResolvedValue({ ok: true, results: [] });
}

describe("dream cycle", () => {
  let vaultDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:00:00.000Z"));
    vaultDir = mkdtempSync(join(tmpdir(), "hermes-dream-cycle-"));
    vi.clearAllMocks();
    mocks.resolveSpsVaultDir.mockReturnValue(vaultDir);
    seedDreamCycle(vaultDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(vaultDir, { recursive: true, force: true });
  });

  it("delivers the generated daily brief after rebuilding the note index", async () => {
    await runDreamCycle("work");

    const reportPath = join(vaultDir, "Daily Brief - 2026-07-07.md");
    const markdown = readFileSync(reportPath, "utf8");
    expect(markdown).toContain("context: review");
    expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    expect(mocks.deliverDailyBrief).toHaveBeenCalledWith(
      markdown,
      new Date("2026-07-07T12:00:00.000Z"),
      "work",
    );
  });

  it("keeps the generated daily brief when owner delivery fails", async () => {
    mocks.deliverDailyBrief.mockRejectedValueOnce(new Error("delivery failed"));

    await runDreamCycle("work");

    expect(existsSync(join(vaultDir, "Daily Brief - 2026-07-07.md"))).toBe(
      true,
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      "dream-cycle",
      expect.objectContaining({
        msg: "daily brief owner delivery failed",
        profile: "work",
        error: "delivery failed",
      }),
    );
  });
});
