import { describe, it, expect, vi } from "vitest";

// ── Mock project dependencies so importing hermes.ts is side-effect free ──

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-buc-test-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/dev/null",
  hermesCliArgs: () => ["/dev/null"],
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/main/config", () => ({
  getModelConfig: () => ({ model: "test-model", provider: "openrouter" }),
  readEnv: () => ({}),
  getConnectionConfig: () => ({
    mode: "remote" as const,
    remoteUrl: "http://test.example.com",
    apiKey: "",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    },
  }),
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
  isSshTunnelHealthy: () => Promise.resolve(false),
  startSshTunnel: () => Promise.resolve(),
}));

vi.mock("../src/main/utils", () => ({
  stripAnsi: (s: string) => s,
}));

vi.mock("../src/main/models", () => ({
  readModels: () => [],
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

import { buildUserContent } from "../src/main/hermes";
import type { Attachment } from "../src/shared/attachments";

// ── helpers ──────────────────────────────────────────────

function image(
  name: string,
  dataUrl: string | undefined,
  id = name,
): Attachment {
  return {
    id,
    kind: "image",
    name,
    mime: "image/png",
    size: 100,
    dataUrl,
  };
}

function textFile(
  name: string,
  text: string | undefined,
  mime = "text/plain",
  id = name,
): Attachment {
  return {
    id,
    kind: "text-file",
    name,
    mime,
    size: text ? text.length : 0,
    text,
  };
}

function pathRef(
  name: string,
  path: string | undefined,
  mime = "application/octet-stream",
  id = name,
): Attachment {
  return {
    id,
    kind: "path-ref",
    name,
    mime,
    size: 0,
    path,
  };
}

// ── tests ────────────────────────────────────────────────

describe("buildUserContent", () => {
  it("returns the plain string verbatim when no attachments arg", () => {
    const result = buildUserContent("hello world");
    expect(result).toBe("hello world");
  });

  it("returns the plain string verbatim with empty attachments array (prompt-cache friendly)", () => {
    const result = buildUserContent("hello world", []);
    expect(result).toBe("hello world");
    expect(typeof result).toBe("string");
  });

  it("returns array with text + image_url part for one image", () => {
    const result = buildUserContent("look at this", [
      image("a.png", "data:image/png;base64,AAA="),
    ]);
    expect(result).toEqual([
      { type: "text", text: "look at this" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA=" } },
    ]);
  });

  it("preserves image order with multiple images", () => {
    const result = buildUserContent("hi", [
      image("a.png", "data:image/png;base64,AAA=", "1"),
      image("b.png", "data:image/png;base64,BBB=", "2"),
      image("c.png", "data:image/png;base64,CCC=", "3"),
    ]);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(arr).toHaveLength(4);
    expect(arr[0]).toEqual({ type: "text", text: "hi" });
    expect(arr[1].image_url?.url).toBe("data:image/png;base64,AAA=");
    expect(arr[2].image_url?.url).toBe("data:image/png;base64,BBB=");
    expect(arr[3].image_url?.url).toBe("data:image/png;base64,CCC=");
  });

  it("returns plain string with wrapped <file> appendix when only a text-file is attached", () => {
    const result = buildUserContent("explain", [
      textFile("notes.md", "# title\nbody", "text/markdown"),
    ]);
    expect(typeof result).toBe("string");
    expect(result).toBe(
      'explain\n\n<file name="notes.md" mime="text/markdown">\n# title\nbody\n</file>',
    );
  });

  it("returns array with text+file in text part plus image parts when both present", () => {
    const result = buildUserContent("describe", [
      textFile("notes.md", "body", "text/markdown"),
      image("a.png", "data:image/png;base64,AAA="),
    ]);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(arr[0]).toEqual({
      type: "text",
      text: 'describe\n\n<file name="notes.md" mime="text/markdown">\nbody\n</file>',
    });
    expect(arr[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA=" },
    });
  });

  it("omits the text part entirely when text is empty but images are present", () => {
    // Some providers (Anthropic via Bedrock, certain vision endpoints) reject
    // empty-string text parts as `invalid_content_part`, so the empty text
    // part is dropped rather than emitted.
    const result = buildUserContent("", [
      image("a.png", "data:image/png;base64,AAA="),
    ]);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA=" },
    });
  });

  it("XML-escapes filename/mime in the <file> wrapper", () => {
    const result = buildUserContent("here", [
      textFile('evil"name<tag>.py', "print('hi')", "text/x-python&weird"),
    ]);
    expect(typeof result).toBe("string");
    const s = result as string;
    expect(s).toContain("&quot;");
    expect(s).toContain("&lt;tag&gt;");
    expect(s).toContain("&amp;weird");
    // The raw unescaped characters must not appear inside the attribute area
    expect(s).not.toContain('"evil"name');
  });

  it("silently drops images that have no dataUrl", () => {
    const result = buildUserContent("hi", [
      image("ok.png", "data:image/png;base64,AAA="),
      image("bad.png", undefined),
      image("blank.png", ""),
    ]);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Array<{ type: string; image_url?: { url: string } }>;
    // 1 text part + 1 valid image
    expect(arr).toHaveLength(2);
    expect(arr[1].image_url?.url).toBe("data:image/png;base64,AAA=");
  });

  it("silently drops text-files that have no text field", () => {
    const result = buildUserContent("hi", [textFile("missing.txt", undefined)]);
    // No images and no valid text-files → result is just the user text
    expect(result).toBe("hi");
  });

  it("appends path-ref attachments as [Attached file: <path>] lines", () => {
    const result = buildUserContent("summarize this", [
      pathRef(
        "report.pdf",
        "C:/Users/pmos6/Downloads/report.pdf",
        "application/pdf",
      ),
    ]);
    expect(typeof result).toBe("string");
    expect(result).toBe(
      "summarize this\n\n[Attached file: C:/Users/pmos6/Downloads/report.pdf]",
    );
  });

  it("groups multiple path-refs into one block, one per line", () => {
    const result = buildUserContent("compare these", [
      pathRef("a.pdf", "/tmp/a.pdf", "application/pdf"),
      pathRef(
        "b.docx",
        "/tmp/b.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ]);
    expect(result).toBe(
      "compare these\n\n[Attached file: /tmp/a.pdf]\n[Attached file: /tmp/b.docx]",
    );
  });

  it("path-refs combine with text-file wrappers and images in the right order", () => {
    const result = buildUserContent("review", [
      textFile("code.py", "print(1)"),
      pathRef("doc.pdf", "/tmp/doc.pdf", "application/pdf"),
      image("screen.png", "data:image/png;base64,AAA="),
    ]);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(arr).toHaveLength(2);
    // Text part contains user text, text-file wrapper, AND path-ref line
    expect(arr[0].type).toBe("text");
    expect(arr[0].text).toContain("review");
    expect(arr[0].text).toContain('<file name="code.py"');
    expect(arr[0].text).toContain("[Attached file: /tmp/doc.pdf]");
    expect(arr[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA=" },
    });
  });

  it("silently drops path-refs with no path field", () => {
    const result = buildUserContent("look", [pathRef("missing", undefined)]);
    expect(result).toBe("look");
  });

  it("path-ref only, no other text → result is just the [Attached file] line", () => {
    const result = buildUserContent("", [
      pathRef("a.pdf", "/tmp/a.pdf", "application/pdf"),
    ]);
    expect(result).toBe("[Attached file: /tmp/a.pdf]");
  });
});
