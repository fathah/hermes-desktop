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
import {
  snapshotWorkspaceTo,
  restoreSnapshotFrom,
} from "../src/main/sps-backups";

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

  // ── Self-healing: corrupt derived SQLite state is discarded and rebuilt.
  console.log("\nSelf-healing — corrupt cache rebuilds from markdown:");
  {
    const corruptRoot = await mkdtemp(join(tmpdir(), "note-index-corrupt-"));
    await writeFile(
      join(corruptRoot, "survivor.md"),
      "# Survivor\nStill here.\n",
    );
    await writeFile(join(corruptRoot, ".note-index.db"), "not sqlite");
    await writeFile(join(corruptRoot, ".note-index.db-wal"), "stale wal");
    await writeFile(join(corruptRoot, ".note-index.db-shm"), "stale shm");

    const healed = await NoteIndex.open(corruptRoot);
    eq(
      healed.search("Survivor").map((hit) => hit.path),
      ["survivor.md"],
      "corrupt note index self-heals by rebuilding from markdown",
    );
    await healed.close();
    await rm(corruptRoot, { recursive: true, force: true });
  }

  // ── Cache hygiene: a rejected lazy-open promise must not poison the root.
  console.log("\nSelf-healing — failed lazy open can retry:");
  {
    const retryParent = await mkdtemp(join(tmpdir(), "note-index-retry-"));
    const retryRoot = join(retryParent, "vault");
    await writeFile(retryRoot, "I am a file, not a directory.");
    let failed = false;
    try {
      await getNoteIndexForRoot(retryRoot);
    } catch {
      failed = true;
    }
    assert(
      failed,
      "first lazy open fails when the root path is not a directory",
    );

    await rm(retryRoot, { force: true });
    await mkdir(retryRoot, { recursive: true });
    await writeFile(
      join(retryRoot, "retry.md"),
      "# Retry\nThe vault recovered.\n",
    );
    const retried = await getNoteIndexForRoot(retryRoot);
    eq(
      retried.search("recovered").map((hit) => hit.path),
      ["retry.md"],
      "failed lazy open is evicted so the next call can recover",
    );
    await closeAllNoteIndexes();
    await rm(retryParent, { recursive: true, force: true });
  }

  // ── Obsidian-first links: aliases, embeds, block refs, and canonical relations.
  console.log("\nObsidian links — aliases, embeds, block refs, relations:");
  const oroot = await mkdtemp(join(tmpdir(), "note-index-obsidian-"));
  await writeFile(
    join(oroot, "home.md"),
    `---\ntitle: "Home"\nadvisor: "[[Garry Tan]]"\ninvestor:\n  - "[[Sequoia|Sequoia Capital]]"\n---\n# Home\nSee [[tasks|Task List]], ![[brief#Summary]], and [[tasks#^todo-1]].\nadvisor:: [[Garry Tan]]\nreviewer:: [[Ghost Person#^missing-block]]\nLegacy still works: [[works_at::Garry Tan]].\n`,
  );
  await writeFile(
    join(oroot, "tasks.md"),
    `# Tasks\n- [ ] Follow up ^todo-1\n`,
  );
  await writeFile(join(oroot, "brief.md"), `# Brief\n## Summary\nDetails.\n`);
  await writeFile(join(oroot, "garry tan.md"), `# Garry Tan\nPerson.\n`);
  await writeFile(join(oroot, "sequoia.md"), `# Sequoia\nFirm.\n`);

  const oi = await NoteIndex.open(oroot);
  const obsidianEdges = oi
    .links()
    .map(
      (edge) =>
        `${edge.source}->${edge.target}:${edge.type}:${edge.kind || "link"}:${edge.targetHeading || ""}:${edge.targetBlockId || ""}`,
    )
    .sort();
  eq(
    obsidianEdges,
    [
      "home.md->brief.md:embed:embed:Summary:",
      "home.md->garry tan.md:advisor:link::",
      "home.md->garry tan.md:works_at:link::",
      "home.md->sequoia.md:investor:link::",
      "home.md->tasks.md:link:link::",
      "home.md->tasks.md:link:link::todo-1",
    ],
    "links() preserves aliases, embeds, block refs, frontmatter relations, and legacy typed links",
  );
  eq(
    oi
      .backlinkDetails("tasks.md")
      .map((edge) => `${edge.source}:${edge.type}:${edge.targetBlockId || ""}`)
      .sort(),
    ["home.md:link:", "home.md:link:todo-1"],
    "backlinkDetails exposes page refs and block refs separately",
  );
  const obsidianBroken = oi.unresolvedLinks();
  eq(
    obsidianBroken.length,
    1,
    "unresolvedLinks finds one canonical typed miss",
  );
  eq(
    {
      target: obsidianBroken[0].target,
      type: obsidianBroken[0].type,
      block: obsidianBroken[0].targetBlockId,
    },
    { target: "ghost person", type: "reviewer", block: "missing-block" },
    "broken canonical typed block link keeps relation and block id",
  );
  const obsidianBefore = obsidianEdges;
  await oi.rebuild();
  eq(
    oi
      .links()
      .map(
        (edge) =>
          `${edge.source}->${edge.target}:${edge.type}:${edge.kind || "link"}:${edge.targetHeading || ""}:${edge.targetBlockId || ""}`,
      )
      .sort(),
    obsidianBefore,
    "Obsidian link graph rebuild is identical",
  );
  await oi.close();
  await rm(oroot, { recursive: true, force: true });

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

  // ── Unlinked mentions: target-only scan preserves result semantics without
  // scanning every note against every other note.
  console.log("\nUnlinked mentions — target-only scan:");
  const mroot = await mkdtemp(join(tmpdir(), "note-index-mentions-"));
  await writeFile(
    join(mroot, "alpha.md"),
    `---\naliases: ["A Prime"]\n---\n# Alpha\nTarget note.\n`,
  );
  await writeFile(
    join(mroot, "source-one.md"),
    `# Source One\nAlpha appears as plain text.\n`,
  );
  await writeFile(
    join(mroot, "source-two.md"),
    `# Source Two\nThe alias A Prime appears as plain text.\n`,
  );
  await writeFile(
    join(mroot, "source-linked.md"),
    `# Source Linked\nAn explicit [[alpha]] link is not an unlinked mention.\n`,
  );
  const mi = await NoteIndex.open(mroot);
  eq(
    mi
      .unlinkedMentions("alpha.md")
      .map((hit) => hit.source)
      .sort(),
    ["source-one.md", "source-two.md"],
    "unlinkedMentions scans other bodies for the requested target only",
  );
  eq(
    mi.unlinkedMentions("missing.md"),
    [],
    "unlinkedMentions returns no hits for a missing target",
  );
  await mi.close();
  await rm(mroot, { recursive: true, force: true });

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

  // ── MED-11: snapshot → mutate → restore → rebuild leaves pages searchable ──
  console.log("\nBackups — snapshot/restore round-trip re-indexes:");
  {
    const wsRoot = await mkdtemp(join(tmpdir(), "sps-backup-verify-"));
    const vaultDir = join(wsRoot, "vault");
    await mkdir(vaultDir, { recursive: true });
    const wsPaths = {
      workspaceJson: join(wsRoot, "workspace.json"),
      manifestJson: join(vaultDir, "_manifest.json"),
      vaultDir,
      excludeDirs: [join(wsRoot, "backups")],
    };
    await writeFile(wsPaths.workspaceJson, JSON.stringify({ __rev: 1 }));
    await writeFile(wsPaths.manifestJson, JSON.stringify({ tree: [] }));
    await writeFile(
      join(vaultDir, "keepme.md"),
      "# Keep Me\nA rare hovercraft full of eels.\n",
    );

    const snapDir = join(wsRoot, "backups", "1700000000000");
    await snapshotWorkspaceTo(wsPaths, snapDir);

    // Simulate the data-loss event: page deleted, junk page added.
    await rm(join(vaultDir, "keepme.md"));
    await writeFile(join(vaultDir, "intruder.md"), "# Intruder\n");

    await restoreSnapshotFrom(snapDir, wsPaths);
    const backupIndex = await NoteIndex.open(vaultDir);
    await backupIndex.rebuild();

    const restoredHits = backupIndex.search("hovercraft").map((h) => h.path);
    assert(
      restoredHits.includes("keepme.md"),
      "restored page is searchable after rebuild",
    );
    const restoredPaths = backupIndex.query({}).map((n) => n.path);
    assert(
      !restoredPaths.includes("intruder.md"),
      "post-snapshot page is gone after restore + rebuild",
    );
    await backupIndex.close();
    await rm(wsRoot, { recursive: true, force: true });
  }

  closeAllNoteIndexes();
  console.log("\nALL NOTE-INDEX CHECKS PASSED");
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
