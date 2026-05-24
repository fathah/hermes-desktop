import { act, render } from "@testing-library/react";
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
