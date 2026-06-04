import { describe, it, expect } from "vitest";
import { selectPreviewItem, looksLikeHtmlDocument } from "./previewSelect";
import type { ChatMessage } from "./types";

const userMsg = (id: string): ChatMessage => ({
  id,
  role: "user",
  content: "hi",
});

const agentMsg = (id: string): ChatMessage => ({
  id,
  role: "agent",
  content: "ok",
});

const toolResult = (
  id: string,
  name: string,
  content: string,
  image?: string,
): ChatMessage => ({
  id,
  kind: "tool_result",
  role: "agent",
  callId: `call-${id}`,
  name,
  content,
  attachments: image
    ? [
        {
          id: `att-${id}`,
          kind: "image",
          name: "shot.png",
          mime: "image/png",
          size: 10,
          dataUrl: image,
        },
      ]
    : undefined,
});

describe("looksLikeHtmlDocument", () => {
  it("accepts a full document (doctype or <html>), case/whitespace tolerant", () => {
    expect(looksLikeHtmlDocument("<!DOCTYPE html><html></html>")).toBe(true);
    expect(looksLikeHtmlDocument('\n  <html lang="en">…')).toBe(true);
  });

  it("rejects snippets and plain text", () => {
    expect(looksLikeHtmlDocument("<div>hi</div>")).toBe(false);
    expect(looksLikeHtmlDocument("# markdown heading")).toBe(false);
    expect(looksLikeHtmlDocument("found 3 results")).toBe(false);
  });
});

describe("selectPreviewItem", () => {
  it("returns null when there are no tool results", () => {
    expect(selectPreviewItem([userMsg("1"), agentMsg("2")])).toBeNull();
  });

  it("prefers an image attachment and surfaces its data URL", () => {
    const item = selectPreviewItem([
      toolResult("1", "browser", "navigated", "data:image/png;base64,AAAA"),
    ]);
    expect(item).toEqual({
      mode: "image",
      src: "data:image/png;base64,AAAA",
      alt: "shot.png",
      toolName: "browser",
      messageId: "1",
    });
  });

  it("falls back to a full HTML document when there is no image", () => {
    const item = selectPreviewItem([
      toolResult("1", "render", "<!doctype html><html><body>x</body></html>"),
    ]);
    expect(item?.mode).toBe("html");
    expect(item).toMatchObject({ toolName: "render", messageId: "1" });
  });

  it("picks the most recent previewable result, skipping text-only ones", () => {
    const item = selectPreviewItem([
      toolResult("1", "browser", "", "data:image/png;base64,OLD"),
      toolResult("2", "web_search", "found 5 results"), // not previewable
    ]);
    // The text-only search result must not wipe the earlier screenshot.
    expect(item).toMatchObject({
      mode: "image",
      src: "data:image/png;base64,OLD",
    });
  });

  it("ignores non-image attachments", () => {
    const msg: ChatMessage = {
      id: "1",
      kind: "tool_result",
      role: "agent",
      callId: "c1",
      name: "file",
      content: "read a file",
      attachments: [
        {
          id: "a1",
          kind: "text-file",
          name: "notes.txt",
          mime: "text/plain",
          size: 4,
          text: "data",
        },
      ],
    };
    expect(selectPreviewItem([msg])).toBeNull();
  });
});
