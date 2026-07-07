import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNewPanel } from "./WhatsNewPanel";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("hermes-desktop-last-seen-version", "0.5.3");
  vi.stubGlobal("electron", { process: { platform: "darwin" } });
  vi.stubGlobal("hermesAPI", {
    getAppVersion: vi.fn().mockResolvedValue("0.5.4"),
    getHermesUpstreamWatchState: vi.fn().mockResolvedValue({
      lastRunAt: null,
      lastSeenCommit: null,
      lastSeenRelease: null,
      latestReportPath: null,
      classifiedCounts: {},
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WhatsNewPanel", () => {
  function mockEngineUpdate(): void {
    vi.mocked(window.hermesAPI.getHermesUpstreamWatchState).mockResolvedValue({
      lastRunAt: "2026-07-03T12:00:00.000Z",
      lastSeenCommit: "fed789",
      lastSeenRelease: "v2026.7.3",
      latestReportPath: "/tmp/upstream-watch/2026-07-03.md",
      classifiedCounts: { "contract-risk": 1 },
      anchorSha: "abc123",
      pendingCommitCount: 2,
      contractRiskCount: 1,
      availableUpdate: {
        range: "abc123..fed789",
        anchorSha: "abc123",
        headSha: "fed789",
        generatedAt: "2026-07-03T12:00:00.000Z",
        pendingCommitCount: 2,
        contractRiskCount: 1,
        cards: [
          {
            id: "engine-abc123-fed789-0",
            source: "engine",
            range: "abc123..fed789",
            title: "Gateway update available",
            body: "A pending Hermes Agent update changes gateway capability reporting.",
            cta: "Review update",
            action: { kind: "settings", view: "providers" },
          },
        ],
      },
    });
  }

  it("shows unseen affordances after an app version change", async () => {
    const { container } = render(<WhatsNewPanel onRunAction={vi.fn()} />);

    expect(
      await screen.findByText("Control Center AI readiness"),
    ).toBeInTheDocument();
    expect(container.querySelector(".ob-checklist")).toBeInTheDocument();
    expect(
      screen.getByText("Intentional narrow workspace"),
    ).toBeInTheDocument();
    expect(screen.getByText("Readable SPS dark theme")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Control Center" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Appearance" }),
    ).toBeInTheDocument();
  });

  it("routes each affordance CTA to the expected in-app target", async () => {
    const onRunAction = vi.fn();
    render(<WhatsNewPanel onRunAction={onRunAction} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Control Center" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Appearance" }));

    expect(onRunAction).toHaveBeenNthCalledWith(1, {
      kind: "settings",
      view: "overview",
    });
    expect(onRunAction).toHaveBeenNthCalledWith(2, {
      kind: "surface",
      surface: "doc",
    });
    expect(onRunAction).toHaveBeenNthCalledWith(3, {
      kind: "modal",
      modal: "tweaks",
    });
  });

  it("persists dismissal at the current version", async () => {
    render(<WhatsNewPanel onRunAction={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss what's new" }),
    );

    await waitFor(() =>
      expect(localStorage.getItem("hermes-desktop-last-seen-version")).toBe(
        "0.5.4",
      ),
    );
  });

  it("renders compact update actions without the full card", async () => {
    const { container } = render(
      <WhatsNewPanel onRunAction={vi.fn()} variant="compact" />,
    );

    expect(await screen.findByText("What's new in v0.5.4")).toBeInTheDocument();
    expect(container.querySelector(".ob-checklist")).toBeNull();
    expect(
      container.querySelector(".home-affordance-updates"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Control Center" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Appearance" }),
    ).toBeInTheDocument();
  });

  it("keeps compact CTA routing and dismissal", async () => {
    const onRunAction = vi.fn();
    render(<WhatsNewPanel onRunAction={onRunAction} variant="compact" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Control Center" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Appearance" }));

    expect(onRunAction).toHaveBeenNthCalledWith(1, {
      kind: "settings",
      view: "overview",
    });
    expect(onRunAction).toHaveBeenNthCalledWith(2, {
      kind: "surface",
      surface: "doc",
    });
    expect(onRunAction).toHaveBeenNthCalledWith(3, {
      kind: "modal",
      modal: "tweaks",
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss what's new" }));
    await waitFor(() =>
      expect(localStorage.getItem("hermes-desktop-last-seen-version")).toBe(
        "0.5.4",
      ),
    );
  });

  it("shows engine-only available update cards and dismisses by commit range", async () => {
    localStorage.setItem("hermes-desktop-last-seen-version", "0.5.4");
    mockEngineUpdate();
    const onRunAction = vi.fn();
    render(<WhatsNewPanel onRunAction={onRunAction} />);

    expect(
      await screen.findByText("Hermes Agent update available"),
    ).toBeInTheDocument();
    expect(screen.getByText("Gateway update available")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A pending Hermes Agent update changes gateway capability reporting.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review update" }));
    expect(onRunAction).toHaveBeenCalledWith({
      kind: "settings",
      view: "providers",
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss what's new" }));
    await waitFor(() =>
      expect(localStorage.getItem("hermes-engine-last-seen-update-range")).toBe(
        "abc123..fed789",
      ),
    );
  });

  it("shows release and engine cards together with available-update copy", async () => {
    mockEngineUpdate();
    render(<WhatsNewPanel onRunAction={vi.fn()} />);

    expect(
      await screen.findByText("What's new and available updates"),
    ).toBeInTheDocument();
    expect(screen.getByText("Control Center AI readiness")).toBeInTheDocument();
    expect(screen.getByText("Gateway update available")).toBeInTheDocument();
  });
});
