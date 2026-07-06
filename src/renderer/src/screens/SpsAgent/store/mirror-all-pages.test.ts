import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./index";
import { blk } from "../lib/ids";

// MED-8 regression: the blob-mode autosave subscriber historically mirrored
// ONLY the open page (mirrorPage(s.page, …)), so background pages written by
// ingestCommitPage / makePageWithId for arbitrary ids never got a
// vault/<id>.md until manually opened — absent from search/links/backlinks.
// The diff-mirror must export every changed page and delete removed ones.

interface MirrorApi {
  spsSave: ReturnType<typeof vi.fn>;
  spsExportPage: ReturnType<typeof vi.fn>;
  spsDeletePage: ReturnType<typeof vi.fn>;
}

let api: MirrorApi;

function exportedIds(): string[] {
  return api.spsExportPage.mock.calls.map((call) => String(call[0]));
}

async function flushAutosave(): Promise<void> {
  await vi.advanceTimersByTimeAsync(400);
}

beforeEach(() => {
  localStorage.clear(); // storage mode defaults to blob
  vi.useFakeTimers();
  api = {
    spsSave: vi.fn().mockResolvedValue({ ok: true, rev: 1, merged: false }),
    spsExportPage: vi.fn().mockResolvedValue(true),
    spsDeletePage: vi.fn().mockResolvedValue(true),
  };
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("blob-mode diff-mirror (MED-8)", () => {
  it("mirrors a background page that is not the open page", async () => {
    const st = useStore.getState();
    st.selectPage("home");
    st.makePageWithId(
      "bg-report",
      { icon: "📄", title: "Background report" },
      [blk("p", "Landed by ingest, never opened.")],
      null,
    );

    await flushAutosave();

    expect(useStore.getState().page).toBe("home");
    expect(exportedIds()).toContain("bg-report");
    const call = api.spsExportPage.mock.calls.find((c) => c[0] === "bg-report");
    expect(String(call?.[1])).toContain("Landed by ingest, never opened.");
  });

  it("re-mirrors only the pages that changed since the last save", async () => {
    useStore
      .getState()
      .makePageWithId(
        "diff-a",
        { icon: "📄", title: "Diff A" },
        [blk("p", "a")],
        null,
      );
    await flushAutosave();

    api.spsExportPage.mockClear();
    useStore.getState().renamePage("diff-a", "Diff A renamed");
    await flushAutosave();

    expect(exportedIds()).toEqual(["diff-a"]);
  });

  it("deletes the mirror file for a page removed from docs", async () => {
    useStore
      .getState()
      .makePageWithId(
        "doomed",
        { icon: "📄", title: "Doomed" },
        [blk("p", "x")],
        null,
      );
    await flushAutosave();

    const { docs, meta } = useStore.getState();
    const nextDocs = { ...docs };
    const nextMeta = { ...meta };
    delete nextDocs["doomed"];
    delete nextMeta["doomed"];
    useStore.setState({ docs: nextDocs, meta: nextMeta });
    await flushAutosave();

    expect(api.spsDeletePage).toHaveBeenCalledWith("doomed");
  });
});
