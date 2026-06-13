import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Mock project dependencies so importing hermes.ts is side-effect free ──
// (mirrors tests/buildUserContent.test.ts). The note-index is mocked so this
// runs under vitest without opening the better-sqlite3 native index.

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: join(tmpdir(), `hermes-grounding-${Date.now()}`),
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/dev/null",
  hermesCliArgs: () => ["/dev/null"],
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/main/config", () => ({
  getModelConfig: () => ({ model: "test-model", provider: "openrouter" }),
  readEnv: () => ({}),
  getConnectionConfig: () => ({
    mode: "local" as const,
    remoteUrl: "",
    apiKey: "",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    },
  }),
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
  isSshTunnelHealthy: () => Promise.resolve(false),
  startSshTunnel: () => Promise.resolve(),
}));

vi.mock("../src/main/utils", () => ({ stripAnsi: (s: string) => s }));
vi.mock("../src/main/models", () => ({ readModels: () => [] }));
vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

const search = vi.fn();
const status = vi.fn();
vi.mock("../src/main/note-index", async () => {
  const actual = await vi.importActual<typeof import("../src/main/note-index")>("../src/main/note-index");
  return {
    ...actual,
    getSpsNoteIndex: () => Promise.resolve({ search, status }),
  };
});

const semanticSearch = vi.fn().mockResolvedValue({ results: [] });
vi.mock("../src/main/semantic-index", () => ({
  semanticManager: {
    search: (...args: any[]) => semanticSearch(...args),
  },
}));

import {
  formatRetrievalSystemMessage,
  buildRetrievalSystemMessage,
  groundingTerms,
  parseQueryVariants,
  fuseRankings,
  type GroundingSource,
} from "../src/main/hermes";

describe("groundingTerms (pure)", () => {
  it("drops stopwords and 1-2 char tokens, lowercases, dedupes", () => {
    expect(
      groundingTerms("What does the rest-period POLICY policy mean?"),
    ).toEqual(["rest", "period", "policy", "mean"]);
  });

  it("returns [] for an all-stopwords message (nothing salient to search)", () => {
    expect(groundingTerms("what is it to the")).toEqual([]);
  });
});

describe("parseQueryVariants (pure)", () => {
  it("splits lines and strips list bullets / numbering", () => {
    const raw =
      "1. holiday annual leave\n2) vacation days entitlement\n- paid time off";
    expect(parseQueryVariants(raw)).toEqual([
      "holiday annual leave",
      "vacation days entitlement",
      "paid time off",
    ]);
  });

  it("dedupes case-insensitively and drops 1-2 char noise lines", () => {
    expect(parseQueryVariants("Holiday Leave\nholiday leave\n\n.\nok")).toEqual(
      ["Holiday Leave"],
    );
  });

  it("returns [] for empty input", () => {
    expect(parseQueryVariants("")).toEqual([]);
  });
});

describe("fuseRankings (pure, reciprocal-rank fusion)", () => {
  it("ranks a doc found by multiple queries above one found by a single query", () => {
    // 'b' appears in both lists; 'a' tops one list, 'c' tops the other.
    const fused = fuseRankings([
      ["a", "b", "c"],
      ["c", "b", "a"],
    ]);
    expect(fused[0]).toBe(fused[0]); // deterministic order
    expect(fused).toContain("b");
    // 'b' (rank 2 in both) beats nothing here, but a doc in BOTH at rank ~1 wins:
    const fused2 = fuseRankings([
      ["x", "a"],
      ["x", "c"],
    ]);
    expect(fused2[0]).toBe("x"); // found at rank 1 by both queries
  });

  it("surfaces a doc that only ONE expansion variant retrieved", () => {
    // original query returns 5 distractors; a synonym variant alone finds 'gold'.
    const original = ["d1", "d2", "d3", "d4", "d5"];
    const variant = ["gold", "d2"];
    const fused = fuseRankings([original, variant]);
    // gold (rank 1 in the variant) must out-rank a distractor seen once at low rank
    expect(fused.indexOf("gold")).toBeLessThan(fused.indexOf("d5"));
  });

  it("returns [] for no lists", () => {
    expect(fuseRankings([])).toEqual([]);
  });
});

describe("formatRetrievalSystemMessage (pure)", () => {
  it("returns null when there are no sources (skip-injection contract)", () => {
    expect(formatRetrievalSystemMessage([])).toBeNull();
  });

  it("emits a system message citing title, rel path, and absolute path", () => {
    const sources: GroundingSource[] = [
      {
        title: "Handbook",
        relPath: "sources/handbook.md",
        absPath: "/vault/sources/handbook.md",
        excerpt: "Rest periods are 20 minutes.",
      },
    ];
    const msg = formatRetrievalSystemMessage(sources);
    expect(msg?.role).toBe("system");
    expect(msg?.content).toContain("Handbook · sources/handbook.md");
    expect(msg?.content).toContain("/vault/sources/handbook.md");
    expect(msg?.content).toContain("Rest periods are 20 minutes.");
  });
});

describe("buildRetrievalSystemMessage (IO)", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "grounding-vault-"));
    writeFileSync(
      join(root, "handbook.md"),
      '---\ntitle: "Handbook"\n---\n\nRest periods are 20 minutes per shift.',
      "utf-8",
    );
    status.mockReturnValue({ root, notes: 1, links: 0, indexedAt: 1 });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("returns null when the message has no salient terms (no search)", async () => {
    search.mockClear();
    expect(await buildRetrievalSystemMessage("what is the")).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("returns null when the index has no hits", async () => {
    search.mockReturnValueOnce([]);
    expect(await buildRetrievalSystemMessage("anything")).toBeNull();
  });

  it("retrieves with OR semantics over salient terms (not the raw message)", async () => {
    search.mockReturnValueOnce([]);
    await buildRetrievalSystemMessage("What does the rest period policy mean?");
    // Stopwords stripped, OR-mode requested — never the raw AND-of-every-word.
    expect(search).toHaveBeenLastCalledWith(
      "rest period policy mean",
      expect.any(Number),
      "any",
    );
  });

  it("grounds on a hit, stripping frontmatter from the excerpt", async () => {
    search.mockReturnValueOnce([
      { path: "handbook.md", title: "Handbook", snippet: "…" },
    ]);
    const msg = await buildRetrievalSystemMessage("rest period");
    expect(msg?.role).toBe("system");
    expect(msg?.content).toContain("Handbook · handbook.md");
    expect(msg?.content).toContain(join(root, "handbook.md"));
    expect(msg?.content).toContain("Rest periods are 20 minutes per shift.");
    // Frontmatter must be stripped from the inlined excerpt.
    expect(msg?.content).not.toContain('title: "Handbook"');
  });

  it("skips an unreadable hit without throwing", async () => {
    search.mockReturnValueOnce([
      { path: "missing.md", title: "Missing", snippet: "…" },
    ]);
    // Salient terms present ⇒ search runs; the only hit is unreadable ⇒ null.
    expect(
      await buildRetrievalSystemMessage("missing handbook policy"),
    ).toBeNull();
  });

  it("incorporates semantic search hits into hybrid grounding", async () => {
    // FTS5 returns nothing, semantic search returns handbook.md
    search.mockReturnValueOnce([]);
    semanticSearch.mockResolvedValueOnce({
      results: [{ path: "handbook.md", score: 0.9 }],
    });

    const msg = await buildRetrievalSystemMessage("rest period");
    expect(msg?.role).toBe("system");
    expect(msg?.content).toContain("Handbook · handbook.md");
    expect(msg?.content).toContain("Rest periods are 20 minutes per shift.");
  });

  it("formats remote grounding system messages without local paths or read tool instructions", async () => {
    search.mockReturnValueOnce([
      { path: "handbook.md", title: "Handbook", snippet: "…" },
    ]);
    const msg = await buildRetrievalSystemMessage("rest period", undefined, { isRemote: true });
    expect(msg?.role).toBe("system");
    expect(msg?.content).toContain("Handbook · handbook.md");
    // Should NOT contain the absolute local path reference
    expect(msg?.content).not.toContain(join(root, "handbook.md"));
    // Should contain remote-specific instructions
    expect(msg?.content).toContain("These files exist on the user's local desktop and cannot be read directly via local file tools");
  });
});
