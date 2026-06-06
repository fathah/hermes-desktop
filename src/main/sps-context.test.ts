// sps-context.test.ts — unit tests for the PURE context formatter (Milestone 1A).
// Only `formatVaultContext`/`vaultUsage` are exercised here; `assembleVaultContext`
// opens the better-sqlite3 note-index and is covered by `npm run verify:note-index`,
// not vitest (the native module is built for Electron's ABI, not vitest's).
import { describe, it, expect } from "vitest";
import { formatVaultContext, vaultUsage } from "./sps-context";

describe("formatVaultContext", () => {
  it("returns an empty string when there is nothing to add", () => {
    expect(formatVaultContext({ hits: [], memoryEntries: [], rules: [] })).toBe(
      "",
    );
  });

  it("renders hits with title + tidied snippet and strips FTS markers", () => {
    const out = formatVaultContext({
      hits: [
        {
          title: "Guard Roster",
          snippet: "the ⟦night⟧ shift  rota",
          path: "a.md",
        },
      ],
      memoryEntries: [],
      rules: [],
    });
    expect(out).toContain("Relevant notes from this workspace:");
    expect(out).toContain("- Guard Roster: the night shift rota");
    expect(out).not.toContain("⟦");
  });

  it("falls back to the path when a hit has no title", () => {
    const out = formatVaultContext({
      hits: [{ title: "", snippet: "", path: "vault/x.md" }],
      memoryEntries: [],
      rules: [],
    });
    expect(out).toContain("- vault/x.md");
  });

  it("renders memory entries and the vault path footer", () => {
    const out = formatVaultContext({
      hits: [],
      memoryEntries: ["Owner of a security guarding business."],
      rules: [],
      vaultPath: "/home/sps/vault",
    });
    expect(out).toContain("What you remember about the user:");
    expect(out).toContain("- Owner of a security guarding business.");
    expect(out).toContain("/home/sps/vault");
  });

  it("renders standing rules first as a directive section", () => {
    const out = formatVaultContext({
      hits: [{ title: "Note", snippet: "x", path: "n.md" }],
      memoryEntries: [],
      rules: ["Show me the bear case first", "Keep answers short"],
    });
    expect(out).toContain("The user's standing rules");
    expect(out).toContain("- Show me the bear case first");
    // Rules come before the notes section.
    expect(out.indexOf("standing rules")).toBeLessThan(
      out.indexOf("Relevant notes"),
    );
  });

  it("budgets the total output length", () => {
    const big = "x".repeat(500);
    const out = formatVaultContext({
      hits: Array.from({ length: 20 }, (_, i) => ({
        title: `Note ${i}`,
        snippet: big,
        path: `${i}.md`,
      })),
      memoryEntries: Array.from({ length: 20 }, () => big),
      rules: [],
    });
    expect(out.length).toBeLessThanOrEqual(4002);
  });
});

describe("vaultUsage", () => {
  it("counts notes, memory, and rules after caps and empty-filtering", () => {
    const used = vaultUsage({
      hits: Array.from({ length: 10 }, (_, i) => ({
        title: `N${i}`,
        snippet: "s",
        path: `${i}.md`,
      })),
      memoryEntries: ["a", "  ", "b"],
      rules: ["r1", "r2", "  "],
    });
    expect(used.notes).toBe(6); // capped at MAX_HITS
    expect(used.memory).toBe(2); // blank dropped
    expect(used.rules).toBe(2); // blank dropped
  });

  it("is all-zero when nothing is present", () => {
    expect(vaultUsage({ hits: [], memoryEntries: [], rules: [] })).toEqual({
      notes: 0,
      memory: 0,
      rules: 0,
    });
  });
});
