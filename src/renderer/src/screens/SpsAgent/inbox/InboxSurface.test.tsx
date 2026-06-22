import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxSurface } from "./InboxSurface";

const ocr = vi.hoisted(() => ({
  ocrImageBlobToText: vi.fn(),
}));

vi.mock("../lib/ocr", () => ocr);

const vaultState = vi.hoisted(() => ({
  rows: [] as Array<{
    path: string;
    title: string;
    props: Record<string, unknown>;
    mtime: number;
  }>,
  refetch: vi.fn(),
}));

vi.mock("../hooks/useNoteIndex", () => ({
  useVaultQuery: () => vaultState,
}));

const storeState = vi.hoisted(() => ({
  ingestCommitPage: vi.fn(),
  flash: vi.fn(),
  setSurface: vi.fn(),
  importPdf: vi.fn(),
  saveStudyToWiki: vi.fn(),
  pendingInboxMode: null as "image" | null,
  clearPendingInboxMode: vi.fn(),
}));

function useStoreMock<T>(selector: (state: typeof storeState) => T): T {
  return selector(storeState);
}
useStoreMock.getState = () => storeState;

vi.mock("../store", () => ({
  useStore: useStoreMock,
}));

const api = {
  readObsidianFile: vi.fn(),
  writeObsidianFile: vi.fn(),
  spsExportRow: vi.fn(),
  spsPickImage: vi.fn(),
  spsReadFileBytes: vi.fn(),
  spsAssetWrite: vi.fn(),
  spsReadRow: vi.fn(),
  spsTeachCapture: vi.fn(),
  spsFileAnswer: vi.fn(),
  spsListRecentScreenshots: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

beforeEach(() => {
  vi.clearAllMocks();
  vaultState.rows = [];
  vaultState.refetch.mockReset();
  storeState.flash.mockReset();
  storeState.clearPendingInboxMode.mockReset();
  storeState.pendingInboxMode = null;
  storeState.saveStudyToWiki.mockResolvedValue({ ok: true, pageId: "study" });
  ocr.ocrImageBlobToText.mockReset();
  ocr.ocrImageBlobToText.mockResolvedValue("Question 1 OCR text.");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
    }),
  );
  installApi();
  api.readObsidianFile.mockResolvedValue(null);
  api.writeObsidianFile.mockResolvedValue(true);
  api.spsExportRow.mockResolvedValue(true);
  api.spsPickImage.mockResolvedValue("/tmp/biology-page.png");
  api.spsReadFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  api.spsAssetWrite.mockResolvedValue("a".repeat(64) + ".png");
  api.spsReadRow.mockResolvedValue(
    [
      "---",
      'title: "Textbook page"',
      'source: "image"',
      'assetPath: "' + "a".repeat(64) + '.png"',
      'ocrStatus: "not-run"',
      "---",
      "",
      "![Capture](../_assets/" + "a".repeat(64) + ".png)",
    ].join("\n"),
  );
  api.spsTeachCapture.mockResolvedValue({
    kind: "chat",
    reply: ["## Answers\n\n1. Worked answer with pedagogy."],
  });
  api.spsListRecentScreenshots.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("InboxSurface visual captures", () => {
  it("opens image capture mode from the first-run checklist intent", async () => {
    storeState.pendingInboxMode = "image";

    render(<InboxSurface />);

    expect(
      await screen.findByRole("button", { name: /capture screen/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import from clipboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Image").closest("button")).toHaveClass("active");
    await waitFor(() => {
      expect(api.spsListRecentScreenshots).toHaveBeenCalledWith("default");
    });
    expect(storeState.clearPendingInboxMode).toHaveBeenCalledTimes(1);
  });

  it("saves a chosen image file to the Inbox without OCR or teaching", async () => {
    render(<InboxSurface />);

    fireEvent.click(screen.getByRole("button", { name: /image/i }));
    fireEvent.change(screen.getByLabelText(/image note/i), {
      target: { value: "Teach later, but save now." },
    });
    fireEvent.click(screen.getByRole("button", { name: /choose image file/i }));

    await waitFor(() => {
      expect(api.spsExportRow).toHaveBeenCalled();
    });
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2]);
    expect(markdown).toContain('source: "image"');
    expect(markdown).toContain('assetPath: "' + "a".repeat(64) + '.png"');
    expect(markdown).toContain('captureOrigin: "file"');
    expect(markdown).toContain('ocrStatus: "not-run"');
    expect(markdown).toContain("Teach later, but save now.");
    expect(ocr.ocrImageBlobToText).not.toHaveBeenCalled();
    expect(api.spsTeachCapture).not.toHaveBeenCalled();
  });

  it("runs OCR and Teach This only from explicit visual capture actions", async () => {
    vaultState.rows = [
      {
        path: "_inbox/cap-image.md",
        title: "Textbook page",
        props: {
          title: "Textbook page",
          source: "image",
          assetPath: "a".repeat(64) + ".png",
          ocrStatus: "not-run",
          capturedAt: 1,
        },
        mtime: 1,
      },
    ];

    render(<InboxSurface />);

    expect(api.spsTeachCapture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /extract text/i }));

    await waitFor(() => {
      expect(ocr.ocrImageBlobToText).toHaveBeenCalled();
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "_inbox",
        "cap-image",
        expect.stringContaining("## OCR Text\n\nQuestion 1 OCR text."),
        "default",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /teach this/i }));

    await waitFor(() => {
      expect(api.spsTeachCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          captureId: "cap-image",
          title: "Textbook page",
          corpusDescription: expect.stringContaining("Question 1 OCR text."),
        }),
        "default",
      );
      expect(
        screen.getByText(/worked answer with pedagogy/i),
      ).toBeInTheDocument();
    });
  });
});
