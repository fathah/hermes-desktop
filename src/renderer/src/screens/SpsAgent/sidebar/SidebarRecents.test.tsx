import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stable store spies so we can assert resume/new-chat side effects. Hoisted so
// the vi.mock factory below can close over them.
const store = vi.hoisted(() => ({
  setSurface: vi.fn(),
  setActiveChatSession: vi.fn(),
  activeChatSession: null as string | null,
  startNewChat: vi.fn(),
}));

// SidebarRecents only reads four slices via `useStore((s) => s.x)` — mock the
// selector form directly so we don't drag in the whole SPS store import chain.
vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

import { SidebarRecents, searchHitToRow } from "./SidebarRecents";

interface Api {
  listSessions: ReturnType<typeof vi.fn>;
  searchSessions: ReturnType<typeof vi.fn>;
  updateSessionTitle: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
}

function installHermesAPI(opts: {
  recents?: unknown[];
  hits?: unknown[];
}): Api {
  const api: Api = {
    listSessions: vi.fn().mockResolvedValue(opts.recents ?? []),
    searchSessions: vi.fn().mockResolvedValue(opts.hits ?? []),
    updateSessionTitle: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

const recentRow = (id: string, title: string) => ({ id, title, preview: "" });
const searchHit = (sessionId: string, title: string, snippet: string) => ({
  sessionId,
  title,
  startedAt: 0,
  source: "chat",
  messageCount: 1,
  model: "x",
  snippet,
});

// Let the mount-time listSessions promise settle.
async function flush(): Promise<void> {
  await act(async () => {});
}
// Fire the debounced search timer and let searchSessions resolve.
async function flushSearch(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
}

describe("searchHitToRow", () => {
  it("maps sessionId→id and snippet→preview", () => {
    expect(
      searchHitToRow({ sessionId: "abc", title: "Hello", snippet: "world" }),
    ).toEqual({ id: "abc", title: "Hello", preview: "world" });
  });

  it("preserves a null title", () => {
    expect(
      searchHitToRow({ sessionId: "abc", title: null, snippet: "s" }),
    ).toEqual({ id: "abc", title: null, preview: "s" });
  });
});

describe("SidebarRecents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.setSurface.mockClear();
    store.setActiveChatSession.mockClear();
    store.startNewChat.mockClear();
    store.activeChatSession = null;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders the recent sessions from listSessions", async () => {
    installHermesAPI({
      recents: [recentRow("a", "First chat"), recentRow("b", "Second chat")],
    });
    render(<SidebarRecents />);
    await flush();
    expect(screen.getByText("First chat")).toBeTruthy();
    expect(screen.getByText("Second chat")).toBeTruthy();
    // With recents present, the search affordance is offered.
    expect(screen.getByLabelText("Search chats")).toBeTruthy();
  });

  it("searches all sessions (debounced) when a query is typed", async () => {
    const api = installHermesAPI({
      recents: [recentRow("a", "First chat")],
      hits: [searchHit("z", "Deep archived chat", "…match…")],
    });
    render(<SidebarRecents />);
    await flush();

    fireEvent.change(screen.getByLabelText("Search chats"), {
      target: { value: "deep" },
    });
    // Debounced — not called immediately.
    expect(api.searchSessions).not.toHaveBeenCalled();

    await flushSearch();
    expect(api.searchSessions).toHaveBeenCalledWith("deep", 25);
    expect(screen.getByText("Deep archived chat")).toBeTruthy();
    // The recents row is replaced by the search results.
    expect(screen.queryByText("First chat")).toBeNull();
  });

  it("shows an empty-search hint when no sessions match", async () => {
    installHermesAPI({ recents: [recentRow("a", "First chat")], hits: [] });
    render(<SidebarRecents />);
    await flush();
    fireEvent.change(screen.getByLabelText("Search chats"), {
      target: { value: "nomatch" },
    });
    await flushSearch();
    expect(screen.getByText("No matching chats")).toBeTruthy();
  });

  it("resumes a session on row click", async () => {
    installHermesAPI({ recents: [recentRow("a", "First chat")] });
    render(<SidebarRecents />);
    await flush();
    fireEvent.click(screen.getByText("First chat"));
    expect(store.setActiveChatSession).toHaveBeenCalledWith("a", "First chat");
    expect(store.setSurface).toHaveBeenCalledWith("chats");
  });

  it("clearing the query returns to the recents view", async () => {
    installHermesAPI({
      recents: [recentRow("a", "First chat")],
      hits: [searchHit("z", "Archived", "x")],
    });
    render(<SidebarRecents />);
    await flush();
    fireEvent.change(screen.getByLabelText("Search chats"), {
      target: { value: "arch" },
    });
    await flushSearch();
    expect(screen.getByText("Archived")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Clear search"));
    await flush();
    expect(screen.getByText("First chat")).toBeTruthy();
    expect(screen.queryByText("Archived")).toBeNull();
  });
});
