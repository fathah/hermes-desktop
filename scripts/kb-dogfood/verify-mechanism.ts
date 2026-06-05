// Mechanism check for the Phase B surprise: every depth-clamp question answered
// CORRECTLY even though the fact sits past the 1500-char excerpt clamp. Hypothesis:
// the agentic gateway follows the grounding message's absolute path and reads the
// FULL file with its file tool. Causal test: hold the (truncated) excerpt constant
// and only break the absolute path — if the buried detail vanishes, the file tool
// was the cause.
import { readdir, mkdir, copyFile } from "fs/promises";
import { join } from "path";
import { buildRetrievalSystemMessage } from "../../src/main/hermes";
import { buildSpsAssistantMessages as buildMsgs } from "../../src/main/sps-agent";
import {
  getSpsNoteIndex,
  closeAllNoteIndexes,
} from "../../src/main/note-index";
import { profileHome } from "../../src/main/utils";

const PROFILE = "dogfood";
const CORPUS_DIR = process.env.CORPUS_DIR!;
const GATEWAY_URL = process.env.GATEWAY_URL!.replace(/\/+$/, "");
const GATEWAY_KEY = process.env.GATEWAY_KEY || "";

// The buried-tail probe: this phrase lives at offset ~2797 in the SOP, past the
// 1500-char excerpt clamp, and ONLY in that one file.
const QUESTION =
  "Walk me through the full Code Red escalation timeline — who is notified, and within how many minutes at each step?";
const BURIED = "within 5 minutes"; // appears only beyond the clamp
const BURIED2 = "flash report"; // also beyond the clamp

async function seed(): Promise<void> {
  const vault = join(profileHome(PROFILE), "sps-agent", "vault");
  await mkdir(vault, { recursive: true });
  for (const f of (await readdir(CORPUS_DIR)).filter((f) =>
    f.endsWith(".md"),
  )) {
    await copyFile(join(CORPUS_DIR, f), join(vault, f));
  }
}

async function ask(grounding: {
  role: "system";
  content: string;
}): Promise<string> {
  const messages = buildMsgs(
    QUESTION,
    { blocks: [], pageTitle: "Untitled" },
    grounding,
  );
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(GATEWAY_KEY ? { Authorization: `Bearer ${GATEWAY_KEY}` } : {}),
    },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ model: "hermes-agent", stream: false, messages }),
  });
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data?.choices?.[0]?.message?.content ?? "";
}

function has(s: string, sub: string): boolean {
  return s.toLowerCase().includes(sub.toLowerCase());
}

async function main(): Promise<void> {
  await seed();
  await getSpsNoteIndex(PROFILE); // force build

  const real = await buildRetrievalSystemMessage(QUESTION, PROFILE);
  if (!real) throw new Error("no grounding produced");

  // Fact 1: is the buried tail ABSENT from the injected excerpt? (must be, to prove anything)
  const excerptHasBuried =
    has(real.content, BURIED) || has(real.content, BURIED2);
  console.log("── Excerpt content check ──");
  console.log(
    `  excerpt contains buried tail (${BURIED}/${BURIED2}): ${excerptHasBuried}`,
  );
  const pathMatch = real.content.match(/full file: ([^\)]+)\)/g) || [];
  console.log(`  absolute paths exposed in grounding: ${pathMatch.length}`);

  // Variant: identical content, but every real abs path → an unreadable one.
  const bogus = {
    role: "system" as const,
    content: real.content.replace(
      /full file: [^\)]+\)/g,
      "full file: /nonexistent/missing.md)",
    ),
  };

  console.log("\n── A: real grounding (valid abs paths) ──");
  const ansReal = await ask(real);
  console.log(
    `  answer mentions buried tail: ${has(ansReal, BURIED) || has(ansReal, BURIED2)}`,
  );
  console.log(`  answer: ${ansReal.replace(/\s+/g, " ").slice(0, 500)}`);

  console.log(
    "\n── B: same excerpt, BOGUS abs paths (file tool can't read) ──",
  );
  const ansBogus = await ask(bogus);
  console.log(
    `  answer mentions buried tail: ${has(ansBogus, BURIED) || has(ansBogus, BURIED2)}`,
  );
  console.log(`  answer: ${ansBogus.replace(/\s+/g, " ").slice(0, 500)}`);

  console.log("\n── VERDICT ──");
  const realHas = has(ansReal, BURIED) || has(ansReal, BURIED2);
  const bogusHas = has(ansBogus, BURIED) || has(ansBogus, BURIED2);
  if (!excerptHasBuried && realHas && !bogusHas) {
    console.log(
      "  PROVEN: the gateway reads the full file via the abs path (file tool).",
    );
    console.log(
      "  Depth is rescued by agentic file-reading, NOT by the excerpt.",
    );
  } else if (excerptHasBuried) {
    console.log(
      "  INCONCLUSIVE: excerpt already contained the tail — clamp assumption wrong.",
    );
  } else if (realHas && bogusHas) {
    console.log(
      "  NOT file-tool: model produced the tail even with a dead path (training/guess?).",
    );
  } else {
    console.log("  MIXED — inspect answers above.");
  }

  await closeAllNoteIndexes();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
