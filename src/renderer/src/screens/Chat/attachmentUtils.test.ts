// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { processFiles, filesFromClipboard } from "./attachmentUtils";

// Stub the window.hermesAPI surface used by the path-ref code path.
// Picker / drag-drop normally return an absolute path via webUtils; we
// simulate the paste path (no origin) by leaving getPathForFile empty
// and routing through a fake stageAttachment.
beforeEach(() => {
  (window as unknown as { hermesAPI: Record<string, unknown> }).hermesAPI = {
    getPathForFile: vi.fn(() => ""),
    stageAttachment: vi.fn(
      async (sessionId: string, filename: string): Promise<string> =>
        `C:/staging/${sessionId || "default"}/${filename}`,
    ),
  };
});

// ── helpers ──────────────────────────────────────────────

function makeFile(
  name: string,
  type: string,
  contents: string | Uint8Array,
  sizeOverride?: number,
): File {
  const blob = new File([contents as BlobPart], name, { type });
  if (sizeOverride !== undefined) {
    // jsdom honors the blob's byte length, but some tests need a huge size
    // without actually allocating the bytes — override the getter.
    Object.defineProperty(blob, "size", { value: sizeOverride });
  }
  return blob;
}

function fakeDataTransferItem(
  kind: "file" | "string",
  type: string,
  file: File | null,
): DataTransferItem {
  return {
    kind,
    type,
    getAsFile: () => file,
    getAsString: () => undefined,
  } as unknown as DataTransferItem;
}

// ── processFiles ─────────────────────────────────────────

describe("processFiles", () => {
  it("accepts an image under the size limit", async () => {
    const file = makeFile("photo.png", "image/png", "x".repeat(1024));
    const out = await processFiles([file], 0);
    expect(out.errors).toEqual([]);
    expect(out.attachments).toHaveLength(1);
    const a = out.attachments[0];
    expect(a.kind).toBe("image");
    expect(a.name).toBe("photo.png");
    expect(a.mime).toBe("image/png");
    expect(typeof a.dataUrl).toBe("string");
    expect(a.dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects an image over the input cap (50 MB) without attempting compression", async () => {
    // Post-#405: anything ≤ MAX_IMAGE_INPUT_BYTES (50 MB) goes through
    // the compression path which downsamples to fit the gateway. Only
    // pathologically large inputs (>50 MB) are rejected outright. Use
    // 51 MB to exercise that boundary.
    const file = makeFile("huge.png", "image/png", "x", 51 * 1024 * 1024);
    const out = await processFiles([file], 0);
    expect(out.attachments).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toEqual({
      code: "image-too-large",
      filename: "huge.png",
    });
  });

  it("passes images under the compression target through untouched", async () => {
    // 1 MB image — under MAX_IMAGE_TARGET_BYTES (5 MB) so compression
    // short-circuits and the file isn't decoded.  Verifies the fast path
    // doesn't accidentally transcode small images (no quality loss, no
    // originalSize set).
    const file = makeFile(
      "small.png",
      "image/png",
      "data:image/png;base64,iVBORw0KGgo=",
      1 * 1024 * 1024,
    );
    const out = await processFiles([file], 0);
    expect(out.errors).toEqual([]);
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0]).toMatchObject({
      kind: "image",
      name: "small.png",
      size: 1 * 1024 * 1024,
    });
    // originalSize is only set when compression actually ran
    expect(out.attachments[0].originalSize).toBeUndefined();
  });

  it("accepts a text file by MIME type", async () => {
    const file = makeFile("notes.txt", "text/plain", "hello world");
    const out = await processFiles([file], 0);
    expect(out.errors).toEqual([]);
    expect(out.attachments).toHaveLength(1);
    const a = out.attachments[0];
    expect(a.kind).toBe("text-file");
    expect(a.name).toBe("notes.txt");
    expect(a.text).toBe("hello world");
  });

  it("accepts a code file by extension when MIME is empty", async () => {
    const file = makeFile("foo.py", "", "print('hi')");
    const out = await processFiles([file], 0);
    expect(out.errors).toEqual([]);
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0].kind).toBe("text-file");
    expect(out.attachments[0].text).toBe("print('hi')");
    // No explicit MIME → falls back to text/plain
    expect(out.attachments[0].mime).toBe("text/plain");
  });

  it("routes non-image, non-text files to a path-ref via staging when no origin path", async () => {
    const file = makeFile("report.pdf", "application/pdf", "%PDF-1.4");
    const out = await processFiles([file], 0, { sessionId: "sess-1" });
    expect(out.errors).toEqual([]);
    expect(out.attachments).toHaveLength(1);
    const a = out.attachments[0];
    expect(a.kind).toBe("path-ref");
    expect(a.name).toBe("report.pdf");
    expect(a.path).toBe("C:/staging/sess-1/report.pdf");
    expect(a.mime).toBe("application/pdf");
  });

  it("uses the origin path returned by webUtils for picker/drag-drop files", async () => {
    (window as unknown as { hermesAPI: Record<string, unknown> }).hermesAPI = {
      getPathForFile: vi.fn(() => "C:/Users/me/Downloads/doc.pdf"),
      stageAttachment: vi.fn(),
    };
    const file = makeFile("doc.pdf", "application/pdf", "%PDF-1.4");
    const out = await processFiles([file], 0);
    expect(out.errors).toEqual([]);
    expect(out.attachments).toHaveLength(1);
    const a = out.attachments[0];
    expect(a.kind).toBe("path-ref");
    expect(a.path).toBe("C:/Users/me/Downloads/doc.pdf");
    expect(
      (
        window as unknown as {
          hermesAPI: { stageAttachment: ReturnType<typeof vi.fn> };
        }
      ).hermesAPI.stageAttachment,
    ).not.toHaveBeenCalled();
  });

  it("blocks path-ref attachments in remote mode", async () => {
    const file = makeFile("report.pdf", "application/pdf", "%PDF-1.4");
    const out = await processFiles([file], 0, { remoteMode: true });
    expect(out.attachments).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toEqual({
      code: "remote-mode-binary",
      filename: "report.pdf",
    });
  });

  it("rejects a text file over the size limit", async () => {
    const file = makeFile("big.md", "text/markdown", "x", 300 * 1024);
    const out = await processFiles([file], 0);
    expect(out.attachments).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toEqual({
      code: "text-too-large",
      filename: "big.md",
    });
  });

  it("accepts up to the per-message cap and emits too-many for the rest", async () => {
    // existingCount=8, cap=10 → only 2 slots remain.  Send 5 files.
    const files = [
      makeFile("1.txt", "text/plain", "a"),
      makeFile("2.txt", "text/plain", "b"),
      makeFile("3.txt", "text/plain", "c"),
      makeFile("4.txt", "text/plain", "d"),
      makeFile("5.txt", "text/plain", "e"),
    ];
    const out = await processFiles(files, 8);
    expect(out.attachments).toHaveLength(2);
    expect(out.attachments.map((a) => a.name)).toEqual(["1.txt", "2.txt"]);
    expect(out.errors).toHaveLength(3);
    expect(out.errors.every((e) => e.code === "too-many")).toBe(true);
    expect(out.errors.map((e) => e.filename)).toEqual([
      "3.txt",
      "4.txt",
      "5.txt",
    ]);
  });
});

// ── filesFromClipboard ───────────────────────────────────

describe("filesFromClipboard", () => {
  it("extracts file items and reports hasText=false when only files are present", () => {
    const file = makeFile("paste.png", "image/png", "x");
    const items = [
      fakeDataTransferItem("file", "image/png", file),
    ] as unknown as DataTransferItemList;
    Object.defineProperty(items, "length", { value: 1 });
    const event = {
      clipboardData: { items },
    } as unknown as ClipboardEvent;
    const out = filesFromClipboard(event);
    expect(out.files).toHaveLength(1);
    expect(out.files[0].name).toBe("paste.png");
    expect(out.hasText).toBe(false);
  });

  it("reports hasText=true when text/plain string item is present alongside a file", () => {
    const file = makeFile("paste.png", "image/png", "x");
    const items = [
      fakeDataTransferItem("string", "text/plain", null),
      fakeDataTransferItem("file", "image/png", file),
    ] as unknown as DataTransferItemList;
    Object.defineProperty(items, "length", { value: 2 });
    const event = {
      clipboardData: { items },
    } as unknown as ClipboardEvent;
    const out = filesFromClipboard(event);
    expect(out.files).toHaveLength(1);
    expect(out.hasText).toBe(true);
  });

  it("returns empty result when clipboardData is missing", () => {
    const event = { clipboardData: null } as unknown as ClipboardEvent;
    const out = filesFromClipboard(event);
    expect(out).toEqual({ files: [], hasText: false });
  });
});
