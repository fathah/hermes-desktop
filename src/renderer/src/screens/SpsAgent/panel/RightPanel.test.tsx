import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  rightTab: "assistant",
  openPanelTab: vi.fn(),
  setPanelOpen: vi.fn(),
  docs: { home: [] },
  page: "home",
  comments: [],
  replyComment: vi.fn(),
  resolveComment: vi.fn(),
  removeComment: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

vi.mock("../assistant/AgentBody", () => ({
  AgentBody: () => <div>Assistant body</div>,
}));

vi.mock("./Outline", () => ({
  Outline: () => <div>Outline body</div>,
}));

vi.mock("./CommentsPane", () => ({
  CommentsPane: () => <div>Comments body</div>,
}));

vi.mock("./InfoPane", () => ({
  InfoPane: () => <div>Info body</div>,
}));

vi.mock("./BacklinksPane", () => ({
  BacklinksPane: () => <div>Backlinks body</div>,
}));

import { RightPanel } from "./RightPanel";

describe("RightPanel", () => {
  it("exposes an explicit close control", () => {
    render(<RightPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Close side panel" }));

    expect(store.setPanelOpen).toHaveBeenCalledWith(false);
  });
});
