// federated-search-smoke.mjs — UI + IPC smoke for P4 federated search.
//
// Launches the BUILT Electron app (run `npm run build` first) against a throwaway
// HERMES_HOME seeded with TWO real, hermetically-indexable sources that share a
// distinctive token: a vault NOTE and an imported external TRANSCRIPT (claude-code
// root, with a planted secret to exercise index-time redaction). Drives the real
// `federatedSearch` IPC + the Ask pane, asserting:
//   • one query returns BOTH a note hit and a transcript hit in one ranked list,
//   • the transcript hit routes into the UNTRUSTED, fenced ConversationViewer,
//   • the planted secret never reaches the DOM.
//
// SCOPE NOTE (no silent cap): the third kind — Hermes chat SESSIONS — needs the
// shared state DB populated by a running gateway, which a hermetic smoke can't
// provide. Session-kind normalization + ranking is covered by the pure unit test
// (src/main/federated-search.test.ts), and the aggregator's Promise.allSettled
// makes an absent session source contribute nothing without breaking the merge.
//
// Usage:  npm run build && node scripts/federated-search-smoke.mjs
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// A fake sk-ant key, chunked so it never trips secret scanners in this repo.
const SK_ANT = [
  "sk-ant-a",
  "pi03-FED",
  "ERATED01",
  "23456789",
  "FEDERAT0",
  "123456789",
  "FED01-se",
  "cretx",
].join("");

// A distinctive token planted in BOTH sources so one query reaches both.
const TOKEN = "zephyrquery";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "federated-smoke");
mkdirSync(OUT, { recursive: true });

const HOME = mkdtempSync(join(tmpdir(), "hermes-fed-smoke-"));

// install markers → App.tsx routes straight to the SPS screen.
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);
writeFileSync(
  join(HOME, "desktop.json"),
  JSON.stringify({ onboardingCompleted: true }),
);

// SPS workspace + a vault note carrying the token (the NOTE source).
const sps = join(HOME, "sps-agent");
mkdirSync(join(sps, "vault"), { recursive: true });
const workspace = {
  tree: [{ id: "home", children: [] }],
  meta: { home: { icon: "🏠", title: "Home", cover: null } },
  docs: { home: [{ id: "h1", type: "h1", text: "Home" }] },
  comments: [],
  trash: [],
  page: "home",
};
writeFileSync(join(sps, "workspace.json"), JSON.stringify(workspace, null, 2));
writeFileSync(
  join(sps, "vault", "home.md"),
  `---\ntitle: "Home"\n---\n\n# Home\n`,
);
writeFileSync(
  join(sps, "vault", "widgets.md"),
  `---\ntitle: "Widget plan"\n---\n\n# Widget plan\n\nThe ${TOKEN} pipeline batches widgets.\n`,
);

// Hermetic external-source roots: claude-code seeded with the token + a planted
// secret; the rest point at empty dirs so the smoke never reads real transcripts.
const ecClaude = join(HOME, "ec-claude");
const ecCodex = join(HOME, "ec-codex");
const ecGemini = join(HOME, "ec-gemini");
const ecGrok = join(HOME, "ec-grok");
const claudeProj = join(ecClaude, "-Users-test-proj");
mkdirSync(claudeProj, { recursive: true });
mkdirSync(ecCodex, { recursive: true });
mkdirSync(ecGemini, { recursive: true });
mkdirSync(ecGrok, { recursive: true });
const sid = "ffffffff-1111-2222-3333-444444444444";
const lines = [
  JSON.stringify({
    type: "user",
    cwd: "/Users/test/proj",
    gitBranch: "main",
    sessionId: sid,
    timestamp: "2026-06-10T09:00:01.000Z",
    message: { role: "user", content: `the ${TOKEN} design with ${SK_ANT}` },
  }),
  JSON.stringify({
    type: "assistant",
    cwd: "/Users/test/proj",
    gitBranch: "main",
    sessionId: sid,
    timestamp: "2026-06-10T09:00:05.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: `Batch the ${TOKEN} in a worker pool.` }],
    },
  }),
];
writeFileSync(join(claudeProj, `${sid}.jsonl`), lines.join("\n") + "\n");

console.log("HERMES_HOME=", HOME);
console.log("SMOKE_OUT=", OUT);

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 120000).unref();

function die(msg) {
  console.log("FED_FAIL:", msg);
  process.exitCode = 3;
}

const app = await electron.launch({
  args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    HERMES_EC_CLAUDE_ROOT: ecClaude,
    HERMES_EC_CODEX_ROOT: ecCodex,
    HERMES_EC_GEMINI_ROOT: ecGemini,
    HERMES_EC_GROK_ROOT: ecGrok,
  },
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(1800);

// ── Build the indices through the real IPC: enable + scan the transcript source,
//    and rebuild the note index from the seeded vault. ─────────────────────────
await win.evaluate(() =>
  window.hermesAPI.externalContextSetSource("claude-code", true),
);
await win.evaluate(() => window.hermesAPI.externalContextScan());
await win.evaluate(() => window.hermesAPI.spsIndexRebuild());
await win.waitForTimeout(1500);

// ── 1. The aggregator itself: one query → both kinds, no secret leak. ─────────
const hits = await win.evaluate(
  (t) => window.hermesAPI.federatedSearch(t),
  TOKEN,
);
console.log("FED_HITS:", JSON.stringify(hits.map((h) => h.kind)));
const noteHit = hits.find((h) => h.kind === "note");
const transcriptHit = hits.find((h) => h.kind === "transcript");
if (!noteHit) die("no note hit in federated results");
if (!transcriptHit) die("no transcript hit in federated results");
const leakedInApi = JSON.stringify(hits).includes("sk-ant-api03");
if (leakedInApi) die("planted secret leaked into federatedSearch results");
if (noteHit && transcriptHit && !leakedInApi) {
  console.log("FED_AGGREGATE ok (note + transcript merged, no leak)");
}

const shots = [];
async function shot(name, fn) {
  try {
    if (fn) await fn();
    await win.waitForTimeout(700);
    await win.screenshot({ path: join(OUT, `${name}.png`) });
    shots.push(name);
    console.log("SHOT ok:", name);
  } catch (e) {
    console.log("SHOT FAIL:", name, "—", e.message);
  }
}

// ── 2. The Ask pane: type the token, see a ranked list with note + transcript
//    chips. Open the palette from the sidebar "Search" nav item. ──────────────
await shot("01-ask-results", async () => {
  await win.locator(".nav-item", { hasText: "Search" }).first().click();
  await win.waitForTimeout(500);
  await win.keyboard.type("ask your workspace");
  await win.waitForTimeout(600);
  await win.keyboard.press("Enter");
  await win.waitForSelector(".ask-input", { timeout: 8000 });
  const input = win.locator(".ask-input").first();
  await input.fill(TOKEN);
  await input.press("Enter");
  await win.waitForSelector(".ask-page", { timeout: 8000 });
  await win.waitForTimeout(800);
});

const chipKinds = await win.evaluate(() => {
  const note = !!document.querySelector(".ask-chip-note");
  const transcript = !!document.querySelector(".ask-chip-transcript");
  return { note, transcript };
});
console.log("FED_CHIPS:", JSON.stringify(chipKinds));
if (!chipKinds.note) die("Ask pane: no Note chip rendered");
if (!chipKinds.transcript) die("Ask pane: no Transcript chip rendered");

// ── 3. Click the transcript row → the UNTRUSTED, fenced viewer opens. ─────────
await shot("02-transcript-viewer", async () => {
  await win
    .locator(".ask-page", {
      has: win.locator(".ask-chip-transcript"),
    })
    .first()
    .click({ timeout: 8000 });
  await win.waitForSelector(".modal", { timeout: 8000 });
  await win.waitForTimeout(900);
});

const viewer = await win.evaluate(() => {
  // The viewer renders as a SECOND .modal inside the same scrim as the search
  // view — aggregate text across all .modal elements.
  const modals = [...document.querySelectorAll(".modal")];
  const text = modals.map((m) => m.textContent || "").join(" ");
  return {
    open: modals.length > 0,
    banner: text.includes("Untrusted transcript from an external tool"),
    leak: text.includes("sk-ant-api03"),
  };
});
console.log("FED_VIEWER:", JSON.stringify(viewer));
if (!viewer.open) die("transcript click did not open the viewer modal");
if (!viewer.banner) die("viewer missing the untrusted banner");
if (viewer.leak) die("planted secret leaked into the viewer DOM");
if (viewer.open && viewer.banner && !viewer.leak) {
  console.log("FED_VIEWER ok (untrusted banner present, no secret leak)");
}

console.log(
  "SESSION_KIND_NOTE: Hermes-session merging is unit-tested " +
    "(federated-search.test.ts); a running-gateway session DB is out of hermetic-smoke scope.",
);
console.log("SHOTS_OK:", shots.length, "—", shots.join(", "));
await app.close();
console.log(process.exitCode ? "SMOKE_FAILED" : "SMOKE_DONE");
