// Standalone runtime proof for the S1 note indexer. Runs under Electron's node
// (ELECTRON_RUN_AS_NODE=1) so the Electron-ABI better-sqlite3 binary loads.
// Bundled via esbuild and executed by scripts/verify-note-index.sh.
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  NoteIndex,
  getNoteIndexForRoot,
  closeAllNoteIndexes,
} from "../src/main/note-index";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok -", msg);
}

function eq(a: unknown, b: unknown, msg: string): void {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `${msg} (got ${JSON.stringify(a)})`,
  );
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "note-index-verify-"));
  await writeFile(
    join(root, "alpha.md"),
    `---\nstatus: doing\npriority: high\ntags: [research, "ml/nlp"]\n---\n# Alpha\nThe quick brown fox links to [[beta]]. Filed #urgent.\n`,
  );
  await writeFile(
    join(root, "beta.md"),
    `---\nstatus: done\npriority: low\n---\n# Beta\nA lazy dog. See [[alpha]] and [[gamma]].\n`,
  );
  await mkdir(join(root, "projects"), { recursive: true });
  await writeFile(
    join(root, "projects", "gamma.md"),
    `---\nstatus: doing\n---\n# Gamma\nNested note.\n`,
  );
  await writeFile(join(root, ".ignore.md"), `# Hidden`);

  const index = await NoteIndex.open(root);

  eq(index.status().notes, 3, "indexes 3 notes, skips hidden .ignore.md");

  const titles = index
    .query({})
    .map((n) => n.title)
    .sort();
  eq(titles, ["Alpha", "Beta", "Gamma"], "derives titles from first heading");

  const doing = index
    .query({ filters: [{ prop: "status", op: "eq", value: "doing" }] })
    .map((n) => n.path)
    .sort();
  eq(
    doing,
    ["alpha.md", "projects/gamma.md"],
    "filters by frontmatter property",
  );

  const sorted = index
    .query({
      filters: [{ prop: "priority", op: "exists" }],
      sort: { prop: "priority", dir: "asc" },
    })
    .map((n) => n.props.priority);
  eq(sorted, ["high", "low"], "sorts by frontmatter property");

  const scoped = index.query({ scope: "projects" }).map((n) => n.path);
  eq(scoped, ["projects/gamma.md"], "scopes a query to a folder");

  const hits = index.search("brown").map((h) => h.path);
  assert(hits.includes("alpha.md"), "FTS search finds body text");

  // "all" (default, AND) requires every term; a term not present ⇒ no match.
  eq(
    index.search("brown zzznotpresent").length,
    0,
    'search("all" mode) requires every term',
  );
  // "any" (OR) matches on any term — used by grounding so a natural-language
  // question still retrieves docs that share only some words.
  assert(
    index
      .search("brown zzznotpresent", 20, "any")
      .map((h) => h.path)
      .includes("alpha.md"),
    'search("any" mode) matches on any term (grounding path)',
  );

  eq(index.backlinks("alpha.md"), ["beta.md"], "backlinks alpha <- beta");
  eq(
    index.backlinks("projects/gamma.md"),
    ["beta.md"],
    "backlinks gamma <- beta",
  );

  const edges = index
    .links()
    .map((e) => `${e.source} -> ${e.target}`)
    .sort();
  eq(
    edges,
    [
      "alpha.md -> beta.md",
      "beta.md -> alpha.md",
      "beta.md -> projects/gamma.md",
    ],
    "links() resolves wikilink edges to indexed notes",
  );

  // Tags: frontmatter array + inline #tag, case-insensitive lookup.
  const tagNames = index
    .allTags()
    .map((t) => t.tag)
    .sort();
  eq(
    tagNames,
    ["ml/nlp", "research", "urgent"],
    "allTags harvests frontmatter + inline #tags",
  );
  eq(
    index.notesByTag("research"),
    ["alpha.md"],
    "notesByTag finds the frontmatter-tagged note",
  );
  eq(
    index.notesByTag("RESEARCH"),
    ["alpha.md"],
    "notesByTag is case-insensitive",
  );
  eq(
    index.notesByTag("urgent"),
    ["alpha.md"],
    "notesByTag finds an inline #tag",
  );

  const before = index
    .query({})
    .map((n) => `${n.path}:${n.title}`)
    .sort();
  await index.rebuild();
  const after = index
    .query({})
    .map((n) => `${n.path}:${n.title}`)
    .sort();
  eq(after, before, "rebuild from disk is identical (markdown is sole truth)");

  await index.close();
  await rm(root, { recursive: true, force: true });

  // ── S3: getNoteIndexForRoot on a mirror-shaped vault (frontmatter + wikilinks).
  console.log("\nS3 — getNoteIndexForRoot over a mirror-shaped vault:");
  const vault = await mkdtemp(join(tmpdir(), "note-index-vault-"));
  await writeFile(
    join(vault, "home.md"),
    `---\ntitle: "Home"\nicon: "🏠"\n---\n\n# Home\n\nSee [[tasks]].\n`,
  );
  await writeFile(
    join(vault, "tasks.md"),
    `---\ntitle: "Tasks"\nstatus: doing\n---\n\n# Tasks\n\nWork.\n`,
  );

  const v1 = await getNoteIndexForRoot(vault);
  const v2 = await getNoteIndexForRoot(vault);
  assert(v1 === v2, "same root returns the cached index instance");
  eq(v1.status().notes, 2, "vault index sees 2 mirrored pages");
  eq(
    v1
      .query({ filters: [{ prop: "status", op: "eq", value: "doing" }] })
      .map((n) => n.path),
    ["tasks.md"],
    "queries a frontmatter property written by the mirror",
  );
  eq(
    v1
      .query({})
      .map((n) => n.title)
      .sort(),
    ["Home", "Tasks"],
    "titles come from frontmatter",
  );
  eq(
    v1.backlinks("tasks.md"),
    ["home.md"],
    "[[wikilink]] backlink resolves (home -> tasks)",
  );
  eq(
    v1.links().map((e) => `${e.source} -> ${e.target}`),
    ["home.md -> tasks.md"],
    "links() returns the resolved home -> tasks edge",
  );

  await closeAllNoteIndexes();
  await rm(vault, { recursive: true, force: true });

  // ── Lint: orphans + broken [[wikilinks]] over a small vault.
  console.log("\nLint — orphans + broken links:");
  const lroot = await mkdtemp(join(tmpdir(), "note-index-lint-"));
  await writeFile(
    join(lroot, "a.md"),
    `# A\nLinks to [[b]] and a missing [[ghost]].\n`,
  );
  await writeFile(join(lroot, "b.md"), `# B\nLinks back to [[a]].\n`);
  await writeFile(join(lroot, "lonely.md"), `# Lonely\nNo links here.\n`);
  // META pages: the auto-index links EVERY page (incl. lonely); those
  // navigational links must NOT mask a genuine orphan, and the link-free META
  // pages (log/WIKI) must NOT themselves be reported as orphans.
  await writeFile(
    join(lroot, "index.md"),
    `# Index\n- [[a]]\n- [[b]]\n- [[lonely]]\n`,
  );
  await writeFile(
    join(lroot, "log.md"),
    `# Wiki log\n## [2026-06-09] ingest | x\n`,
  );
  await writeFile(join(lroot, "WIKI.md"), `# Schema\nConventions.\n`);

  const li = await NoteIndex.open(lroot);
  eq(
    li.unresolvedLinks().map((e) => `${e.source}->${e.target}`),
    ["a.md->ghost"],
    "unresolvedLinks flags the broken [[ghost]] link only",
  );
  eq(
    li.orphans(),
    ["lonely.md"],
    "orphans: lonely stays an orphan despite the index link; index/log/WIKI excluded",
  );
  const report = li.lint();
  eq(report.brokenLinks.length, 1, "lint() composes broken links");
  eq(report.orphans, ["lonely.md"], "lint() composes orphans");
  await li.close();
  await rm(lroot, { recursive: true, force: true });

  // ── Typed Links: relationship type extraction
  console.log("\nTyped Links — relationship type extraction:");
  const tlroot = await mkdtemp(join(tmpdir(), "note-index-typed-"));
  await writeFile(
    join(tlroot, "employer.md"),
    `# Employer\nEmploying [[works_at::Garry Tan]].\n`,
  );
  await writeFile(join(tlroot, "garry tan.md"), `# Garry Tan\nCEO.\n`);
  const tli = await NoteIndex.open(tlroot);
  const tledges = tli.links();
  eq(tledges.length, 1, "finds one resolved edge");
  eq(
    tledges[0].type,
    "works_at",
    "typed link has the relation type 'works_at'",
  );

  const tlunresolved = tli.unresolvedLinks();
  eq(tlunresolved.length, 0, "no unresolved links yet");

  await writeFile(
    join(tlroot, "employer.md"),
    `# Employer\nEmploying [[works_at::Garry Tan]] and [[advises::Unknown Person]].\n`,
  );
  await tli.rebuild();
  const tlunresolvedAfter = tli.unresolvedLinks();
  eq(tlunresolvedAfter.length, 1, "finds one unresolved edge");
  eq(
    tlunresolvedAfter[0].target,
    "unknown person",
    "broken link target normalized name",
  );
  eq(
    tlunresolvedAfter[0].type,
    "advises",
    "broken typed link has the type 'advises'",
  );

  await tli.close();
  await rm(tlroot, { recursive: true, force: true });

  closeAllNoteIndexes();
  console.log("\nALL NOTE-INDEX CHECKS PASSED");
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
