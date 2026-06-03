import { describe, it, expect } from "vitest";
import {
  searchWorkspacePages,
  type PageHit,
} from "../src/renderer/src/screens/SpsAgent/lib/ask";
import type {
  Block,
  PageMeta,
} from "../src/renderer/src/screens/SpsAgent/types";

function block(text: string): Block {
  return { id: Math.random().toString(36).slice(2), type: "p", text };
}
const meta = (title: string): PageMeta => ({ icon: "", title, cover: null });

const docs: Record<string, Block[]> = {
  p1: [
    block("Quarterly budget planning for the cafe"),
    block("rent and staff"),
  ],
  p2: [block("Guard roster and shift handover notes")],
  p3: [block("random unrelated content")],
};
const metas: Record<string, PageMeta> = {
  p1: meta("Budget 2026"),
  p2: meta("Security Roster"),
  p3: meta("Scratchpad"),
};

describe("searchWorkspacePages", () => {
  it("matches page body text and returns a snippet", () => {
    const hits = searchWorkspacePages("rent", docs, metas);
    expect(hits.map((h) => h.pageId)).toContain("p1");
    const p1 = hits.find((h) => h.pageId === "p1")!;
    expect(p1.title).toBe("Budget 2026");
    expect(p1.snippet.toLowerCase()).toContain("rent");
  });

  it("matches page titles too", () => {
    const hits = searchWorkspacePages("roster", docs, metas);
    expect(hits.some((h) => h.pageId === "p2")).toBe(true);
  });

  it("ranks title matches above body matches", () => {
    // "budget" is in p1's title AND p1's body; add a page with budget only in body
    const d = {
      ...docs,
      p4: [block("we discussed budget overruns")],
    };
    const m = { ...metas, p4: meta("Notes") };
    const hits = searchWorkspacePages("budget", d, m);
    // p1 (title match) should come before p4 (body-only match)
    const idxP1 = hits.findIndex((h) => h.pageId === "p1");
    const idxP4 = hits.findIndex((h) => h.pageId === "p4");
    expect(idxP1).toBeGreaterThanOrEqual(0);
    expect(idxP4).toBeGreaterThan(idxP1);
  });

  it("is case-insensitive", () => {
    expect(searchWorkspacePages("GUARD", docs, metas).length).toBeGreaterThan(
      0,
    );
  });

  it("returns [] for empty query or no matches", () => {
    expect(searchWorkspacePages("", docs, metas)).toEqual([]);
    expect(searchWorkspacePages("zzznotfound", docs, metas)).toEqual([]);
  });

  it("respects the limit", () => {
    const many: Record<string, Block[]> = {};
    const manyMeta: Record<string, PageMeta> = {};
    for (let i = 0; i < 20; i++) {
      many[`x${i}`] = [block("apple pie recipe")];
      manyMeta[`x${i}`] = meta(`Page ${i}`);
    }
    const hits: PageHit[] = searchWorkspacePages("apple", many, manyMeta, 5);
    expect(hits.length).toBe(5);
  });
});
