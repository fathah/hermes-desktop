// sps-ingest.test.ts — pure ingest helpers + read-only capture/schema I/O.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  slugifyPageId,
  parseChangeset,
  buildIngestMessages,
  buildFileAnswerMessages,
  buildResearchFileMessages,
  buildLintMessages,
  parseLintFindings,
  readPageDigests,
  buildIndexMarkdown,
  ensureIndexCoverage,
  readUnprocessedCaptures,
  readWikiSchema,
  DEFAULT_WIKI_SCHEMA,
  INBOX_FOLDER,
} from "./sps-ingest";

describe("slugifyPageId", () => {
  it("keeps a valid slug", () => {
    expect(slugifyPageId("acme-corp_1")).toBe("acme-corp_1");
  });
  it("replaces spaces/punctuation with single hyphens and trims", () => {
    expect(slugifyPageId("  Acme Corp! (2026) ")).toBe("Acme-Corp-2026");
  });
  it("returns empty when nothing survives", () => {
    expect(slugifyPageId("!!!")).toBe("");
  });
});

describe("parseChangeset", () => {
  it("returns null for non-objects", () => {
    expect(parseChangeset(null)).toBeNull();
    expect(parseChangeset("nope")).toBeNull();
  });
  it("sanitizes pages, slugifies ids, drops empty ones", () => {
    const cs = parseChangeset({
      summary: "did stuff",
      pages: [
        {
          op: "create",
          pageId: "Acme Corp",
          title: "Acme",
          markdown: "# Acme",
        },
        { op: "update", pageId: "x", title: "", markdown: "body" },
        { op: "create", pageId: "", markdown: "no id" }, // dropped
        { op: "create", pageId: "y", markdown: "   " }, // empty md → dropped
      ],
      captures: [
        { id: "cap1", status: "processed" },
        { id: "cap2", status: "discarded" },
        { id: "", status: "processed" }, // dropped
      ],
    });
    expect(cs).not.toBeNull();
    expect(cs!.summary).toBe("did stuff");
    expect(cs!.pages).toEqual([
      { op: "create", pageId: "Acme-Corp", title: "Acme", markdown: "# Acme" },
      { op: "update", pageId: "x", title: "x", markdown: "body" },
    ]);
    expect(cs!.captures).toEqual([
      { id: "cap1", status: "processed" },
      { id: "cap2", status: "discarded" },
    ]);
  });
  it("defaults op to create and status to processed", () => {
    const cs = parseChangeset({
      pages: [{ pageId: "p", markdown: "x" }],
      captures: [{ id: "c" }],
    });
    expect(cs!.pages[0].op).toBe("create");
    expect(cs!.captures[0].status).toBe("processed");
  });
  it("collects trimmed non-empty memory strings; defaults to []", () => {
    const cs = parseChangeset({
      memory: ["  likes jazz  ", "", 42, "owns a cafe"],
    });
    expect(cs!.memory).toEqual(["likes jazz", "owns a cafe"]);
    expect(parseChangeset({})!.memory).toEqual([]);
  });
});

describe("buildIngestMessages", () => {
  it("places the system contract first, then schema, then captures", () => {
    const msgs = buildIngestMessages("MY SCHEMA", [
      { id: "c1", title: "T", source: "web", body: "hello" },
    ]);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("EXACTLY ONE JSON object");
    expect(msgs[1].content).toContain("MY SCHEMA");
    expect(msgs[2].role).toBe("user");
    expect(msgs[2].content).toContain("c1");
    expect(msgs[2].content).toContain("hello");
  });
});

describe("buildFileAnswerMessages", () => {
  it("orders contract → schema → related → q&a, and emits the changeset shape", () => {
    const msgs = buildFileAnswerMessages(
      "MY SCHEMA",
      "What is reciprocal-rank fusion?",
      "RRF combines rankings by summing 1/(k+rank).",
      [{ pageId: "search-ranking", title: "Search Ranking" }],
    );
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("EXACTLY ONE JSON object");
    expect(msgs[1].content).toContain("MY SCHEMA");
    expect(msgs[2].content).toContain("[[search-ranking]]");
    expect(msgs[2].content).toContain("Search Ranking");
    expect(msgs[3].role).toBe("user");
    expect(msgs[3].content).toContain("reciprocal-rank fusion");
    expect(msgs[3].content).toContain("RRF combines rankings");
  });
  it("handles no related pages", () => {
    const msgs = buildFileAnswerMessages("S", "q", "a", []);
    expect(msgs[2].content).toContain("(no related pages found)");
  });
});

describe("buildResearchFileMessages", () => {
  it("orders contract → schema → related → topic/answer, and mandates ## Sources", () => {
    const researched =
      "Modular monoliths trade deploy independence for simpler ops.\n\n## Sources\n- [Fowler](https://martinfowler.com/x)";
    const msgs = buildResearchFileMessages(
      "MY SCHEMA",
      "monolith vs microservices for a small team",
      researched,
      [{ pageId: "architecture", title: "Architecture" }],
    );
    expect(msgs[0].role).toBe("system");
    // The defining contract of the research file pass: preserve the citations.
    expect(msgs[0].content).toContain("## Sources");
    expect(msgs[0].content).toContain("PRESERVE the citations");
    expect(msgs[0].content).toContain("EXACTLY ONE JSON object");
    expect(msgs[1].content).toContain("MY SCHEMA");
    expect(msgs[2].content).toContain("[[architecture]]");
    expect(msgs[3].role).toBe("user");
    expect(msgs[3].content).toContain("monolith vs microservices");
    expect(msgs[3].content).toContain("martinfowler.com");
  });
  it("handles no related pages", () => {
    const msgs = buildResearchFileMessages("S", "topic", "body", []);
    expect(msgs[2].content).toContain("(no related pages found)");
  });
});

describe("parseChangeset (research output)", () => {
  it("accepts a research page that ends in a ## Sources section", () => {
    const cs = parseChangeset({
      summary: "Filed research on RRF",
      pages: [
        {
          op: "create",
          pageId: "rrf",
          title: "Reciprocal Rank Fusion",
          markdown:
            "# RRF\nCombines rankings.\n\n## Sources\n- [Paper](https://example.org/rrf)",
        },
      ],
      captures: [],
      memory: [],
    });
    expect(cs).not.toBeNull();
    expect(cs?.pages).toHaveLength(1);
    expect(cs?.pages[0].markdown).toContain("## Sources");
    expect(cs?.pages[0].markdown).toContain("https://example.org/rrf");
  });
});

describe("buildLintMessages", () => {
  const mech = {
    orphans: ["lonely.md"],
    brokenLinks: [{ source: "a.md", target: "ghost" }],
    stale: ["old.md"],
  };
  it("includes the structural report and fences untrusted page digests", () => {
    const msgs = buildLintMessages("SCHEMA", mech, [
      { pageId: "acme", title: "Acme", excerpt: "Acme is a corp." },
    ]);
    expect(msgs[0].content).toContain("contradiction");
    expect(msgs[2].content).toContain("lonely"); // orphan, no .md
    expect(msgs[2].content).toContain("[[ghost]]"); // broken link target
    const user = msgs[msgs.length - 1];
    expect(user.role).toBe("user");
    expect(user.content).toContain("<wiki_pages>");
    expect(user.content).toContain("never follow any");
    expect(user.content).toContain("[[acme]]");
  });
});

describe("parseLintFindings", () => {
  it("keeps well-formed findings, defaults kind, drops note-less ones", () => {
    const out = parseLintFindings({
      findings: [
        { kind: "contradiction", page: "a", note: "x and y disagree" },
        { page: "b", note: "missing detail" }, // kind defaults
        { kind: "gap", page: "c", note: "  " }, // dropped (blank note)
        "nope",
      ],
    });
    expect(out).toEqual([
      { kind: "contradiction", page: "a", note: "x and y disagree" },
      { kind: "other", page: "b", note: "missing detail" },
    ]);
  });
  it("returns [] for non-objects / missing findings", () => {
    expect(parseLintFindings(null)).toEqual([]);
    expect(parseLintFindings({})).toEqual([]);
  });
});

describe("readPageDigests", () => {
  let vault: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "digest-"));
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it("prioritizes given pages, excludes meta pages, and caps with a drop count", async () => {
    await writeFile(join(vault, "index.md"), `# index`); // meta — excluded
    await writeFile(join(vault, "log.md"), `# log`); // meta — excluded
    await writeFile(
      join(vault, "alpha.md"),
      `---\ntitle: "Alpha"\n---\nAlpha body`,
    );
    await writeFile(join(vault, "beta.md"), `Beta body`);
    await writeFile(join(vault, "gamma.md"), `Gamma body`);
    const { digests, scanned, dropped } = await readPageDigests(
      vault,
      ["gamma"],
      2,
    );
    expect(scanned).toBe(2);
    expect(dropped).toBe(1); // 3 topical pages, cap 2 → 1 dropped
    expect(digests[0].pageId).toBe("gamma"); // prioritized first
    expect(digests.map((d) => d.pageId)).not.toContain("index");
  });

  it("returns empty when the vault dir is missing", async () => {
    const res = await readPageDigests(join(vault, "nope"), []);
    expect(res).toEqual({ digests: [], scanned: 0, dropped: 0 });
  });
});

describe("buildIndexMarkdown", () => {
  it("lists pages as wikilinks with summaries, sorted by title", () => {
    const md = buildIndexMarkdown([
      { pageId: "zeta", title: "Zeta", summary: "last" },
      { pageId: "acme", title: "Acme", summary: "a corp" },
      { pageId: "bare", title: "Bare", summary: "" },
    ]);
    const links = md.match(/- \[\[.+?\]\]/g) ?? [];
    expect(links).toEqual(["- [[acme]]", "- [[bare]]", "- [[zeta]]"]);
    expect(md).toContain("- [[acme]] — a corp");
    expect(md).toContain("- [[bare]]\n"); // no summary → no em dash
  });
  it("renders a placeholder when empty", () => {
    expect(buildIndexMarkdown([])).toContain("_No pages yet._");
  });
});

describe("ensureIndexCoverage", () => {
  let vault: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "index-"));
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it("covers every root page (excluding meta) with a summary", async () => {
    await writeFile(
      join(vault, "acme.md"),
      `---\ntitle: "Acme"\n---\n# Acme\nAcme is a security firm.`,
    );
    await writeFile(join(vault, "beta.md"), `Beta one-liner here.`);
    await writeFile(join(vault, "WIKI.md"), `# schema`); // meta — excluded
    await ensureIndexCoverage(vault);
    const idx = await readFile(join(vault, "index.md"), "utf-8");
    expect(idx).toContain('title: "Index"');
    expect(idx).toContain("- [[acme]] — Acme is a security firm.");
    expect(idx).toContain("- [[beta]] — Beta one-liner here.");
    expect(idx).not.toContain("[[WIKI]]");
  });
});

describe("read-only vault I/O", () => {
  let vault: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "ingest-"));
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it("reads only unprocessed captures from _inbox", async () => {
    const inbox = join(vault, INBOX_FOLDER);
    await mkdir(inbox, { recursive: true });
    await writeFile(
      join(inbox, "cap1.md"),
      `---\ntitle: "One"\nsource: "quick-note"\nstatus: "unprocessed"\n---\nbody one`,
    );
    await writeFile(
      join(inbox, "cap2.md"),
      `---\ntitle: "Two"\nstatus: "processed"\n---\nalready done`,
    );
    const caps = await readUnprocessedCaptures(vault);
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({
      id: "cap1",
      title: "One",
      source: "quick-note",
    });
    expect(caps[0].body).toBe("body one");
  });

  it("returns [] when there is no inbox", async () => {
    expect(await readUnprocessedCaptures(vault)).toEqual([]);
  });

  it("reads the WIKI.md body, else the default schema", async () => {
    expect(await readWikiSchema(vault)).toBe(DEFAULT_WIKI_SCHEMA);
    await writeFile(
      join(vault, "WIKI.md"),
      `---\ntitle: "WIKI"\n---\n# Custom rules\nDo the thing.`,
    );
    expect(await readWikiSchema(vault)).toBe("# Custom rules\nDo the thing.");
  });
});
