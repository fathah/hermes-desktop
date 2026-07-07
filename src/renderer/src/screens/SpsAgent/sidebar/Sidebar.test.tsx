import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  tree: [],
  meta: {},
  page: "home",
  surface: "doc",
  t: { homeSurface: "doc", sidebar: "full" },
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
  importPdf: vi.fn(),
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

  it("shows the core loop by default", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByText("Cockpit"));
    fireEvent.click(screen.getByText("Capture"));
    fireEvent.click(screen.getByText("Work"));
    fireEvent.click(screen.getByText("Assistant"));

    expect(screen.getByText("Workspace packs")).toBeTruthy();
    expect(screen.queryByText("Content Studio")).toBeNull();
    expect(store.setSurface).toHaveBeenCalledWith("cockpit");
    expect(store.setSurface).toHaveBeenCalledWith("inbox");
    expect(store.setSurface).toHaveBeenCalledWith("work");
    expect(store.setSurface).toHaveBeenCalledWith("chats");
  });

  it("exposes operator surfaces without pack opt-in", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Journal" }));
    fireEvent.click(screen.getByRole("button", { name: "Active Work" }));
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));

    expect(store.setSurface).toHaveBeenCalledWith("journal");
    expect(store.setSurface).toHaveBeenCalledWith("activeWork");
    expect(store.setSurface).toHaveBeenCalledWith("memory");
  });

  it("labels primary rail actions for icon-only mode", () => {
    render(<Sidebar />);

    for (const label of [
      "Search",
      "Home",
      "Cockpit",
      "Capture",
      "Work",
      "Assistant",
      "Journal",
      "Active Work",
      "Memory",
    ]) {
      const button = screen.getByRole("button", { name: label });
      expect(button.getAttribute("title")).toBe(label);
      expect(button.getAttribute("aria-label")).toBe(label);
    }
  });
});
