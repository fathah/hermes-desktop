import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { DeckProject } from "../src/shared/deck-studio";

const loadURLMock = vi.fn(() => Promise.resolve());
const printToPDFMock = vi.fn(() => Promise.resolve(Buffer.from("%PDF-1.4")));
const destroyMock = vi.fn();

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function BrowserWindow() {
    return {
      loadURL: loadURLMock,
      webContents: {
        printToPDF: printToPDFMock,
      },
      destroy: destroyMock,
    };
  }),
  shell: {
    openPath: vi.fn(() => Promise.resolve("")),
  },
}));

function makeProject(): DeckProject {
  return {
    id: "deck-1",
    title: "Deck <img src=x onerror=alert(1)>",
    audience: "execs",
    goal: "prove safety",
    theme: "investor",
    status: "ready",
    sourceRefs: [],
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
    slides: [
      {
        id: "slide-1",
        kind: "title",
        title: "Title <script>alert(1)</script>",
        subtitle: "Subtitle <svg onload=alert(1)>",
        body: [
          {
            id: "body-1",
            kind: "bullet",
            text: 'Bullet <img src=x onerror="alert(1)">',
          },
        ],
        visuals: [
          {
            id: "visual-1",
            kind: "metric",
            value: "<b>90%</b>",
            label: "<span onclick=alert(1)>safe</span>",
            caption: "<script>alert(1)</script>",
          },
        ],
        evidenceRefs: [],
      },
    ],
  };
}

describe("Deck Studio PDF export hardening", () => {
  beforeEach(() => {
    loadURLMock.mockClear();
    printToPDFMock.mockClear();
    destroyMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads escaped print HTML with a strict CSP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deck-pdf-security-"));
    try {
      const { exportDeckPdf } = await import("../src/main/deck-studio");
      const result = await exportDeckPdf(makeProject(), dir);

      expect(result.ok).toBe(true);
      expect(loadURLMock).toHaveBeenCalledTimes(1);
      const dataUrl = loadURLMock.mock.calls[0]?.[0] as string;
      const html = decodeURIComponent(
        dataUrl.replace(/^data:text\/html;charset=utf-8,/, ""),
      );
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("script-src 'none'");
      expect(html).toContain("base-uri 'none'");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).not.toContain('<img src=x onerror="alert(1)">');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
