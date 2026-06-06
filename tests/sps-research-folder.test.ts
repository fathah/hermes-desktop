import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../src/renderer/src/screens/SpsAgent/store";
import type { WorkDetail } from "../src/shared/openalex/core";

// ensureResearchFolder + importResearchWork: saved OpenAlex papers get a
// "Research" home nested under "Sources", each rendered as a curated page.
// No window.hermesAPI in jsdom → the TL;DR degrades to the abstract's first
// sentences (the never-hard-fail path).

function resetWorkspace(): void {
  useStore.setState({
    tree: [{ id: "home", children: [] }],
    meta: { home: { icon: "🏠", title: "Home", cover: null } },
    docs: { home: [] },
    page: "home",
  });
}

const WORK: WorkDetail = {
  id: "W42",
  title: "On Widgets",
  year: 2021,
  authors: ["Ada Lovelace"],
  venue: "J. Widgets",
  citedByCount: 7,
  isOA: true,
  oaUrl: "https://x/y.pdf",
  topics: ["Widget Theory", "Gears"],
  doi: "10.1/abc",
  abstract: "Widgets matter. This paper explains why in detail.",
  referencedCount: 3,
  relatedIds: [],
};

describe("ensureResearchFolder", () => {
  beforeEach(resetWorkspace);

  it("creates a 'Research' folder nested under 'Sources'", () => {
    const research = useStore.getState().ensureResearchFolder();
    const { meta, tree } = useStore.getState();
    expect(meta[research]?.title).toBe("Research");
    const sources = tree.find((n) => meta[n.id]?.title === "Sources");
    expect(sources?.children.some((c) => c.id === research)).toBe(true);
  });

  it("reuses the same Research folder (no duplicate)", () => {
    const a = useStore.getState().ensureResearchFolder();
    const b = useStore.getState().ensureResearchFolder();
    expect(b).toBe(a);
  });
});

describe("importResearchWork", () => {
  beforeEach(resetWorkspace);

  it("writes a curated page under Research with TL;DR, abstract, glance, PDF, tags", async () => {
    await useStore.getState().importResearchWork(WORK);
    const { page, meta, docs, tree } = useStore.getState();

    // page selected + provenance stamped
    expect(meta[page]?.title).toBe("On Widgets");
    expect(meta[page]?.source).toBe("openalex:W42");

    // filed under Sources/Research
    const sources = tree.find((n) => meta[n.id]?.title === "Sources");
    const research = sources?.children.find(
      (n) => meta[n.id]?.title === "Research",
    );
    expect(research?.children.some((c) => c.id === page)).toBe(true);

    const blocks = docs[page];
    const callout = blocks.find((b) => b.type === "callout");
    expect(callout?.emoji).toBe("🧭");
    expect(callout?.text).toContain("Widgets matter"); // abstract fallback TL;DR
    expect(
      blocks.some((b) => b.type === "p" && b.text.includes("7 citations")),
    ).toBe(true);
    expect(
      blocks.some(
        (b) => b.type === "bookmark" && b.bm?.url === "https://x/y.pdf",
      ),
    ).toBe(true);
    expect(
      blocks.some((b) => b.type === "p" && b.text.includes("#Widget-Theory")),
    ).toBe(true);
  });

  it("omits the bookmark when there is no open-access PDF", async () => {
    await useStore.getState().importResearchWork({ ...WORK, oaUrl: undefined });
    const { page, docs } = useStore.getState();
    expect(docs[page].some((b) => b.type === "bookmark")).toBe(false);
  });
});
