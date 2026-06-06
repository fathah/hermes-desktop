// sps-context.test.ts — unit tests for the PURE context formatter (Milestone 1A).
// Only `formatVaultContext` is exercised here; `assembleVaultContext` opens the
// better-sqlite3 note-index and is covered by `npm run verify:note-index`, not
// vitest (the native module is built for Electron's ABI, not vitest's).
import { describe, it, expect } from "vitest";
import { formatVaultContext } from "./sps-context";

describe("formatVaultContext", () => {
  it("returns an empty string when there is nothing to add", () => {
    expect(formatVaultContext({ hits: [], memoryEntries: [] })).toBe("");
  });

  it("renders hits with title + tidied snippet and strips FTS markers", () => {
    const out = formatVaultContext({
      hits: [
        { title: "Guard Roster", snippet: "the ⟦night⟧ shift  rota", path: "a.md" },
      ],
      memoryEntries: [],
    });
    expect(out).toContain("Relevant notes from this workspace:");
    expect(out).toContain("- Guard Roster: the night shift rota");
    expect(out).not.toContain("⟦");
  });

  it("falls back to the path when a hit has no title", () => {
    const out = formatVaultContext({
      hits: [{ title: "", snippet: "", path: "vault/x.md" }],
      memoryEntries: [],
    });
    expect(out).toContain("- vault/x.md");
  });

  it("renders memory entries and the vault path footer", () => {
    const out = formatVaultContext({
      hits: [],
      memoryEntries: ["Owner of a security guarding business."],
      vaultPath: "/home/sps/vault",
    });
    expect(out).toContain("What you remember about the user:");
    expect(out).toContain("- Owner of a security guarding business.");
    expect(out).toContain("/home/sps/vault");
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
    });
    expect(out.length).toBeLessThanOrEqual(4002);
  });
});
