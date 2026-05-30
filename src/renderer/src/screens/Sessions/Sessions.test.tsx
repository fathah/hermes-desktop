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

function installHermesAPI(initialSessions: unknown[] = []): {
  listCachedSessions: ReturnType<typeof vi.fn>;
  syncSessionCache: ReturnType<typeof vi.fn>;
  searchSessions: ReturnType<typeof vi.fn>;
  updateSessionMetadata: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
} {
  const api = {
    listCachedSessions: vi.fn().mockResolvedValue(initialSessions),
    syncSessionCache: vi.fn().mockResolvedValue(initialSessions),
    searchSessions: vi.fn().mockResolvedValue([]),
    updateSessionMetadata: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
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

  it("updates conversation metadata from card controls", async () => {
    const sessions = [
      {
        id: "sess-abc-123",
        title: "First chat",
        startedAt: Math.floor(Date.now() / 1000),
        source: "api_server",
        messageCount: 3,
        model: "gpt-4",
        tags: [],
        pinned: false,
        archived: false,
      },
    ];
    const api = installHermesAPI(sessions);
    const promptSpy = vi.spyOn(window, "prompt");
    promptSpy.mockReturnValueOnce("Renamed chat");

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "sessions.rename" }));
    });
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "sessions.pin" }));
    });
    await act(async () => {});

    expect(api.updateSessionMetadata).toHaveBeenCalledWith("sess-abc-123", {
      title: "Renamed chat",
    });
    expect(api.updateSessionMetadata).toHaveBeenCalledWith("sess-abc-123", {
      pinned: true,
    });

    promptSpy.mockRestore();
  });
});
