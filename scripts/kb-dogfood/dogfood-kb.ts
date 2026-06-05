// KB dogfooding harness — item 9, the Phase-2 trigger evaluation.
//
// Drives the REAL grounding pipeline (groundingTerms → getSpsNoteIndex().search
// → buildRetrievalSystemMessage) against a designed security-guarding corpus,
// then classifies each question's failure mode the way item 1's gate requires:
//
//   recall  = the doc that holds the answer never came back in the top-5 FTS5
//             hits (a stemmed-keyword / synonym miss) → points at embeddings.
//   depth   = the doc came back but the answer sits beyond the 1500-char excerpt
//             clamp, or needs a second doc (multi-hop) → points at RLM.
//
// Phase A (retrieval diagnostics) is fully offline. Phase B (live grounded
// answers) runs only when GATEWAY_URL is set, posting the EXACT SPS request
// payload (buildSpsAssistantMessages + the real grounding system message).
//
// Run under Electron's node (ELECTRON_RUN_AS_NODE=1) so the Electron-ABI
// better-sqlite3 binary loads. See run.sh. HERMES_HOME is set by run.sh BEFORE
// this bundle loads, so installer.ts captures the temp home at import time.
import { readFile, readdir, mkdir, copyFile, writeFile } from "fs/promises";
import { join, basename } from "path";
import {
  groundingTerms,
  buildRetrievalSystemMessage,
} from "../../src/main/hermes";
import { buildSpsAssistantMessages } from "../../src/main/sps-agent";
import {
  getSpsNoteIndex,
  closeAllNoteIndexes,
} from "../../src/main/note-index";
import { profileHome } from "../../src/main/utils";

const PROFILE = "dogfood";
const GROUNDING_EXCERPT_CHARS = 1500; // must match hermes.ts
const HERE = __dirname; // scripts/kb-dogfood at build time is irrelevant; see CORPUS_DIR

// run.sh passes these so the bundle doesn't have to guess repo layout.
const CORPUS_DIR = process.env.CORPUS_DIR || join(HERE, "corpus");
const QUESTIONS_FILE =
  process.env.QUESTIONS_FILE || join(HERE, "questions.json");
const OUT_DIR = process.env.OUT_DIR || "/tmp/kb-dogfood-out";

const GATEWAY_URL = process.env.GATEWAY_URL?.replace(/\/+$/, "") || "";
const GATEWAY_KEY = process.env.GATEWAY_KEY || "";
const GATEWAY_MODEL = process.env.GATEWAY_MODEL || "hermes-agent";

const FM_RE = /^---\n[\s\S]*?\n---\n?/; // matches excerptForGrounding's strip

interface Question {
  id: string;
  hypothesis: string;
  question: string;
  gold: string[];
  answer_doc: string;
  answer_fragment: string;
  expected: string;
}

/** Body after frontmatter strip + trim — identical to excerptForGrounding. */
function bodyOf(raw: string): string {
  return raw.replace(FM_RE, "").trim();
}

/**
 * Raw-body char offset of a fragment, tolerant of whitespace/line-wrap
 * differences (markdown hard-wraps a fact across a newline that the question
 * fragment writes as a space). Returns the offset in RAW stripped-body
 * coordinates so the 1500-char excerpt-clamp comparison stays faithful.
 */
function fragmentOffset(body: string, fragment: string): number {
  const escaped = fragment.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\s+/g, "\\s+");
  const m = new RegExp(pattern).exec(body);
  return m ? m.index : -1;
}

function log(s = ""): void {
  console.log(s);
}

async function seedVault(): Promise<string> {
  const vault = join(profileHome(PROFILE), "sps-agent", "vault");
  await mkdir(vault, { recursive: true });
  const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    await copyFile(join(CORPUS_DIR, f), join(vault, f));
  }
  return vault;
}

interface PhaseAResult {
  id: string;
  hypothesis: string;
  question: string;
  terms: string[];
  retrieved: string[]; // top-5 hit paths, in rank order
  answerDoc: string;
  answerDocRetrieved: boolean;
  answerOffset: number; // char offset of fragment in stripped body, -1 if absent
  bodyLen: number;
  withinExcerpt: boolean; // offset in [0,1500)
  goldAllRetrieved: boolean;
  predicted:
    | "pass"
    | "recall"
    | "depth-clamp"
    | "depth-multihop"
    | "unmeasurable";
}

async function phaseA(
  questions: Question[],
  vault: string,
): Promise<PhaseAResult[]> {
  const index = await getSpsNoteIndex(PROFILE);
  const root = index.status().root;
  log(`Index root: ${root}`);
  log(`Indexed notes: ${index.status().notes}`);
  log("");

  const bodies = new Map<string, string>();
  for (const f of (await readdir(vault)).filter((f) => f.endsWith(".md"))) {
    bodies.set(f, bodyOf(await readFile(join(vault, f), "utf-8")));
  }

  const results: PhaseAResult[] = [];
  for (const q of questions) {
    const terms = groundingTerms(q.question);
    const hits = index.search(terms.join(" "), 5, "any");
    const retrieved = hits.map((h) => basename(h.path));

    const answerDocRetrieved = retrieved.includes(q.answer_doc);
    const body = bodies.get(q.answer_doc) ?? "";
    const answerOffset = fragmentOffset(body, q.answer_fragment);
    const withinExcerpt =
      answerOffset >= 0 && answerOffset < GROUNDING_EXCERPT_CHARS;
    const goldAllRetrieved = q.gold.every((g) => retrieved.includes(g));
    const primaryRetrieved = retrieved.includes(q.gold[0]);

    let predicted: PhaseAResult["predicted"];
    if (answerOffset < 0) {
      predicted = "unmeasurable"; // fragment not found — corpus/question drift
    } else if (!answerDocRetrieved) {
      // The doc holding the answer never came back.
      predicted =
        q.gold.length > 1 && primaryRetrieved ? "depth-multihop" : "recall";
    } else if (!withinExcerpt) {
      predicted = "depth-clamp"; // retrieved, but answer is past the 1500-char clamp
    } else {
      predicted = "pass"; // answer is inside the injected excerpt
    }

    results.push({
      id: q.id,
      hypothesis: q.hypothesis,
      question: q.question,
      terms,
      retrieved,
      answerDoc: q.answer_doc,
      answerDocRetrieved,
      answerOffset,
      bodyLen: body.length,
      withinExcerpt,
      goldAllRetrieved,
      predicted,
    });
  }
  return results;
}

interface PhaseBResult {
  id: string;
  answer: string;
  graded: "correct" | "wrong" | "error";
  groundedDocs: string[]; // relPaths cited in the injected grounding message
}

/** Pull the [title · relPath] markers out of the grounding system message. */
function groundedDocsFrom(content: string): string[] {
  const out: string[] = [];
  const re = /\[[^\]·]+·\s*([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push(m[1].trim());
  return out;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function phaseB(questions: Question[]): Promise<PhaseBResult[]> {
  const out: PhaseBResult[] = [];
  for (const q of questions) {
    const grounding = await buildRetrievalSystemMessage(q.question, PROFILE);
    const groundedDocs = grounding ? groundedDocsFrom(grounding.content) : [];
    const messages = buildSpsAssistantMessages(
      q.question,
      { blocks: [], pageTitle: "Untitled" },
      grounding,
    );
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(GATEWAY_KEY ? { Authorization: `Bearer ${GATEWAY_KEY}` } : {}),
        },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({ model: GATEWAY_MODEL, stream: false, messages }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        out.push({
          id: q.id,
          answer: `HTTP ${res.status}: ${t.slice(0, 200)}`,
          graded: "error",
          groundedDocs,
        });
        continue;
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const answer = data?.choices?.[0]?.message?.content ?? "";
      // Grade: does the answer contain the distinctive fact fragment (loosely)?
      const key = normalize(q.answer_fragment)
        .split(" ")
        .filter((w) => w.length > 2);
      const ans = normalize(answer);
      const hitCount = key.filter((w) => ans.includes(w)).length;
      const graded =
        hitCount >= Math.ceil(key.length * 0.6) ? "correct" : "wrong";
      out.push({ id: q.id, answer, graded, groundedDocs });
    } catch (err) {
      out.push({
        id: q.id,
        answer: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        graded: "error",
        groundedDocs,
      });
    }
  }
  return out;
}

function tallyPredictions(a: PhaseAResult[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of a) t[r.predicted] = (t[r.predicted] ?? 0) + 1;
  return t;
}

async function main(): Promise<void> {
  log("══════════════════════════════════════════════════════════════");
  log(" KB DOGFOOD — item 9 (Phase-2 trigger evaluation)");
  log("══════════════════════════════════════════════════════════════");
  const raw = JSON.parse(await readFile(QUESTIONS_FILE, "utf-8")) as {
    questions: Question[];
  };
  const questions = raw.questions;
  const vault = await seedVault();

  log("");
  log("── PHASE A — retrieval diagnostics (offline) ─────────────────");
  const a = await phaseA(questions, vault);
  for (const r of a) {
    const goldFlag = r.answerDocRetrieved ? "✓" : "✗";
    const off = r.answerOffset < 0 ? "n/a" : `${r.answerOffset}/${r.bodyLen}`;
    log("");
    log(`[${r.id}]  hypothesis=${r.hypothesis}  →  predicted=${r.predicted}`);
    log(`  Q: ${r.question}`);
    log(`  terms: ${r.terms.join(", ")}`);
    log(`  top-5: ${r.retrieved.join(", ") || "(none)"}`);
    log(
      `  answer-doc ${r.answerDoc} retrieved=${goldFlag}  offset=${off}  withinExcerpt=${r.withinExcerpt}`,
    );
  }
  log("");
  log("── PHASE A tally (predicted outcomes) ────────────────────────");
  log(JSON.stringify(tallyPredictions(a), null, 2));

  let b: PhaseBResult[] = [];
  if (GATEWAY_URL) {
    log("");
    log(
      `── PHASE B — live grounded answers (${GATEWAY_URL}, model=${GATEWAY_MODEL}) ──`,
    );
    b = await phaseB(questions);
    for (const r of b) {
      log("");
      log(
        `[${r.id}]  graded=${r.graded}  grounded-on=[${r.groundedDocs.join(", ")}]`,
      );
      log(`  answer: ${r.answer.replace(/\s+/g, " ").slice(0, 600)}`);
    }
  } else {
    log("");
    log("── PHASE B skipped (no GATEWAY_URL) ──────────────────────────");
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    join(OUT_DIR, "results.json"),
    JSON.stringify(
      { phaseA: a, phaseB: b, tally: tallyPredictions(a) },
      null,
      2,
    ),
  );
  log("");
  log(`Wrote ${join(OUT_DIR, "results.json")}`);

  await closeAllNoteIndexes();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
