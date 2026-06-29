import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHotkeys } from "./useHotkeys";

const store = vi.hoisted(() => ({
  panelOpen: false,
  paletteOpen: false,
  t: { sidebar: "full" },
  startNewChat: vi.fn(),
  setTweak: vi.fn((key: string, value: string) => {
    if (key === "sidebar") store.t.sidebar = value;
  }),
  setPanelOpen: vi.fn((value: boolean) => {
    store.panelOpen = value;
  }),
  setPaletteOpen: vi.fn((value: boolean) => {
    store.paletteOpen = value;
  }),
  setOpenTask: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: {
    getState: () => store,
  },
}));

function Harness(): null {
  useHotkeys();
  return null;
}

describe("useHotkeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.panelOpen = false;
    store.paletteOpen = false;
    store.t.sidebar = "full";
  });

  it("uses Cmd/Ctrl+J for the assistant side panel", () => {
    render(<Harness />);

    fireEvent.keyDown(window, { key: "j", metaKey: true });

    expect(store.setPanelOpen).toHaveBeenCalledWith(true);
    expect(store.setPaletteOpen).not.toHaveBeenCalled();
  });

  it("keeps Cmd/Ctrl+Backslash as the sidebar toggle", () => {
    render(<Harness />);

    fireEvent.keyDown(window, { key: "\\", metaKey: true });

    expect(store.setTweak).toHaveBeenCalledWith("sidebar", "hidden");
  });
});
