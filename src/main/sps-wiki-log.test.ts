// sps-wiki-log.test.ts — append-only wiki-evolution log.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { formatWikiLogLine, appendWikiLog } from "./sps-wiki-log";

describe("formatWikiLogLine", () => {
  it("emits a parseable `## [date] op | summary` line", () => {
    const d = new Date("2026-06-09T12:00:00Z");
    expect(formatWikiLogLine("ingest", "Filed 3 captures", d)).toBe(
      "## [2026-06-09] ingest | Filed 3 captures",
    );
  });
  it("collapses whitespace and defaults an empty summary", () => {
    const d = new Date("2026-01-02T00:00:00Z");
    expect(formatWikiLogLine("lint", "a\n  b\tc", d)).toBe(
      "## [2026-01-02] lint | a b c",
    );
    expect(formatWikiLogLine("file-answer", "   ", d)).toBe(
      "## [2026-01-02] file-answer | (no summary)",
    );
  });
});

describe("appendWikiLog", () => {
  let vault: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "wikilog-"));
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it("seeds the header on first write, then appends bare lines", async () => {
    await appendWikiLog(vault, "ingest", "first");
    await appendWikiLog(vault, "file-answer", "second");
    const body = await readFile(join(vault, "log.md"), "utf-8");
    expect(body).toContain('title: "Log"');
    expect(body).toContain("# Wiki log");
    expect(body).toContain("ingest | first");
    expect(body).toContain("file-answer | second");
    // Header appears exactly once.
    expect(body.match(/# Wiki log/g)).toHaveLength(1);
  });

  it("never throws on an unwritable vault dir", async () => {
    await expect(
      appendWikiLog(join(vault, "does", "not", "exist"), "lint", "x"),
    ).resolves.toBeUndefined();
  });
});
