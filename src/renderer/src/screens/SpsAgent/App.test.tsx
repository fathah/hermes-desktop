import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const store = vi.hoisted(() => ({
  t: { sidebar: "full" },
  page: "home",
  panelOpen: false,
  surface: "doc",
  chatNonce: 0,
  setPanelOpen: vi.fn(),
  setSurface: vi.fn(),
  setTemplatesOpen: vi.fn(),
  setResearchOpen: vi.fn(),
  setScheduledOpen: vi.fn(),
  setPaletteOpen: vi.fn(),
  setTweaksOpen: vi.fn(),
  ingestCommitPage: vi.fn(),
  flash: vi.fn(),
}));

const componentCalls = vi.hoisted(() => ({
  onboarding: vi.fn(),
  whatsNew: vi.fn(),
}));

vi.mock("./store", () => {
  const useStore = Object.assign(
    (selector: (s: typeof store) => unknown): unknown => selector(store),
    { getState: (): typeof store => store },
  );
  return { useStore };
});

vi.mock("./hooks/useHotkeys", () => ({ useHotkeys: vi.fn() }));
vi.mock("./lib/scroll", () => ({ setScrollContainer: vi.fn() }));
vi.mock("../../lib/openSettings", () => ({ openSettings: vi.fn() }));

vi.mock("./sidebar/Sidebar", () => ({ Sidebar: () => <aside>Sidebar</aside> }));
vi.mock("./shell/Topbar", () => ({ Topbar: () => <header>Topbar</header> }));
vi.mock("./shell/DocHeader", () => ({
  DocHeader: ({ children }: { children?: ReactNode }) => (
    <section className="doc" data-testid="doc-header">
      <h1>Home</h1>
      {children}
    </section>
  ),
}));
vi.mock("./editor/Editor", () => ({
  Editor: () => <div data-testid="editor">Editor</div>,
}));
vi.mock("./panel/RightPanel", () => ({
  RightPanel: () => <aside>Panel</aside>,
}));
vi.mock("./shell/Overlays", () => ({ Overlays: () => null }));
vi.mock("./components/Toast", () => ({ Toast: () => null }));
vi.mock("./components/SaveStatus", () => ({ SaveStatus: () => null }));
vi.mock("./components/OcrStatus", () => ({ OcrStatus: () => null }));

vi.mock("./components/OnboardingChecklist", () => ({
  OnboardingChecklist: (props: { variant?: string }) => {
    componentCalls.onboarding(props);
    return (
      <div
        className={
          props.variant === "compact"
            ? "home-affordance-cluster"
            : "ob-checklist"
        }
        data-testid="onboarding-checklist"
        data-variant={props.variant ?? "card"}
      />
    );
  },
}));
vi.mock("./updates/WhatsNewPanel", () => ({
  WhatsNewPanel: (props: { variant?: string }) => {
    componentCalls.whatsNew(props);
    return (
      <section
        className={
          props.variant === "compact"
            ? "home-affordance-cluster"
            : "ob-checklist"
        }
        data-testid="whats-new-panel"
        data-variant={props.variant ?? "card"}
      />
    );
  },
}));

vi.mock("../Insights/Insights", () => ({ default: () => null }));
vi.mock("./you/MemoryTimeline", () => ({ MemoryTimeline: () => null }));
vi.mock("./shell/ChatSurface", () => ({ ChatSurface: () => null }));
vi.mock("./panel/AskPane", () => ({ AskPane: () => null }));
vi.mock("./graph/GraphView", () => ({ GraphView: () => null }));
vi.mock("./equity/EquityResearch", () => ({ EquityResearch: () => null }));
vi.mock("./journal/JournalSurface", () => ({ JournalSurface: () => null }));
vi.mock("./journal/MyWorkSurface", () => ({ MyWorkSurface: () => null }));
vi.mock("./you/YouSurface", () => ({ YouSurface: () => null }));
vi.mock("./learning/LearningSurface", () => ({ LearningSurface: () => null }));
vi.mock("./activeWork/ActiveWorkSurface", () => ({
  ActiveWorkSurface: () => null,
}));
vi.mock("./cockpit/CockpitSurface", () => ({ CockpitSurface: () => null }));
vi.mock("./inbox/InboxSurface", () => ({ InboxSurface: () => null }));
vi.mock("./health/HealthSurface", () => ({ HealthSurface: () => null }));
vi.mock("./review/ReviewQueueSurface", () => ({
  ReviewQueueSurface: () => null,
}));
vi.mock("./editor/ObsidianEditor", () => ({ ObsidianEditor: () => null }));
vi.mock("./health/PersonalHealthDashboard", () => ({
  PersonalHealthDashboard: () => null,
}));
vi.mock("./research/RssReaderDashboard", () => ({
  RssReaderDashboard: () => null,
}));
vi.mock("./components/Dashboard", () => ({ Dashboard: () => null }));
vi.mock("./content/ContentStudioSurface", () => ({
  ContentStudioSurface: () => null,
}));
vi.mock("./deck/DeckStudioSurface", () => ({ DeckStudioSurface: () => null }));

import { App } from "./App";

beforeEach(() => {
  componentCalls.onboarding.mockClear();
  componentCalls.whatsNew.mockClear();
  store.surface = "doc";
  store.panelOpen = false;
  store.page = "home";
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SpsAgent App doc surface", () => {
  it("keeps onboarding and what's-new affordances in one compact strip before the document", () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const { container } = render(<App />);

    const strip = container.querySelector(".home-affordance-strip");
    expect(strip).toBeInTheDocument();
    expect(screen.getByTestId("doc-header").previousElementSibling).toBe(strip);
    expect(screen.getByTestId("onboarding-checklist")).toHaveAttribute(
      "data-variant",
      "compact",
    );
    expect(screen.getByTestId("whats-new-panel")).toHaveAttribute(
      "data-variant",
      "compact",
    );
    expect(componentCalls.onboarding).toHaveBeenCalledWith({
      variant: "compact",
    });
    expect(componentCalls.whatsNew).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "compact" }),
    );
    expect(
      container.querySelectorAll(".doc-scroll > .ob-checklist"),
    ).toHaveLength(0);
    expect(intervalSpy).not.toHaveBeenCalled();
  });
});
