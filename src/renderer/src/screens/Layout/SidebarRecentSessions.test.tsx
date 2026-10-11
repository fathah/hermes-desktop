import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import SidebarRecentSessions, {
  needsForcedSessionSync,
} from "./SidebarRecentSessions";

// The list only needs `t` for section headers and row labels.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

interface CachedRow {
  id: string;
  title: string;
  contextFolder: string | null;
}

function installHermesAPI(rows: CachedRow[] = []): {
  listCachedSessions: ReturnType<typeof vi.fn>;
  syncSessionCache: ReturnType<typeof vi.fn>;
} {
  const api = {
    listCachedSessions: vi.fn().mockResolvedValue(rows),
    syncSessionCache: vi.fn().mockResolvedValue(rows),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

const baseProps = {
  open: true,
  connectionId: "connection-one",
  activeProfile: "work",
  resumingSessionId: null,
  onSelect: (): void => {},
  scrollRootRef: { current: null } as React.RefObject<HTMLDivElement | null>,
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("needsForcedSessionSync", () => {
  it("holds only for a live run whose session has no loaded row", () => {
    expect(needsForcedSessionSync("s1", [], new Set(["s1"]))).toBe(true);
    expect(needsForcedSessionSync("s1", [{ id: "s0" }], new Set(["s1"]))).toBe(
      true,
    );
    expect(needsForcedSessionSync("s1", [{ id: "s1" }], new Set(["s1"]))).toBe(
      false,
    );
  });

  it("does not hold for a resumed session that is simply past the loaded page", () => {
    expect(needsForcedSessionSync("s1", [{ id: "s0" }], new Set())).toBe(false);
  });

  it("does not hold without an open conversation", () => {
    expect(needsForcedSessionSync(null, [], new Set(["s1"]))).toBe(false);
  });

  // @lat: [[sidebar-navigation#Provisional fresh sessions#Bounded forced refresh]]
  it("does not force another read for an already attempted missing row", () => {
    expect(
      needsForcedSessionSync(
        "s1",
        [],
        new Set(["s1"]),
        new Set(["s1"]),
        new Set(["s1"]),
      ),
    ).toBe(false);
  });
});

describe("sidebar session cache sync (#980)", () => {
  it("syncs past the throttle and lists a session a live run just created", async () => {
    const api = installHermesAPI();
    let cached: CachedRow[] = [];
    api.syncSessionCache.mockImplementation(() => Promise.resolve(cached));

    const { rerender } = render(
      <SidebarRecentSessions
        {...baseProps}
        currentSessionId={null}
        loadingSessionIds={new Set()}
      />,
    );
    // Settle the opening cache read and sync, then let the throttle arm.
    await act(async () => {});
    const atMount = api.syncSessionCache.mock.calls.length;
    expect(atMount).toBeGreaterThan(0);
    expect(screen.queryByText("Look at the capabilities")).toBeNull();

    // The gateway hands out the session id and the first user message is stored,
    // so the forced sync finds a titled row.
    cached = [
      {
        id: "session-new",
        title: "Look at the capabilities",
        contextFolder: null,
      },
    ];
    rerender(
      <SidebarRecentSessions
        {...baseProps}
        currentSessionId="session-new"
        loadingSessionIds={new Set(["session-new"])}
      />,
    );

    await vi.waitFor(() =>
      expect(api.syncSessionCache.mock.calls.length).toBe(atMount + 1),
    );
    expect(await screen.findByText("Look at the capabilities")).toBeTruthy();
  });

  it("keeps the throttle when switching to a loaded session", async () => {
    const api = installHermesAPI([
      { id: "session-listed", title: "Listed", contextFolder: null },
    ]);

    const { rerender } = render(
      <SidebarRecentSessions
        {...baseProps}
        currentSessionId={null}
        loadingSessionIds={new Set()}
      />,
    );
    await act(async () => {});
    const atMount = api.syncSessionCache.mock.calls.length;
    expect(atMount).toBeGreaterThan(0);

    rerender(
      <SidebarRecentSessions
        {...baseProps}
        currentSessionId="session-listed"
        loadingSessionIds={new Set()}
      />,
    );

    expect(api.syncSessionCache.mock.calls.length).toBe(atMount);
  });

  // @lat: [[sidebar-navigation#Provisional fresh sessions#Fast first-turn completion]]
  it("lists a newly created session when its first turn completes before rendering", async () => {
    const api = installHermesAPI();
    let cached: CachedRow[] = [];
    api.syncSessionCache.mockImplementation(() => Promise.resolve(cached));
    const { rerender } = render(
      <SidebarRecentSessions
        {...baseProps}
        currentSessionId={null}
        loadingSessionIds={new Set()}
        createdSessionIds={new Set()}
      />,
    );
    await act(async () => {});
    const atMount = api.syncSessionCache.mock.calls.length;

    cached = [
      { id: "fast-session", title: "Quick answer", contextFolder: null },
    ];
    // React can batch session announcement and completion into this render,
    // leaving no intermediate loading session for the sidebar to observe.
    rerender(
      <SidebarRecentSessions
        {...baseProps}
        currentSessionId="fast-session"
        loadingSessionIds={new Set()}
        createdSessionIds={new Set(["fast-session"])}
      />,
    );
    expect(await screen.findByText("Quick answer")).toBeVisible();
    expect(api.syncSessionCache.mock.calls.length).toBe(atMount + 1);
  });

  it("does not repeatedly force a permanently absent created row when switching tabs", async () => {
    const api = installHermesAPI();
    const props = {
      ...baseProps,
      loadingSessionIds: new Set<string>(),
      createdSessionIds: new Set(["missing-session"]),
    };
    const { rerender } = render(
      <SidebarRecentSessions {...props} currentSessionId={null} />,
    );
    await act(async () => {});
    const atMount = api.syncSessionCache.mock.calls.length;
    rerender(
      <SidebarRecentSessions {...props} currentSessionId="missing-session" />,
    );
    await act(async () => {});
    expect(api.syncSessionCache.mock.calls.length).toBe(atMount + 1);
    rerender(<SidebarRecentSessions {...props} currentSessionId={null} />);
    rerender(
      <SidebarRecentSessions {...props} currentSessionId="missing-session" />,
    );
    await act(async () => {});
    expect(api.syncSessionCache.mock.calls.length).toBe(atMount + 1);
  });

  it("keeps the throttle when resuming a session past the loaded page", async () => {
    const api = installHermesAPI([
      { id: "session-first", title: "First", contextFolder: null },
    ]);

    const { rerender } = render(
      <SidebarRecentSessions
        {...baseProps}
        currentSessionId={null}
        loadingSessionIds={new Set()}
      />,
    );
    await act(async () => {});
    const atMount = api.syncSessionCache.mock.calls.length;
    expect(atMount).toBeGreaterThan(0);

    // An old conversation that is not in the loaded page: resuming it must not
    // turn every switch into a full state.db read.
    rerender(
      <SidebarRecentSessions
        {...baseProps}
        currentSessionId="session-deep"
        loadingSessionIds={new Set()}
      />,
    );

    expect(api.syncSessionCache.mock.calls.length).toBe(atMount);
  });
});
