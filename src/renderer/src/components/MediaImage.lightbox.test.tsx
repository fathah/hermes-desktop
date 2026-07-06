import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MediaImage } from "./MediaImage";
import type { MediaToken } from "../screens/Chat/mediaUtils";

vi.mock("./useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const token: MediaToken = {
  src: "data:image/png;base64,iVBORw0KGgo=",
  isUrl: true,
  isImage: true,
  name: "pic.png",
};

function openLightbox(): ReturnType<typeof render> {
  const view = render(<MediaImage token={token} />);
  fireEvent.click(view.getByAltText("pic.png"));
  return view;
}

describe("MediaImage lightbox", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        saveMediaFile: vi.fn(async () => true),
        showMediaMenu: vi.fn(),
      },
    });
  });

  it("portals the lightbox to document.body so paint containment cannot clip it", () => {
    // Regression for the content-visibility clipping bug: `.chat-message` rows
    // imply paint containment (#748), which traps an inline fixed backdrop
    // inside the row. Rendering under <body> is the escape hatch — this pins
    // the backdrop's DOM location, not just its presence.
    const { container } = openLightbox();
    const backdrop = document.querySelector(".chat-image-preview-backdrop");
    expect(backdrop).not.toBeNull();
    expect(backdrop?.parentElement).toBe(document.body);
    expect(container.querySelector(".chat-image-preview-backdrop")).toBeNull();
  });

  it("closes on Escape and consumes the key before bubble-phase listeners", () => {
    // FileViewer binds an unguarded document-level (bubble) Escape listener.
    // The lightbox is the topmost modal, so one keypress must close only it —
    // capture + stopPropagation keeps the panel behind it open.
    const panelListener = vi.fn();
    document.addEventListener("keydown", panelListener);
    try {
      openLightbox();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(document.querySelector(".chat-image-preview-backdrop")).toBeNull();
      expect(panelListener).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", panelListener);
    }
  });

  it("closes on backdrop click but not on clicks inside the action bar", () => {
    openLightbox();
    const actions = document.querySelector(".chat-image-preview-actions");
    expect(actions).not.toBeNull();
    fireEvent.click(actions!);
    expect(
      document.querySelector(".chat-image-preview-backdrop"),
    ).not.toBeNull();

    fireEvent.click(document.querySelector(".chat-image-preview-backdrop")!);
    expect(document.querySelector(".chat-image-preview-backdrop")).toBeNull();
  });
});
