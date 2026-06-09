// sps-ingest.test.ts — pure ingest helpers + read-only capture/schema I/O.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  slugifyPageId,
  parseChangeset,
  buildIngestMessages,
  buildFileAnswerMessages,
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
