// Recall experiment (BACKLOG item 1, recall work). Two-arm A/B over a >5-doc
// corpus engineered with genuine keyword-recall misses (the gold doc shares no
// salient term with the question, so it falls outside the top-5 and is never
// handed to the agent):
//
//   baseline  — current grounding (top-5 excerpts + paths only).
//   treatment — same, plus the vault ROOT directory + a nav hint, so the agent
//               can reformulate and discover the missed doc with its existing
//               file tools (buildRetrievalSystemMessage(..., {vaultNav:true})).
//
// Question: does the cheapest possible affordance (one extra paragraph naming
// the vault directory) let the live agent self-close a recall miss the file
// tool alone cannot? If yes on the RM-* misses without breaking the CTRL-*
// controls, ship the grounding change. If not, the residual gap justifies the
// next tier (in-app query expansion, or an upstream vault_search tool).
//
// Run under Electron's node (ELECTRON_RUN_AS_NODE=1); HERMES_HOME set by the
// caller so the real grounding pipeline reads the seeded corpus vault.
import { readdir, mkdir, copyFile, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { buildRetrievalSystemMessage } from "../../src/main/hermes";
import { buildSpsAssistantMessages } from "../../src/main/sps-agent";
import {
  getSpsNoteIndex,
  closeAllNoteIndexes,
} from "../../src/main/note-index";
import { profileHome } from "../../src/main/utils";

// Default profile so the EXPANSION call (chatCompletionOnce → getApiUrl →
// getProfilePort) resolves to the gateway's 8642 and reads API_SERVER_KEY from
// HERMES_HOME/.env (which the caller seeds). A named profile would get a random
// allocated port and no key, silently disabling expansion.
const PROFILE = "default";
const CORPUS_DIR = process.env.CORPUS_DIR!;
const QUESTIONS_FILE = process.env.QUESTIONS_FILE!;
const OUT_DIR = process.env.OUT_DIR || "/tmp/recall-out";
const GATEWAY_URL = (process.env.GATEWAY_URL || "").replace(/\/+$/, "");
const GATEWAY_KEY = process.env.GATEWAY_KEY || "";
const GATEWAY_MODEL = process.env.GATEWAY_MODEL || "hermes-agent";

interface Question {
  id: string;
  hypothesis: string;
  question: string;
  gold: string[];
  answer_doc: string;
  answer_fragment: string;
  expected: string;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Loose grade: does the answer contain ≥60% of the fragment's content words? */
function grades(answer: string, fragment: string): boolean {
  const key = norm(fragment)
    .split(" ")
    .filter((w) => w.length > 2);
  if (key.length === 0) return false;
  const ans = norm(answer);
  const hit = key.filter((w) => ans.includes(w)).length;
  return hit >= Math.ceil(key.length * 0.6);
}

async function seed(): Promise<void> {
  const vault = join(profileHome(PROFILE), "sps-agent", "vault");
  await mkdir(vault, { recursive: true });
  for (const f of (await readdir(CORPUS_DIR)).filter((f) =>
    f.endsWith(".md"),
  )) {
    await copyFile(join(CORPUS_DIR, f), join(vault, f));
  }
}

// Two arms compare the SHIPPED grounding behaviour:
//   expand=false → original keyword query only (the old baseline; recall 0%).
//   expand=true  → query expansion ON (synonym variants fused by reciprocal
//                  rank in buildRetrievalSystemMessage), the recall fix.
// An earlier iteration tested a "vault-nav" prompt hint instead; that was
// measured stochastic (see docs/kb-phase2-dogfood.md) and dropped in favour of
// this deterministic app-side expansion.
async function ask(
  q: Question,
  expand: boolean,
): Promise<{ answer: string; groundedOnGold: boolean }> {
  const grounding = await buildRetrievalSystemMessage(q.question, PROFILE, {
    expandQuery: expand,
  });
  const groundedOnGold = grounding
    ? q.gold.some((g) => grounding.content.includes(g))
    : false;
  const messages = buildSpsAssistantMessages(
    q.question,
    { blocks: [], pageTitle: "Untitled" },
    grounding,
  );
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(GATEWAY_KEY ? { Authorization: `Bearer ${GATEWAY_KEY}` } : {}),
    },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({ model: GATEWAY_MODEL, stream: false, messages }),
  });
  if (!res.ok) {
    return {
      answer: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`,
      groundedOnGold,
    };
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return { answer: data?.choices?.[0]?.message?.content ?? "", groundedOnGold };
}

// The agentic gateway is STOCHASTIC: the same vault-nav hint led the agent to
// navigate the vault in some runs and not others. A single trial per arm is
// meaningless — measure the success RATE over TRIALS samples.
const TRIALS = Math.max(1, Number(process.env.TRIALS || "5"));

async function rate(
  q: Question,
  expand: boolean,
): Promise<{ successes: number; total: number; sample: string }> {
  let successes = 0;
  let sample = "";
  for (let i = 0; i < TRIALS; i++) {
    const { answer } = await ask(q, expand);
    if (grades(answer, q.answer_fragment)) successes++;
    if (i === 0) sample = answer;
  }
  return { successes, total: TRIALS, sample };
}

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(QUESTIONS_FILE, "utf-8")) as {
    questions: Question[];
  };
  await seed();
  await getSpsNoteIndex(PROFILE); // force index build

  console.log(
    `══ RECALL EXPERIMENT — no-expansion vs query-expansion, ${TRIALS} trials/arm (live) ══`,
  );
  console.log(`gateway=${GATEWAY_URL} model=${GATEWAY_MODEL}\n`);

  const rows: Array<{
    id: string;
    hypothesis: string;
    baseRate: number;
    treatRate: number;
  }> = [];

  for (const q of raw.questions) {
    const base = await rate(q, false);
    const treat = await rate(q, true);
    rows.push({
      id: q.id,
      hypothesis: q.hypothesis,
      baseRate: base.successes / base.total,
      treatRate: treat.successes / treat.total,
    });
    console.log(`[${q.id}] (${q.hypothesis})`);
    console.log(
      `  no-expansion : ${base.successes}/${base.total} correct   e.g. ${base.sample.replace(/\s+/g, " ").slice(0, 160)}`,
    );
    console.log(
      `  expansion    : ${treat.successes}/${treat.total} correct   e.g. ${treat.sample.replace(/\s+/g, " ").slice(0, 160)}\n`,
    );
  }

  const misses = rows.filter((r) => r.hypothesis === "recall-miss");
  const controls = rows.filter((r) => r.hypothesis === "pass");
  const meanTreat =
    misses.reduce((a, r) => a + r.treatRate, 0) / Math.max(1, misses.length);
  const meanBase =
    misses.reduce((a, r) => a + r.baseRate, 0) / Math.max(1, misses.length);
  const ctrlMinTreat = Math.min(1, ...controls.map((r) => r.treatRate));

  console.log("══ SUMMARY ══");
  for (const r of misses) {
    console.log(
      `  ${r.id}: no-expansion ${(r.baseRate * 100).toFixed(0)}% → expansion ${(r.treatRate * 100).toFixed(0)}%`,
    );
  }
  console.log(
    `  recall-miss mean: no-expansion ${(meanBase * 100).toFixed(0)}% → expansion ${(meanTreat * 100).toFixed(0)}%`,
  );
  console.log(
    `  control expansion floor: ${(ctrlMinTreat * 100).toFixed(0)}% (should stay ~100%)`,
  );
  console.log(
    meanTreat >= 0.9 && ctrlMinTreat >= 0.9
      ? "VERDICT: query expansion reliably closes recall (≥90%) without breaking controls → ship."
      : meanTreat >= 0.5
        ? "VERDICT: query expansion helps but is not yet reliable — inspect residual misses."
        : "VERDICT: query expansion did not close the misses — reconsider expansion prompt / embeddings.",
  );

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    join(OUT_DIR, "recall-results.json"),
    JSON.stringify(rows, null, 2),
  );
  await closeAllNoteIndexes();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
