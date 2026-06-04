import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useI18n needs an I18nProvider; the Sessions tab only uses `t` for labels,
// so a pass-through mock keeps these tests focused on the refresh behaviour.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {},
  }),
}));

import Sessions, { SESSIONS_REFRESH_MS } from "./Sessions";

const baseProps = {
  onResumeSession: (): void => {},
  onNewChat: (): void => {},
  currentSessionId: null,
};

function installHermesAPI(initialSessions: unknown[] = []): {
  listCachedSessions: ReturnType<typeof vi.fn>;
  syncSessionCache: ReturnType<typeof vi.fn>;
  searchSessions: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
  deleteSessions: ReturnType<typeof vi.fn>;
} {
  const api = {
    listCachedSessions: vi.fn().mockResolvedValue(initialSessions),
    syncSessionCache: vi.fn().mockResolvedValue(initialSessions),
    searchSessions: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteSessions: vi.fn().mockResolvedValue({ requested: 0, deleted: 0 }),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

function sessionSearchResult(
  title: string | null,
  snippet: string,
  sessionId?: string,
): {
  sessionId: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  snippet: string;
} {
  return {
    sessionId:
      sessionId ??
      (title ?? snippet)
        .replace(/<</g, "")
        .replace(/>>/g, "")
        .toLowerCase()
        .replace(/\s+/g, "-"),
    title,
    startedAt: Math.floor(Date.now() / 1000),
    source: "desktop",
    messageCount: 1,
    model: "gpt-5.5",
    snippet,
  };
}

describe("Sessions tab live refresh (#322)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-syncs from state.db on an interval while the tab is visible", async () => {
    const api = installHermesAPI();
    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const afterMount = api.syncSessionCache.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS);
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterMount + 1);

    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS);
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterMount + 2);
  });

  it("runs no timer while the tab is hidden", async () => {
    const api = installHermesAPI();
    render(<Sessions {...baseProps} visible={false} />);
    await act(async () => {});

    const afterMount = api.syncSessionCache.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS * 5);
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterMount);
  });

  it("stops the timer once the tab becomes hidden", async () => {
    const api = installHermesAPI();
    const view = render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await act(async () => {
      view.rerender(<Sessions {...baseProps} visible={false} />);
    });
    const afterHide = api.syncSessionCache.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS * 3);
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterHide);
  });

  it("refreshes when the window regains focus", async () => {
    const api = installHermesAPI();
    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const afterMount = api.syncSessionCache.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterMount + 1);
  });

  it("renders sessions recovered by sync when the fast cache starts empty", async () => {
    vi.useRealTimers();
    const api = installHermesAPI();
    api.syncSessionCache.mockResolvedValue([
      {
        id: "recovered-session",
        title: "Recovered older conversation",
        startedAt: Math.floor(Date.now() / 1000),
        source: "desktop",
        messageCount: 4,
        model: "gpt-5.5",
      },
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByText("Recovered older conversation")).toBeTruthy();
    });
    expect(screen.queryByText("sessions.empty")).toBeNull();
  });

  it("ignores stale search results from earlier keystrokes", async () => {
    const api = installHermesAPI();
    let resolveBroadSearch:
      | ((value: ReturnType<typeof sessionSearchResult>[]) => void)
      | undefined;
    api.searchSessions.mockImplementation((query: string) => {
      if (query === "h") {
        return new Promise((resolve) => {
          resolveBroadSearch = resolve;
        });
      }
      if (query === "hello") {
        return Promise.resolve([
          sessionSearchResult("Hello match", "<<hello>>"),
        ]);
      }
      return Promise.resolve([]);
    });

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const search = screen.getByPlaceholderText("sessions.searchPlaceholder");
    fireEvent.change(search, { target: { value: "h" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.change(search, { target: { value: "hello" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => {});
    expect(screen.getByText("Hello match")).toBeTruthy();

    await act(async () => {
      resolveBroadSearch?.([
        sessionSearchResult("Broad h match", "<<hermes>>"),
      ]);
    });

    expect(screen.getByText("Hello match")).toBeTruthy();
    expect(screen.queryByText("Broad h match")).toBeNull();
  });

  it("uses matched text as the visible title for untitled search results", async () => {
    vi.useRealTimers();
    const api = installHermesAPI();
    api.searchSessions.mockResolvedValue([
      sessionSearchResult(
        null,
        "<<Live PR499>> smoke test. Reply exactly: OK",
        "session-722999",
      ),
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const search = screen.getByPlaceholderText("sessions.searchPlaceholder");
    fireEvent.change(search, { target: { value: "Live PR499" } });

    await waitFor(() => {
      expect(screen.getByText(/smoke test\. Reply exactly: OK/)).toBeTruthy();
    });
    expect(screen.queryByText("sessions.title 722999")).toBeNull();
  });

  it("does not repopulate search results after clearing the input", async () => {
    const api = installHermesAPI();
    let resolveSearch:
      | ((value: ReturnType<typeof sessionSearchResult>[]) => void)
      | undefined;
    api.searchSessions.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const search = screen.getByPlaceholderText("sessions.searchPlaceholder");
    fireEvent.change(search, { target: { value: "hello" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.click(screen.getByRole("button", { name: "" }));

    await act(async () => {
      resolveSearch?.([sessionSearchResult("Late hello", "<<hello>>")]);
    });

    expect(search).toHaveProperty("value", "");
    expect(screen.queryByText("Late hello")).toBeNull();
    expect(screen.queryByText("sessions.empty")).toBeTruthy();
  });
});

describe("Sessions tab — delete affordance (#408)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("calls deleteSession when the trash button is clicked + confirmed", async () => {
    const sessions = [
      {
        id: "sess-abc-123",
        title: "First chat",
        startedAt: Math.floor(Date.now() / 1000),
        source: "api_server",
        messageCount: 3,
        model: "gpt-4",
      },
    ];
    const api = installHermesAPI(sessions);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const deleteBtn = screen.getByRole("button", {
      name: "sessions.delete",
    });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "sessions.deleteConfirm",
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "sessions.deleteConfirmAction",
        }),
      );
    });

    expect(api.deleteSession).toHaveBeenCalledWith("sess-abc-123");
  });

  it("does NOT call deleteSession when the confirm is cancelled", async () => {
    const sessions = [
      {
        id: "sess-abc-123",
        title: "First chat",
        startedAt: Math.floor(Date.now() / 1000),
        source: "api_server",
        messageCount: 3,
        model: "gpt-4",
      },
    ];
    const api = installHermesAPI(sessions);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const deleteBtn = screen.getByRole("button", {
      name: "sessions.delete",
    });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteCancel" }),
      );
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.deleteSession).not.toHaveBeenCalled();
  });

  it("stops click propagation so the card's resume handler doesn't fire", async () => {
    // Regression: the trash button is nested inside a clickable card.
    // Clicking trash must NOT also resume the session (would open the chat
    // the user is trying to delete).
    const sessions = [
      {
        id: "sess-abc-123",
        title: "First chat",
        startedAt: Math.floor(Date.now() / 1000),
        source: "api_server",
        messageCount: 3,
        model: "gpt-4",
      },
    ];
    installHermesAPI(sessions);
    const onResume = vi.fn();

    render(
      <Sessions {...baseProps} onResumeSession={onResume} visible={true} />,
    );
    await act(async () => {});

    const deleteBtn = screen.getByRole("button", {
      name: "sessions.delete",
    });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(onResume).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Sessions tab — bulk delete selection (#490)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes the selected sessions after confirmation", async () => {
    const sessions = [
      {
        id: "sess-one",
        title: "First chat",
        startedAt: Math.floor(Date.now() / 1000),
        source: "api_server",
        messageCount: 3,
        model: "gpt-4",
      },
      {
        id: "sess-two",
        title: "Second chat",
        startedAt: Math.floor(Date.now() / 1000),
        source: "api_server",
        messageCount: 1,
        model: "gpt-4",
      },
      {
        id: "sess-three",
        title: "Third chat",
        startedAt: Math.floor(Date.now() / 1000),
        source: "api_server",
        messageCount: 2,
        model: "gpt-4",
      },
    ];
    const api = installHermesAPI(sessions);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.selectMode" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("First chat"));
      fireEvent.click(screen.getByText("Second chat"));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteSelected" }),
      );
    });

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "sessions.deleteSelectedConfirm",
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "sessions.deleteConfirmAction",
        }),
      );
    });

    await waitFor(() => {
      expect(api.deleteSessions).toHaveBeenCalledWith([
        "sess-one",
        "sess-two",
      ]);
    });
    expect(api.deleteSession).not.toHaveBeenCalled();
  });

  it("selects only visible search results", async () => {
    const api = installHermesAPI([
      {
        id: "main-session",
        title: "Main chat",
        startedAt: Math.floor(Date.now() / 1000),
        source: "api_server",
        messageCount: 1,
        model: "gpt-4",
      },
    ]);
    api.searchSessions.mockResolvedValue([
      sessionSearchResult("Search one", "<<bulk>> one"),
      sessionSearchResult("Search two", "<<bulk>> two"),
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const search = screen.getByPlaceholderText("sessions.searchPlaceholder");
    fireEvent.change(search, { target: { value: "bulk" } });
    await waitFor(() => {
      expect(screen.getByText("Search one")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.selectMode" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.selectVisible" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteSelected" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "sessions.deleteConfirmAction",
        }),
      );
    });

    await waitFor(() => {
      expect(api.deleteSessions).toHaveBeenCalledWith([
        "search-one",
        "search-two",
      ]);
    });
    expect(api.deleteSessions).not.toHaveBeenCalledWith(["main-session"]);
  });

  it("does not delete selected sessions when the bulk confirm is cancelled", async () => {
    const sessions = [
      {
        id: "sess-one",
        title: "First chat",
        startedAt: Math.floor(Date.now() / 1000),
        source: "api_server",
        messageCount: 3,
        model: "gpt-4",
      },
    ];
    const api = installHermesAPI(sessions);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.selectMode" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("First chat"));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteSelected" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteCancel" }),
      );
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.deleteSessions).not.toHaveBeenCalled();
  });
});
