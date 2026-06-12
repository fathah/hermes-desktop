import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchSummary } from "../../../../../shared/searchSummary";

const store = vi.hoisted(() => ({
  selectPage: vi.fn(),
  setSurface: vi.fn(),
  setActiveChatSession: vi.fn(),
  openExternalConversation: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

// Icon pulls in an asset map we don't need for behaviour assertions.
vi.mock("../components/Icon", () => ({ Icon: () => null }));

import { AskPane } from "./AskPane";

type ChunkCb = (payload: { runId: string; text: string }) => void;

function installApi(opts: { stream: Promise<SearchSummary> }): {
  capturedChunkCb: () => ChunkCb | null;
  stream: ReturnType<typeof vi.fn>;
} {
  let chunkCb: ChunkCb | null = null;
  const stream = vi.fn().mockReturnValue(opts.stream);
  const api = {
    federatedSearch: vi.fn().mockResolvedValue([]),
    summarizeSearchStream: stream,
    onAskAnswerChunk: vi.fn((cb: ChunkCb) => {
      chunkCb = cb;
      return () => {};
    }),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return { capturedChunkCb: () => chunkCb, stream };
}

async function ask(query: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(/Search pages, transcripts/), {
    target: { value: query },
  });
  await act(async () => {
    fireEvent.submit(
      screen.getByRole("button", { name: /Ask|…/ }).closest("form")!,
    );
  });
}

describe("AskPane streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders streamed tokens live, ignores stale runIds, then shows sources", async () => {
    let resolveStream!: (s: SearchSummary) => void;
    const streamPromise = new Promise<SearchSummary>((r) => {
      resolveStream = r;
    });
    const { capturedChunkCb, stream } = installApi({ stream: streamPromise });

    render(<AskPane />);
    await ask("how do I deploy");

    const runId = stream.mock.calls[0][1] as string;
    const cb = capturedChunkCb();
    expect(cb).toBeTruthy();

    // A chunk tagged with the live runId renders incrementally…
    await act(async () => {
      cb!({ runId, text: "Deploy " });
      cb!({ runId, text: "with the script." });
    });
    expect(screen.getByText(/Deploy with the script\./)).toBeTruthy();

    // …a chunk from a stale (different) runId is ignored.
    await act(async () => {
      cb!({ runId: "stale", text: " IGNORED" });
    });
    expect(screen.queryByText(/IGNORED/)).toBeNull();

    // On resolve, the final summary + cited sources render.
    await act(async () => {
      resolveStream({
        summary: "Deploy with the script.",
        sources: [
          {
            sessionId: "sess-123456",
            title: "Deploy notes",
            startedAt: 0,
            snippet: "",
          },
        ],
      });
      await streamPromise;
    });
    expect(screen.getByText(/Deploy notes/)).toBeTruthy();
  });

  it("surfaces an error returned by the stream", async () => {
    installApi({
      stream: Promise.resolve({
        summary: "",
        sources: [],
        error: "Couldn’t reach My Assistant.",
      }),
    });
    render(<AskPane />);
    await act(async () => {
      await ask("anything");
    });
    expect(
      await screen.findByText(/Couldn’t reach My Assistant\./),
    ).toBeTruthy();
  });
});
