import { act, fireEvent, render, screen } from "@testing-library/react";
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

function installHermesAPI(): {
  listCachedSessions: ReturnType<typeof vi.fn>;
  syncSessionCache: ReturnType<typeof vi.fn>;
  searchSessions: ReturnType<typeof vi.fn>;
} {
  const api = {
    listCachedSessions: vi.fn().mockResolvedValue([]),
    syncSessionCache: vi.fn().mockResolvedValue([]),
    searchSessions: vi.fn().mockResolvedValue([]),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
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
});

describe("Sessions search race (#387)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("discards stale results when the query is cleared before the request resolves", async () => {
    const api = installHermesAPI();
    let resolveSearch!: (results: unknown[]) => void;
    api.searchSessions.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "abc" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });

    await act(async () => {
      resolveSearch([
        {
          sessionId: "stale",
          title: "stale-result",
          startedAt: 1_700_000_000,
          source: "desktop",
          messageCount: 1,
          model: "gpt-4",
          snippet: "",
        },
      ]);
    });

    expect(screen.queryByText("stale-result")).not.toBeInTheDocument();
  });

  it("shows the date-grouped list after clearing search", async () => {
    const api = installHermesAPI();
    const session = {
      id: "session-1",
      title: "My chat",
      startedAt: Math.floor(Date.now() / 1000),
      source: "desktop",
      messageCount: 3,
      model: "gpt-4",
    };
    api.listCachedSessions.mockResolvedValue([session]);
    api.syncSessionCache.mockResolvedValue([session]);
    api.searchSessions.mockResolvedValue([
      {
        sessionId: "session-1",
        title: "My chat",
        startedAt: session.startedAt,
        source: "desktop",
        messageCount: 3,
        model: "gpt-4",
        snippet: "matched <<abc>>",
      },
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "abc" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("abc")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    await act(async () => {});

    expect(screen.getByText("My chat")).toBeInTheDocument();
    expect(screen.getByText("sessions.today")).toBeInTheDocument();
    expect(screen.queryByText("abc")).not.toBeInTheDocument();
  });

  it("does not show abc results after switching to fff when abc resolves late", async () => {
    const api = installHermesAPI();
    let resolveAbc!: (results: unknown[]) => void;
    api.searchSessions.mockImplementation((query: string) => {
      if (query === "abc") {
        return new Promise((resolve) => {
          resolveAbc = resolve;
        });
      }
      return Promise.resolve([
        {
          sessionId: "session-fff",
          title: "fff-result",
          startedAt: 1_700_000_100,
          source: "desktop",
          messageCount: 1,
          model: "gpt-4",
          snippet: "",
        },
      ]);
    });

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "abc" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.change(input, { target: { value: "fff" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("fff-result")).toBeInTheDocument();
    expect(screen.queryByText("abc-result")).not.toBeInTheDocument();

    await act(async () => {
      resolveAbc([
        {
          sessionId: "session-abc",
          title: "abc-result",
          startedAt: 1_700_000_000,
          source: "desktop",
          messageCount: 1,
          model: "gpt-4",
          snippet: "",
        },
      ]);
    });
    expect(screen.getByText("fff-result")).toBeInTheDocument();
    expect(screen.queryByText("abc-result")).not.toBeInTheDocument();
  });

  it("clears previous results as soon as the query changes", async () => {
    const api = installHermesAPI();
    api.searchSessions.mockImplementation(async (query: string) => {
      if (query === "abc") {
        return [
          {
            sessionId: "session-abc",
            title: "abc-result",
            startedAt: 1_700_000_000,
            source: "desktop",
            messageCount: 1,
            model: "gpt-4",
            snippet: "",
          },
        ];
      }
      return [
        {
          sessionId: "session-fff",
          title: "fff-result",
          startedAt: 1_700_000_100,
          source: "desktop",
          messageCount: 1,
          model: "gpt-4",
          snippet: "",
        },
      ];
    });

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "abc" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("abc-result")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "fff" } });
    expect(screen.queryByText("abc-result")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("fff-result")).toBeInTheDocument();
  });
});
