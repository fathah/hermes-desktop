import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  setPaletteOpen: vi.fn(),
  selectPage: vi.fn(),
  tree: [{ id: "page-1", children: [] }],
  meta: {
    "page-1": {
      title: "Launch Notes",
      icon: "📝",
    },
  },
  docs: {
    "page-1": [{ id: "block-1", type: "p", text: "Existing page text" }],
  },
  page: "page-1",
  comments: {},
  trash: [],
  openPanelTab: vi.fn(),
  setTweak: vi.fn(),
  t: { dark: false, sidebar: "full" },
  setTemplatesOpen: vi.fn(),
  setTrashOpen: vi.fn(),
  resetWorkspace: vi.fn(),
  startNewChat: vi.fn(),
  setResearchOpen: vi.fn(),
  setExternalSessionsOpen: vi.fn(),
  setSurface: vi.fn(),
  flash: vi.fn(),
  openContentStudioIdea: vi.fn(),
  runAgent: vi.fn(),
  setTweaksOpen: vi.fn(),
}));

vi.mock("../store", () => {
  const useStore = Object.assign(
    (selector: (s: typeof store) => unknown) => selector(store),
    { getState: () => store },
  );
  return { useStore };
});

import { CommandPalette } from "./CommandPalette";

const api = {
  spsExportRow: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
  api.spsExportRow.mockResolvedValue(true);
  vi.spyOn(window, "getSelection").mockReturnValue({
    toString: () => "Selected proof that should become a draft angle.",
  } as Selection);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("CommandPalette", () => {
  it("opens Content Studio after saving selected workspace text as a content idea", async () => {
    render(<CommandPalette />);

    fireEvent.mouseDown(screen.getByText("Save selection as content idea"));

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-ideas",
        "content-idea-launch-notes",
        expect.stringContaining('type: "content-idea"'),
      ),
    );
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2] ?? "");
    expect(markdown).toContain("Selected proof that should become a draft angle.");
    expect(markdown).toContain('capturedFrom: "workspace-selection"');
    expect(store.openContentStudioIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Launch Notes",
        sourceUrls: [],
        angle: "Selected proof that should become a draft angle.",
        capturedFrom: "workspace-selection",
      }),
    );
  });
});
