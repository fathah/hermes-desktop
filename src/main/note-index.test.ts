// note-index.test.ts — pure-logic unit tests that run under vitest/node.
//
// The SQLite integration (query/search/backlinks/rebuild) can't run here because
// better-sqlite3 is compiled for Electron's node ABI, not the vitest node ABI.
// That path is proven end-to-end by `npm run verify:note-index`, which runs
// scripts/verify-note-index.ts under ELECTRON_RUN_AS_NODE=1. Keep this file to
// the pure functions that need no native module.
import { describe, expect, it } from "vitest";
import { findUnlinkedMentionTargets, parseFrontmatter } from "./note-index";

describe("parseFrontmatter", () => {
  it("splits YAML frontmatter from the body", () => {
    const { props, body } = parseFrontmatter(
      `---\nstatus: doing\npriority: high\n---\nHello world`,
    );
    expect(props).toEqual({ status: "doing", priority: "high" });
    expect(body.trim()).toBe("Hello world");
  });

  it("returns the whole input as body when there is no frontmatter", () => {
    const { props, body } = parseFrontmatter(`# Just markdown`);
    expect(props).toEqual({});
    expect(body).toBe("# Just markdown");
  });

  it("ignores non-object frontmatter (e.g. a bare list)", () => {
    const { props } = parseFrontmatter(`---\n- a\n- b\n---\nbody`);
    expect(props).toEqual({});
  });

  it("never throws on malformed YAML", () => {
    const { props, body } = parseFrontmatter(`---\n: : bad : :\n---\nbody`);
    expect(props).toEqual({});
    expect(body).toBe("body");
  });
});

describe("findUnlinkedMentionTargets", () => {
  it("matches page ids, titles, and aliases while ignoring explicit wikilinks", () => {
    const hits = findUnlinkedMentionTargets(
      "Atlas depends on Maya. [[Roadmap]] is already linked. Atlassian is not Atlas.",
      [
        {
          path: "Project-Atlas.md",
          title: "Project Atlas",
          props: { aliases: ["Atlas"] },
          mtime: 1,
        },
        {
          path: "Roadmap.md",
          title: "Roadmap",
          props: {},
          mtime: 1,
        },
        {
          path: "Maya.md",
          title: "Maya",
          props: {},
          mtime: 1,
        },
      ],
      "Home.md",
    );

    expect(hits).toEqual([
      { source: "Home.md", target: "Maya.md", phrase: "Maya" },
      { source: "Home.md", target: "Project-Atlas.md", phrase: "Atlas" },
    ]);
  });
});
