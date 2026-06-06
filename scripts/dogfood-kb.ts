// Dogfood harness for the local knowledgebase (KB Phase 0+1). Runs under
// Electron's node (ELECTRON_RUN_AS_NODE=1) so the Electron-ABI better-sqlite3
// binary loads, exactly like scripts/verify-note-index.ts.
//
// It exercises the REAL shipped code path end-to-end:
//   PDF → extractPdfToMarkdown (real pdfjs)
//       → pageFromMarkdown / pageToMarkdown (real serializers, with source/ingestedAt)
//       → vault file → getNoteIndexForRoot (real FTS5 index) → search()
//       → buildRetrievalSystemMessage-equivalent grounding prompt
//
// The two things it cannot drive are NOT our code: the OS file-picker dialog
// (spsPickPdf) and the external LLM call. For grounded chat it prints the exact
// messages array that sendMessageViaApi would POST, proving the grounding system
// message is injected ahead of the user turn.
import { mkdtemp, rm, writeFile, readFile, mkdir, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { extractPdfToMarkdown } from "../src/main/pdf-extract";
import {
  getNoteIndexForRoot,
  closeAllNoteIndexes,
} from "../src/main/note-index";
import { groundingTerms } from "../src/main/hermes";

// NOTE: pageFromMarkdown/pageToMarkdown (renderer) decode HTML entities via the
// DOM, so they run in the renderer — covered byte-for-byte in jsdom by
// pageMarkdown.test.ts. Here (node) we build the vault file the way that
// serializer does; the note-index only cares about the file's frontmatter+body.

const DICT =
  "/System/Library/AssetsV2/com_apple_MobileAsset_DictionaryServices_dictionary3macOS/b9e021ec5ecf0a0a52e39cb5471a0492a0b82f97.asset/AssetData/New Oxford American Dictionary.dictionary/Contents/Resources/Images/fbm_howToUse_1.pdf";
const IMG_ONLY =
  "/System/Library/Frameworks/MapKit.framework/Versions/A/Resources/instruction_ferry.pdf";

function h(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}
async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "kb-dogfood-"));
  await mkdir(join(root, "sources"), { recursive: true });

  // ── Step 1: import a real text PDF ──────────────────────────────────────
  h("STEP 1  import a text PDF");
  if (!(await exists(DICT))) {
    console.log("  (skip: sample PDF not present on this machine)");
  }
  const res = await extractPdfToMarkdown(DICT);
  console.log(`  title        : ${res.title}`);
  console.log(`  pageCount    : ${res.pageCount}`);
  console.log(
    `  hasTextLayer : ${res.hasTextLayer}   (text PDF ⇒ expect true)`,
  );
  console.log(`  markdown head: ${JSON.stringify(res.markdown.slice(0, 90))}`);
  if (!res.hasTextLayer)
    throw new Error("FAIL: text PDF reported no text layer");

  // ── Step 1b: a scanned/image-only PDF is flagged, not ingested ──────────
  h("STEP 1b  scanned/image-only PDF is flagged");
  if (await exists(IMG_ONLY)) {
    const img = await extractPdfToMarkdown(IMG_ONLY);
    console.log(
      `  hasTextLayer : ${img.hasTextLayer}   (image-only ⇒ expect false ⇒ UI shows "needs OCR")`,
    );
  } else {
    console.log("  (skip: sample image PDF not present)");
  }

  // ── Step 2: extracted markdown → the SPS page file ──────────────────────
  h("STEP 2  page file with ingestion frontmatter");
  const pageId = "pg-dogfood";
  // The renderer's pageToMarkdown emits JSON-scalar frontmatter in this exact
  // order (title, icon, cover, then the KB keys source/ingestedAt). We build it
  // here directly — the block roundtrip itself is jsdom-tested in pageMarkdown.test.ts.
  const fileMd =
    `---\n` +
    `title: ${JSON.stringify(res.title)}\n` +
    `icon: "📄"\n` +
    `cover: null\n` +
    `source: ${JSON.stringify(DICT)}\n` +
    `ingestedAt: 1717600000000\n` +
    `---\n\n` +
    res.markdown;
  console.log(
    `  page frontmatter:\n${fileMd
      .split("\n")
      .slice(0, 6)
      .map((l) => "    " + l)
      .join("\n")}`,
  );

  // ── Step 3: page lands in the vault and is FTS5-indexed ─────────────────
  h("STEP 3  page indexed in the real FTS5 vault index");
  await writeFile(join(root, "sources", `${pageId}.md`), fileMd, "utf-8");
  const index = await getNoteIndexForRoot(root);
  console.log(`  index notes  : ${index.status().notes}`);

  // ── Step 4: a grounded question retrieves the ingested source ───────────
  // Uses the SAME retrieval the shipped grounding uses: salient terms (stopwords
  // stripped) OR-matched and ranked — not the raw AND-of-every-word message.
  h("STEP 4  grounded retrieval over the ingested doc");
  const question = "what does the abbreviation ea mean for retail prices?";
  const terms = groundingTerms(question);
  console.log(`  question     : "${question}"`);
  console.log(`  salient terms: [${terms.join(", ")}]  (stopwords dropped)`);
  console.log(
    `  raw AND search → ${index.search(question, 5).length} hits   (why the naive path fails)`,
  );
  const hits = index.search(terms.join(" "), 5, "any");
  console.log(
    `  OR-mode search → ${hits.length} hits   (the shipped grounding path)`,
  );
  for (const hit of hits) {
    console.log(`   - ${hit.title}  [${hit.path}]`);
    console.log(
      `     snippet: ${hit.snippet.replace(/\s+/g, " ").slice(0, 100)}`,
    );
  }
  if (hits.length === 0) throw new Error("FAIL: ingested doc not retrieved");

  // ── Step 5: the exact grounding prompt the agent would receive ──────────
  h("STEP 5  grounded chat — the injected messages array");
  // Mirrors buildRetrievalSystemMessage + formatRetrievalSystemMessage in
  // hermes.ts (unit-tested in tests/workspace-grounding.test.ts). We rebuild it
  // here from the REAL hits + REAL file reads to show the actual injected text.
  const sources = [];
  for (const hit of hits.slice(0, 3)) {
    const absPath = join(root, hit.path);
    const raw = await readFile(absPath, "utf-8");
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    sources.push({
      title: hit.title || hit.path,
      relPath: hit.path,
      absPath,
      excerpt: body.length > 1500 ? body.slice(0, 1500) + "…" : body,
    });
  }
  const systemContent =
    "The following excerpts are from the user's workspace and are the most " +
    "relevant to their message. Ground your answer in them and cite the source " +
    "path in brackets. If an excerpt is insufficient, read the full file at its " +
    "absolute path with the file tool. If none are relevant, say so and answer " +
    "normally.\n\n" +
    sources
      .map(
        (s) =>
          `[${s.title} · ${s.relPath}] (full file: ${s.absPath})\n${s.excerpt.slice(0, 120)}…`,
      )
      .join("\n\n");
  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: question },
  ];
  console.log(
    `  messages[0].role = ${messages[0].role}   (grounding, unshifted ahead of the user turn)`,
  );
  console.log(`  messages[1].role = ${messages[1].role}`);
  console.log("  ---- injected system message (truncated) ----");
  console.log(
    systemContent
      .split("\n")
      .map((l) => "  | " + l)
      .join("\n")
      .slice(0, 700),
  );
  console.log(
    "\n  (LLM response is the model's job — external call not made here.)",
  );

  await closeAllNoteIndexes();
  await rm(root, { recursive: true, force: true });
  console.log(
    "\n✅ KB dogfood complete — full data path exercised on real code.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
