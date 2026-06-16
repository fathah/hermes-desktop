import { describe, expect, it, vi } from "vitest";
import {
  crawlPublicUrlWithRunner,
  getCrawl4AiStatusFromRunner,
  type Crawl4AiCommandRunner,
} from "./crawl4ai";

describe("getCrawl4AiStatusFromRunner", () => {
  it("returns ready status when crwl and doctor succeed", async () => {
    const run = vi.fn<Crawl4AiCommandRunner>(async (_command, args) => {
      if (args.includes("--version")) {
        return { ok: true, stdout: "crwl 0.8.9", stderr: "" };
      }
      return { ok: true, stdout: "ok", stderr: "" };
    });

    const status = await getCrawl4AiStatusFromRunner(run);

    expect(status).toMatchObject({
      installed: true,
      version: "0.8.9",
      doctorOk: true,
    });
    expect(run).toHaveBeenCalledWith("crwl", ["--version"], 8000);
    expect(run).toHaveBeenCalledWith("crawl4ai-doctor", [], 30000);
  });

  it("reports unavailable without leaking stderr", async () => {
    const run = vi.fn<Crawl4AiCommandRunner>(async () => ({
      ok: false,
      stdout: "",
      stderr: "/Users/amar/private/path: command not found",
    }));

    const status = await getCrawl4AiStatusFromRunner(run);

    expect(status.installed).toBe(false);
    expect(status.error).toBe("Crawl4AI CLI is not installed.");
  });
});

describe("crawlPublicUrlWithRunner", () => {
  it("rejects blocked URLs before spawning crwl", async () => {
    const run = vi.fn<Crawl4AiCommandRunner>();

    const result = await crawlPublicUrlWithRunner("file:///etc/passwd", run);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Only public HTTPS source URLs can be imported.");
    expect(run).not.toHaveBeenCalled();
  });

  it("returns structured markdown extraction", async () => {
    const run = vi.fn<Crawl4AiCommandRunner>(async () => ({
      ok: true,
      stdout:
        "# A Useful Page\n\nThis is a public source.\n\n[Related](https://example.com/next)",
      stderr: "",
    }));

    const result = await crawlPublicUrlWithRunner(
      "https://example.com/page",
      run,
    );

    expect(result).toMatchObject({
      ok: true,
      sourceUrl: "https://example.com/page",
      canonicalUrl: "https://example.com/page",
      title: "A Useful Page",
      engine: "crawl4ai",
      links: ["https://example.com/next"],
    });
    expect(result.markdown).toContain("This is a public source.");
    expect(run).toHaveBeenCalledWith(
      "crwl",
      ["https://example.com/page", "-o", "markdown"],
      45000,
    );
  });

  it("returns a safe failure when crawl output is empty", async () => {
    const run = vi.fn<Crawl4AiCommandRunner>(async () => ({
      ok: true,
      stdout: "",
      stderr: "",
    }));

    const result = await crawlPublicUrlWithRunner(
      "https://example.com/page",
      run,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Crawl4AI could not extract that public page.");
  });
});
