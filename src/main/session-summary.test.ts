import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the two collaborators so this test never drags in the electron /
// better-sqlite3 chain behind `./hermes` and `./sessions`.
vi.mock("./sessions", () => ({ searchSessions: vi.fn() }));
vi.mock("./hermes", () => ({
  chatCompletionOnce: vi.fn(),
  chatCompletionStream: vi.fn(),
}));

import { summarizeSearchStream } from "./session-summary";
import { searchSessions } from "./sessions";
import { chatCompletionStream } from "./hermes";

const mockSearch = searchSessions as unknown as ReturnType<typeof vi.fn>;
const mockStream = chatCompletionStream as unknown as ReturnType<typeof vi.fn>;

describe("summarizeSearchStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves empty without calling the model for a blank query", async () => {
    const onChunk = vi.fn();
    const res = await summarizeSearchStream("   ", onChunk);
    expect(res).toEqual({ summary: "", sources: [] });
    expect(mockStream).not.toHaveBeenCalled();
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("resolves empty (no model call) when there are no search hits", async () => {
    mockSearch.mockReturnValue([]);
    const res = await summarizeSearchStream("anything", vi.fn());
    expect(res).toEqual({ summary: "", sources: [] });
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("streams chunks through onChunk and resolves the accumulated summary + sources", async () => {
    mockSearch.mockReturnValue([
      { sessionId: "s1", title: "T1", startedAt: 1, snippet: "snip" },
    ]);
    mockStream.mockImplementation(
      (
        _messages: unknown,
        cb: {
          onChunk: (t: string) => void;
          onDone: () => void;
          onError: (e: string) => void;
        },
      ) => {
        cb.onChunk("Hello ");
        cb.onChunk("world");
        cb.onDone();
        return { abort: () => {} };
      },
    );
    const onChunk = vi.fn();
    const res = await summarizeSearchStream("q", onChunk);
    expect(onChunk.mock.calls.map((c) => c[0])).toEqual(["Hello ", "world"]);
    expect(res.summary).toBe("Hello world");
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0].sessionId).toBe("s1");
    expect(res.error).toBeUndefined();
  });

  it("resolves with the partial text + error when the stream errors", async () => {
    mockSearch.mockReturnValue([
      { sessionId: "s1", title: null, startedAt: 1, snippet: "snip" },
    ]);
    mockStream.mockImplementation(
      (
        _messages: unknown,
        cb: { onChunk: (t: string) => void; onError: (e: string) => void },
      ) => {
        cb.onChunk("partial");
        cb.onError("boom");
        return { abort: () => {} };
      },
    );
    const res = await summarizeSearchStream("q", vi.fn());
    expect(res.summary).toBe("partial");
    expect(res.error).toBe("boom");
  });
});
