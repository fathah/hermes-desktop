import { beforeEach, describe, expect, it, vi } from "vitest";
import { drainLiveNotePending } from "./pendingDrain";

describe("drainLiveNotePending", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-applies pending and acks", async () => {
    const commitPage = vi.fn();
    const ack = vi.fn().mockResolvedValue({ ok: true });
    const list = vi.fn().mockResolvedValue([
      {
        id: "p1",
        liveNoteId: "ln1",
        pageId: "site",
        title: "Site",
        createdAt: 1,
        trigger: "manual",
        contentBeforeHash: "h",
        proposedBody: "# Site\nUpdated",
        summary: "ok",
        autoApply: true,
      },
    ]);
    // @ts-expect-error test stub
    window.hermesAPI = {
      spsLiveNoteListPending: list,
      spsLiveNoteAckApplied: ack,
      spsCreateBackup: vi.fn().mockResolvedValue(null),
    };

    const result = await drainLiveNotePending({ commitPage });
    expect(result.applied).toBe(1);
    expect(commitPage).toHaveBeenCalledOnce();
    expect(ack).toHaveBeenCalledWith("p1", "ln1", "ok", undefined);
  });

  it("skips autoApply when active page is dirty", async () => {
    const commitPage = vi.fn();
    // @ts-expect-error test stub
    window.hermesAPI = {
      spsLiveNoteListPending: vi.fn().mockResolvedValue([
        {
          id: "p1",
          liveNoteId: "ln1",
          pageId: "site",
          title: "Site",
          createdAt: 1,
          trigger: "email",
          contentBeforeHash: "h",
          proposedBody: "body",
          summary: "s",
          autoApply: true,
        },
      ]),
      spsLiveNoteAckApplied: vi.fn(),
    };

    const result = await drainLiveNotePending({
      commitPage,
      activePageId: "site",
      isDirty: true,
    });
    expect(result.applied).toBe(0);
    expect(result.leftover).toHaveLength(1);
    expect(commitPage).not.toHaveBeenCalled();
  });
});
