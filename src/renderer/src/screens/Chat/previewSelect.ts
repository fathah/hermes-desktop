// Pure selection logic for the chat preview pane (WS2).
//
// The agent surfaces visual output as tool-result rows: a browser/screenshot
// tool returns an *image attachment*, and an artifact-generating tool can
// return a full *HTML document* as its text content. This module derives,
// from the live `messages` array, the single most-recent previewable item to
// show in the side pane.
//
// Design constraints (see docs plan WS2):
//   - No webview / no external network. We render the screenshot the agent
//     already captured (data: URL) or sandbox an inline HTML document. We do
//     NOT live-load arbitrary URLs — that would route around the load-bearing
//     SSRF hardening in src/main/security.ts.
//   - "Previewable" is restricted to visual output (image OR a full HTML
//     document). Plain-text tool results already render fine inline, so they
//     do not hijack the pane; the selector skips past them to the most recent
//     visual artifact.
//
// Kept free of React/DOM imports so it is unit-testable under vitest (jsdom).

import type { Attachment } from "../../../../shared/attachments";
import type { ChatMessage } from "./types";

export type PreviewItem =
  | {
      mode: "image";
      /** data:image/...;base64,... — safe to drop straight into <img src>. */
      src: string;
      alt: string;
      toolName: string;
      messageId: string;
    }
  | {
      mode: "html";
      /** Full HTML document, rendered in a fully-sandboxed iframe srcDoc. */
      html: string;
      toolName: string;
      messageId: string;
    };

/**
 * Conservative full-document HTML test. We only treat content as renderable
 * HTML when it clearly opens as a document (`<!doctype html>` or `<html>`),
 * never for stray `<div>`/markdown snippets — those belong inline, and we must
 * not hand random tool text to an iframe.
 */
export function looksLikeHtmlDocument(content: string): boolean {
  const head = content.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function firstImageAttachment(
  attachments: Attachment[] | undefined,
): Attachment | undefined {
  return attachments?.find((a) => a.kind === "image" && !!a.dataUrl);
}

/**
 * Walk `messages` newest-first and return the most recent previewable
 * tool-result, or null if none. Tool-results with neither an image nor a full
 * HTML document are skipped (not cleared) so a later text-only result doesn't
 * wipe the last screenshot from the pane.
 */
export function selectPreviewItem(messages: ChatMessage[]): PreviewItem | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!("kind" in msg) || msg.kind !== "tool_result") continue;

    const image = firstImageAttachment(msg.attachments);
    if (image?.dataUrl) {
      return {
        mode: "image",
        src: image.dataUrl,
        alt: image.name || msg.name,
        toolName: msg.name,
        messageId: msg.id,
      };
    }

    if (looksLikeHtmlDocument(msg.content)) {
      return {
        mode: "html",
        html: msg.content,
        toolName: msg.name,
        messageId: msg.id,
      };
    }
  }
  return null;
}
