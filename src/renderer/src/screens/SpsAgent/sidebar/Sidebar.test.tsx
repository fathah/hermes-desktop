import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  tree: [],
  meta: {},
  page: "home",
  surface: "doc",
  t: { homeSurface: "doc" },
  sectionsEnabled: {
    aiAssistant: true,
    workspaceTools: false,
    recents: false,
    private: false,
  },
  sectionsOpen: {
    aiAssistant: true,
    workspaceTools: false,
    recents: false,
    private: false,
  },
  setSurface: vi.fn(),
  selectPage: vi.fn(),
  openJournal: vi.fn(),
  startNewChat: vi.fn(),
  setResearchOpen: vi.fn(),
  setScheduledOpen: vi.fn(),
  setAgentTasksOpen: vi.fn(),
  newSubPage: vi.fn(),
  renamePage: vi.fn(),
  deletePage: vi.fn(),
  movePage: vi.fn(),
  setPaletteOpen: vi.fn(),
  setTemplatesOpen: vi.fn(),
  setTrashOpen: vi.fn(),
  setTweaksOpen: vi.fn(),
  setTweak: vi.fn(),
  toggleSection: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

vi.mock("../hooks/useNoteIndex", () => ({
  useVaultQuery: () => ({ rows: [] }),
}));

vi.mock("./SidebarRecents", () => ({ SidebarRecents: () => null }));
vi.mock("./TreeNode", () => ({ TreeNode: () => null }));
vi.mock("./ObsidianExplorer", () => ({ ObsidianExplorer: () => null }));
vi.mock("./StatusChip", () => ({ StatusChip: () => null }));
vi.mock("../../../lib/openSettings", () => ({ openSettings: vi.fn() }));

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    store.setSurface.mockClear();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { listProfiles: vi.fn().mockResolvedValue([]) },
    });
  });

  afterEach(() => {
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("shows Learn This under My Assistant", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByText("Learn This"));

    expect(screen.getByText("My Assistant")).toBeTruthy();
    expect(store.setSurface).toHaveBeenCalledWith("learning");
  });
});
