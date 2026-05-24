import { describe, it, expect, vi } from "vitest";

// sessions.ts pulls in better-sqlite3 (native module) and the installer
// module just to compute the DB path.  Stub both so the test runs under
// plain Node without rebuilding native bindings.

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-decode-test-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

vi.mock("better-sqlite3", () => ({
  default: function MockDb() {
    throw new Error("not used in decodeContent tests");
  },
}));

import { decodeContent } from "../src/main/sessions";

describe("decodeContent", () => {
  it("returns plain text and no attachments for a bare string", () => {
    const out = decodeContent("hello world", 1);
    expect(out).toEqual({ text: "hello world", attachments: [] });
  });

  it("returns empty text and no attachments for empty content", () => {
    const out = decodeContent("", 1);
    expect(out).toEqual({ text: "", attachments: [] });
  });

  it("joins multiple text parts with a blank line separator", () => {
    const raw =
      '\x00json:[{"type":"text","text":"hi"},{"type":"text","text":"there"}]';
    const out = decodeContent(raw, 7);
    expect(out).toEqual({ text: "hi\n\nthere", attachments: [] });
  });

  it("decodes an image_url part in object form", () => {
    const raw =
      '\x00json:[{"type":"text","text":"look"},{"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}]';
    const out = decodeContent(raw, 42);
    expect(out.text).toBe("look");
    expect(out.attachments).toHaveLength(1);
    const att = out.attachments[0];
    expect(att.kind).toBe("image");
    expect(att.mime).toBe("image/png");
    expect(att.name.endsWith(".png")).toBe(true);
    expect(att.dataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("decodes an image_url part where image_url is itself a string", () => {
    const raw =
      '\x00json:[{"type":"image_url","image_url":"data:image/jpeg;base64,abc"}]';
    const out = decodeContent(raw, 1);
    expect(out.attachments).toHaveLength(1);
    const att = out.attachments[0];
    expect(att.mime).toBe("image/jpeg");
    expect(att.name.endsWith(".jpg")).toBe(true);
    expect(att.dataUrl).toBe("data:image/jpeg;base64,abc");
  });

  it("ignores non-image data URLs (e.g. application/pdf)", () => {
    const raw =
      '\x00json:[{"type":"text","text":"see attachment"},{"type":"image_url","image_url":{"url":"data:application/pdf;base64,JVBERi0="}}]';
    const out = decodeContent(raw, 1);
    expect(out.text).toBe("see attachment");
    expect(out.attachments).toEqual([]);
  });

  it("falls back to the raw string when the JSON payload is malformed", () => {
    const raw = "\x00json:not valid json {[";
    const out = decodeContent(raw, 1);
    expect(out.text).toBe(raw);
    expect(out.attachments).toEqual([]);
  });

  it("returns the inner string when the JSON payload is a non-array string", () => {
    const raw = '\x00json:"hello"';
    const out = decodeContent(raw, 1);
    expect(out.text).toBe("hello");
    expect(out.attachments).toEqual([]);
  });

  it("preserves image order and uses stable IDs derived from messageId", () => {
    const raw =
      "\x00json:[" +
      '{"type":"image_url","image_url":"data:image/png;base64,AAA="},' +
      '{"type":"image_url","image_url":"data:image/jpeg;base64,BBB="},' +
      '{"type":"image_url","image_url":"data:image/webp;base64,CCC="}' +
      "]";
    const out1 = decodeContent(raw, 99);
    const out2 = decodeContent(raw, 99);
    expect(out1.attachments.map((a) => a.dataUrl)).toEqual([
      "data:image/png;base64,AAA=",
      "data:image/jpeg;base64,BBB=",
      "data:image/webp;base64,CCC=",
    ]);
    // Stable id format: db-<messageId>-<idx>
    expect(out1.attachments.map((a) => a.id)).toEqual([
      "db-99-0",
      "db-99-1",
      "db-99-2",
    ]);
    expect(out1.attachments.map((a) => a.id)).toEqual(
      out2.attachments.map((a) => a.id),
    );
  });

  it("accepts the Responses-API spellings input_text / input_image", () => {
    const raw =
      "\x00json:[" +
      '{"type":"input_text","text":"prompt"},' +
      '{"type":"input_image","image_url":"data:image/png;base64,AAA="}' +
      "]";
    const out = decodeContent(raw, 5);
    expect(out.text).toBe("prompt");
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0].mime).toBe("image/png");
    expect(out.attachments[0].dataUrl).toBe("data:image/png;base64,AAA=");
  });
});
