import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_HOME = mkdtempSync(join(tmpdir(), "ln-home-"));

vi.mock("./installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

vi.mock("./gateway-chat", () => ({
  gatewayChat: vi.fn(),
}));

vi.mock("./sps-storage", () => ({
  resolveSpsVaultDir: () => join(TEST_HOME, "sps-agent", "vault"),
}));

vi.mock("./sps-vault", () => ({
  readPageMarkdownFrom: vi.fn(async () => "# Site\n\nOld body\n"),
}));

vi.mock("./utils", async () => {
  const { mkdirSync, writeFileSync, renameSync, existsSync } = await import("fs");
  return {
    profileHome: () => TEST_HOME,
    safeWriteFile: (filePath: string, content: string) => {
      const parent = filePath.replace(/[/\\][^/\\]+$/, "");
      if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true });
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, content);
      renameSync(tmp, filePath);
    },
  };
});

import { gatewayChat } from "./gateway-chat";
import {
  __clearRunningForTests,
  deleteLiveNote,
  enqueueLiveNotesForEmailEvent,
  listLiveNotePending,
  listLiveNotes,
  runLiveNote,
  upsertLiveNote,
} from "./live-notes";

describe("live-notes main", () => {
  beforeEach(() => {
    __clearRunningForTests();
    vi.mocked(gatewayChat).mockReset();
    // reset registry by deleting file if present
    try {
      rmSync(join(TEST_HOME, "sps-agent"), { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  afterEach(() => {
    __clearRunningForTests();
  });

  it("upserts and lists by pageId", () => {
    const res = upsertLiveNote({
      pageId: "linking-road",
      objective: "Keep site status current",
      triggers: {
        eventMatch: { keywords: ["linking"] },
      },
    });
    expect(res.ok).toBe(true);
    expect(listLiveNotes()).toHaveLength(1);
    expect(listLiveNotes()[0].pageId).toBe("linking-road");
  });

  it("runLiveNote writes pending on model body replace", async () => {
    vi.mocked(gatewayChat).mockResolvedValue("# Site\n\nNew body from agent\n");
    upsertLiveNote({
      pageId: "linking-road",
      objective: "Keep current",
    });
    const result = await runLiveNote("linking-road", "manual", {
      bypassBackoff: true,
    });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("replace");
    expect(listLiveNotePending()).toHaveLength(1);
    expect(listLiveNotePending()[0].proposedBody).toContain("New body");
  });

  it("runLiveNote no_update does not write pending", async () => {
    vi.mocked(gatewayChat).mockResolvedValue("NO_UPDATE");
    upsertLiveNote({ pageId: "p1", objective: "x" });
    const result = await runLiveNote("p1", "manual", { bypassBackoff: true });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("no_update");
    expect(listLiveNotePending()).toHaveLength(0);
  });

  it("email enqueue matches keywords without throwing", async () => {
    vi.mocked(gatewayChat).mockResolvedValue("NO_UPDATE");
    upsertLiveNote({
      pageId: "site",
      objective: "obj",
      triggers: { eventMatch: { keywords: ["linking"] } },
    });
    enqueueLiveNotesForEmailEvent({
      subject: "Linking Road gate",
      bodyPreview: "issue",
      from: "a@b.com",
      triageLabel: "urgent",
      captureId: "cap1",
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(vi.mocked(gatewayChat)).toHaveBeenCalled();
  });

  it("delete removes item", () => {
    upsertLiveNote({ pageId: "gone", objective: "x" });
    expect(deleteLiveNote("gone").ok).toBe(true);
    expect(listLiveNotes()).toHaveLength(0);
  });
});
