import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBar } from "./StatusBar";
import type { SessionUsage } from "./sessionUsage";
import { profileEditorFixture } from "../../test/profileEditorFixture";

const usage: SessionUsage = {
  contextTokens: 38_200,
  contextWindow: 200_000,
  promptTokens: 120_000,
  completionTokens: 8_400,
  totalTokens: 128_400,
};

async function renderBar(
  sessionUsage?: SessionUsage | null,
): Promise<ReturnType<typeof render>> {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <StatusBar activeProfile="default" sessionUsage={sessionUsage} />,
    );
  });
  return result;
}

describe("StatusBar session usage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        ...profileEditorFixture("remote").api,
        listProfiles: vi.fn().mockResolvedValue([
          {
            id: "default",
            isActive: true,
            gatewayRunning: true,
            model: "gpt-x",
            skillCount: 3,
          },
        ]),
        getConnectionConfig: vi.fn().mockResolvedValue({ mode: "remote" }),
      },
    });
  });

  it("shows context and token totals with a detailed tooltip", async () => {
    await renderBar(usage);
    const chip = screen.getByText("ctx 38.2k/200k · 19% · ↑120k ↓8.4k");
    expect(chip.getAttribute("title")).toContain(
      "Context: 38,200 of 200,000 tokens (19%)",
    );
    expect(chip.className).not.toContain("status-usage-warn");
  });

  it("highlights a nearly full context", async () => {
    await renderBar({ ...usage, contextTokens: 190_000 });
    const chip = screen.getByText(/^ctx 190k\/200k · 95%/);
    expect(chip.className).toContain("status-usage-warn");
  });

  it("renders no usage chip when there is no usage", async () => {
    await renderBar(null);
    expect(screen.queryByText(/ctx /)).toBeNull();
    await renderBar();
    expect(screen.queryByText(/ctx /)).toBeNull();
  });

  it("still shows the existing gateway, mode and model chips", async () => {
    await renderBar(usage);
    expect(screen.getByText("gateway")).toBeTruthy();
    expect(screen.getByText("remote")).toBeTruthy();
    expect(screen.getByText("gpt-x")).toBeTruthy();
  });
});

// @lat: [[model-context#Tests#Status metadata rejects superseded reads]]
it("binds model/mode metadata to the captured connection and profile", async () => {
  const scope = profileEditorFixture("remote");
  scope.change("a");
  let resolve!: (rows: Record<string, unknown>[]) => void;
  const listProfiles = vi
    .fn()
    .mockReturnValueOnce(
      new Promise<Record<string, unknown>[]>((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValue([
      { id: "work", model: "new-model", gatewayRunning: false, skillCount: 7 },
    ]);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { ...scope.api, listProfiles },
  });
  const view = render(<StatusBar activeProfile="default" connectionId="a" />);
  await waitFor(() =>
    expect(listProfiles).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "a", profile: "default" }),
    ),
  );
  await act(async () => {
    scope.change("b", "ssh");
    view.rerender(<StatusBar activeProfile="work" connectionId="b" />);
  });
  await screen.findByText("new-model");
  expect(screen.getByText("ssh")).toBeTruthy();
  await act(async () =>
    resolve([
      {
        id: "default",
        model: "old-model",
        gatewayRunning: true,
        skillCount: 3,
      },
    ]),
  );
  expect(screen.queryByText("old-model")).toBeNull();
  expect(screen.getByText("new-model")).toBeTruthy();
});

// @lat: [[model-context#Tests#Missing profile metadata stays unknown]]
it("keeps missing-profile usage without borrowing another active profile's metadata", async () => {
  const scope = profileEditorFixture("remote");
  scope.change("a");
  const listProfiles = vi.fn().mockResolvedValue([
    {
      id: "default",
      isActive: true,
      model: "other-profile-model",
      gatewayRunning: true,
      skillCount: 7,
    },
  ]);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { ...scope.api, listProfiles },
  });
  await act(async () => {
    render(
      <StatusBar activeProfile="work" connectionId="a" sessionUsage={usage} />,
    );
  });
  expect(listProfiles).toHaveBeenCalledWith(
    expect.objectContaining({ connectionId: "a", profile: "work" }),
  );
  expect(screen.queryByText("other-profile-model")).toBeNull();
  expect(screen.queryByText("gateway")).toBeNull();
  expect(screen.queryByText("offline")).toBeNull();
  expect(screen.getByText("ctx 38.2k/200k · 19% · ↑120k ↓8.4k")).toBeTruthy();
});

// @lat: [[model-context#Tests#Current profile removal clears metadata]]
it("clears prior metadata when a current poll no longer finds the requested profile", async () => {
  const scope = profileEditorFixture("remote");
  scope.change("a");
  const listProfiles = vi
    .fn()
    .mockResolvedValueOnce([
      {
        id: "work",
        isActive: true,
        model: "removed-profile-model",
        gatewayRunning: true,
        skillCount: 7,
      },
    ])
    .mockResolvedValue([]);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { ...scope.api, listProfiles },
  });
  let poll: (() => void) | undefined;
  const interval = vi
    .spyOn(window, "setInterval")
    .mockImplementation((handler) => {
      if (typeof handler === "function") poll = () => handler();
      return 1;
    });
  try {
    render(
      <StatusBar activeProfile="work" connectionId="a" sessionUsage={usage} />,
    );
    await screen.findByText("removed-profile-model");
    expect(poll).toBeDefined();
    await act(async () => poll?.());
    expect(listProfiles).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("removed-profile-model")).toBeNull();
    expect(screen.queryByText("gateway")).toBeNull();
    expect(screen.queryByText("offline")).toBeNull();
    expect(screen.getByText("ctx 38.2k/200k · 19% · ↑120k ↓8.4k")).toBeTruthy();
  } finally {
    interval.mockRestore();
  }
});

function delayedRows(): {
  promise: Promise<Record<string, unknown>[]>;
  resolve: (rows: Record<string, unknown>[]) => void;
} {
  let resolve!: (rows: Record<string, unknown>[]) => void;
  return {
    promise: new Promise((done) => {
      resolve = done;
    }),
    resolve,
  };
}

// @lat: [[model-context#Tests#Slow status reads finish before another poll]]
it.each(["remote", "ssh"] as const)(
  "accepts a slow %s metadata read after multiple poll ticks and then resumes polling",
  async (mode) => {
    vi.useFakeTimers();
    const scope = profileEditorFixture(mode);
    scope.change("a");
    const slow = delayedRows();
    const listProfiles = vi
      .fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue([]);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { ...scope.api, listProfiles },
    });
    try {
      render(<StatusBar activeProfile="work" connectionId="a" />);
      await act(async () => vi.advanceTimersByTimeAsync(0));
      await act(async () => vi.advanceTimersByTimeAsync(12000));
      expect(screen.queryByText("slow-model")).toBeNull();
      await act(async () =>
        slow.resolve([
          {
            id: "work",
            model: "slow-model",
            gatewayRunning: true,
            skillCount: 4,
          },
        ]),
      );
      expect(screen.getByText("slow-model")).toBeInTheDocument();
      expect(screen.getByText(mode)).toBeInTheDocument();
      expect(screen.getByText("4 skills")).toBeInTheDocument();
      expect(listProfiles).toHaveBeenCalledTimes(1);
      listProfiles.mockResolvedValue([
        {
          id: "work",
          model: "next-model",
          gatewayRunning: false,
          skillCount: 5,
        },
      ]);
      await act(async () => vi.advanceTimersByTimeAsync(4000));
      expect(listProfiles).toHaveBeenCalledTimes(2);
      expect(screen.getByText("next-model")).toBeInTheDocument();
      expect(screen.getByText("offline")).toBeInTheDocument();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  },
);

// @lat: [[model-context#Tests#Slow status replies cannot cross authority lifetimes]]
it.each(["connection", "profile", "private revision"] as const)(
  "starts a new read while a slow old read is pending after a %s change",
  async (change) => {
    vi.useFakeTimers();
    const scope = profileEditorFixture("remote");
    scope.change("a");
    const old = delayedRows();
    const nextProfile = change === "profile" ? "next" : "work";
    const listProfiles = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue([
        { id: nextProfile, model: "current-model", gatewayRunning: false },
      ]);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { ...scope.api, listProfiles },
    });
    try {
      const view = render(<StatusBar activeProfile="work" connectionId="a" />);
      await act(async () => vi.advanceTimersByTimeAsync(0));
      await act(async () => vi.advanceTimersByTimeAsync(12000));
      await act(async () => {
        if (change !== "profile")
          scope.change(change === "connection" ? "b" : "a");
        view.rerender(
          <StatusBar
            activeProfile={nextProfile}
            connectionId={change === "connection" ? "b" : "a"}
          />,
        );
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("current-model")).toBeInTheDocument();
      expect(listProfiles).toHaveBeenLastCalledWith(
        expect.objectContaining({
          connectionId: change === "connection" ? "b" : "a",
          profile: nextProfile,
        }),
      );
      await act(async () =>
        old.resolve([
          { id: "work", model: "obsolete-model", gatewayRunning: true },
        ]),
      );
      expect(screen.queryByText("obsolete-model")).toBeNull();
      expect(screen.getByText("current-model")).toBeInTheDocument();
      expect(screen.queryByText("gateway")).toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  },
);

// @lat: [[model-context#Tests#Failed status reads release the poll slot]]
it("resumes polling after a slow request rejects without clearing conversation usage", async () => {
  vi.useFakeTimers();
  const scope = profileEditorFixture("remote");
  scope.change("a");
  let reject!: (error: Error) => void;
  const listProfiles = vi
    .fn()
    .mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    )
    .mockResolvedValue([
      { id: "work", model: "recovered-model", gatewayRunning: true },
    ]);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { ...scope.api, listProfiles },
  });
  try {
    render(
      <StatusBar activeProfile="work" connectionId="a" sessionUsage={usage} />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => vi.advanceTimersByTimeAsync(12000));
    expect(listProfiles).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("recovered-model")).toBeNull();
    await act(async () => reject(new Error("temporary remote failure")));
    expect(screen.queryByText("gateway")).toBeNull();
    expect(screen.queryByText("offline")).toBeNull();
    expect(
      screen.getByText("ctx 38.2k/200k · 19% · ↑120k ↓8.4k"),
    ).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(listProfiles).toHaveBeenCalledTimes(2);
    expect(screen.getByText("recovered-model")).toBeInTheDocument();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
