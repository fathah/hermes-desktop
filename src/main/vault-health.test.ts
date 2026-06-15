import { describe, expect, it } from "vitest";
import { buildVaultHealthReportFromSnapshot } from "./vault-health";

describe("buildVaultHealthReportFromSnapshot", () => {
  it("detects duplicates, missing schema fields, stale inbox captures, PDFs, and weak clusters", () => {
    const now = Date.UTC(2026, 5, 15);
    const report = buildVaultHealthReportFromSnapshot(
      {
        notes: [
          {
            path: "alpha.md",
            title: "Alpha",
            props: { aliases: ["Shared"], schema: "project" },
            body: "[[Beta]]",
            mtime: now,
          },
          {
            path: "alpha-copy.md",
            title: "Alpha",
            props: { aliases: ["Shared"], schema: "project", status: "doing" },
            body: "",
            mtime: now,
          },
          {
            path: "_inbox/cap_old.md",
            title: "Old capture",
            props: { status: "unprocessed", capturedAt: now - 12 * 86_400_000 },
            body: "still raw",
            mtime: now,
          },
          {
            path: "Sources/paper.md",
            title: "Paper",
            props: { source: "pdf" },
            body: "unprocessed pdf notes",
            mtime: now,
          },
          {
            path: "lonely.md",
            title: "Lonely",
            props: {},
            body: "",
            mtime: now,
          },
        ],
        links: [{ source: "alpha.md", target: "beta.md", type: "link" }],
        mechanical: {
          orphans: ["lonely.md"],
          brokenLinks: [{ source: "alpha.md", target: "missing", type: "link" }],
          stale: [],
        },
      },
      {
        now,
        staleCaptureDays: 7,
        schemaRequiredFields: { project: ["status"] },
      },
    );

    expect(report.duplicateTitles).toEqual([
      { title: "Alpha", paths: ["alpha-copy.md", "alpha.md"] },
    ]);
    expect(report.duplicateAliases).toEqual([
      { alias: "Shared", paths: ["alpha-copy.md", "alpha.md"] },
    ]);
    expect(report.missingSchemaFields).toEqual([
      { path: "alpha.md", schema: "project", missing: ["status"] },
    ]);
    expect(report.staleCaptures.map((c) => c.path)).toEqual([
      "_inbox/cap_old.md",
    ]);
    expect(report.unprocessedPdfs.map((p) => p.path)).toEqual([
      "Sources/paper.md",
    ]);
    expect(report.weaklyConnected.map((p) => p.path)).toContain("lonely.md");
  });
});
