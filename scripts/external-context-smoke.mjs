// external-context-smoke.mjs — UI smoke for the External Context Bridge.
//
// Launches the BUILT Electron app (run `npm run build` first) against a
// throwaway profile AND hermetic, seeded external-source roots (so it never
// touches the developer's real ~/.claude, ~/.codex, …). Drives the real modal
// through the actual main-process IPC + index + adapters + index-time redaction,
// and screenshots the settings, search and untrusted viewer surfaces.
//
// Usage:  npm run build && node scripts/external-context-smoke.mjs
//         SMOKE_OUT=/path node scripts/external-context-smoke.mjs
import { _electron as electron } from "playwright";
import AdmZip from "adm-zip";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// A fake sk-ant key, chunked so it never trips secret scanners in this repo.
const SK_ANT = [
  "sk-ant-a",
  "pi03-LEA",
  "KED01234",
  "56789LEA",
  "KED01234",
  "56789LEA",
  "KED01-se",
  "cretx",
].join("");

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "ec-smoke");
mkdirSync(OUT, { recursive: true });

const HOME = mkdtempSync(join(tmpdir(), "hermes-ec-smoke-"));

// install markers → App.tsx routes straight to the SPS screen.
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);
// Skip the first-run welcome so the app boots straight into the SPS workspace
// (where ⌘K / the command palette is live).
writeFileSync(
  join(HOME, "desktop.json"),
  JSON.stringify({ onboardingCompleted: true }),
);

// minimal SPS workspace so the app boots into the scope cleanly.
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

// ── hermetic external-source roots: claude-code seeded (with a planted secret
//    to exercise redaction); codex/gemini/grok point at empty dirs so the smoke
//    never reads the developer's real transcripts. ───────────────────────────
const ecClaude = join(HOME, "ec-claude");
const ecCodex = join(HOME, "ec-codex");
const ecGemini = join(HOME, "ec-gemini");
const ecGrok = join(HOME, "ec-grok");
const claudeProj = join(ecClaude, "-Users-test-proj");
mkdirSync(claudeProj, { recursive: true });
mkdirSync(ecCodex, { recursive: true });
mkdirSync(ecGemini, { recursive: true });
mkdirSync(ecGrok, { recursive: true });
const sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const lines = [
  JSON.stringify({
    type: "user",
    cwd: "/Users/test/proj",
    gitBranch: "main",
    sessionId: sid,
    timestamp: "2026-06-10T09:00:01.000Z",
    message: {
      role: "user",
      content: "design the widget pipeline using " + SK_ANT,
    },
  }),
  JSON.stringify({
    type: "assistant",
    cwd: "/Users/test/proj",
    gitBranch: "main",
    sessionId: sid,
    timestamp: "2026-06-10T09:00:05.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Batch the widgets in a worker pool." }],
    },
  }),
];
writeFileSync(join(claudeProj, `${sid}.jsonl`), lines.join("\n") + "\n");

// ── ChatGPT export ZIP fixture (for the Import flow). A branched conversation
//    with a planted secret in the first user turn and a distinctive search
//    token, packed as conversations.json inside a real .zip. The import root is
//    HERMES_HOME/external-imports (hermetic — getHermesHome() === HOME). ───────
const chatgptZip = join(HOME, "chatgpt-export.zip");
const chatgptExport = JSON.stringify([
  {
    title: "Imported smoke chat",
    create_time: 1700000000,
    update_time: 1700000100,
    conversation_id: "smoke-conv-1",
    current_node: "a1",
    mapping: {
      root: { id: "root", message: null, parent: null, children: ["u1"] },
      u1: {
        id: "u1",
        message: {
          author: { role: "user" },
          create_time: 1700000001,
          content: {
            content_type: "text",
            parts: ["importedsmoketoken with secret " + SK_ANT],
          },
        },
        parent: "root",
        children: ["a1"],
      },
      a1: {
        id: "a1",
        message: {
          author: { role: "assistant" },
          create_time: 1700000002,
          content: { content_type: "text", parts: ["assistant smoke reply"] },
        },
        parent: "u1",
        children: [],
      },
    },
  },
]);
const zip = new AdmZip();
zip.addFile("conversations.json", Buffer.from(chatgptExport));
zip.writeZip(chatgptZip);

console.log("HERMES_HOME=", HOME);
console.log("SMOKE_OUT=", OUT);

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 120000).unref();

const shots = [];

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

async function shot(name, fn) {
  try {
    if (fn) await fn();
    await win.waitForTimeout(800);
    await win.screenshot({ path: join(OUT, `${name}.png`) });
    shots.push(name);
    console.log("SHOT ok:", name);
  } catch (e) {
    console.log("SHOT FAIL:", name, "—", e.message);
  }
}

// 01 — open the External Sessions modal via the command palette. With no source
// enabled yet, it opens on the Sources (settings) view.
await shot("01-settings", async () => {
  // Open the command palette from the sidebar "Search" nav item (more reliable
  // under automation than the ⌘K global shortcut, which needs OS focus).
  await win.locator(".nav-item", { hasText: "Search" }).first().click();
  await win.waitForTimeout(500);
  await win.keyboard.type("external sessions");
  await win.waitForTimeout(600);
  // Run the top palette result (the External sessions action) via Enter.
  await win.keyboard.press("Enter");
  await win.waitForSelector(".modal", { timeout: 8000 });
});

// 02 — enable Claude Code → backfill runs (the seeded session is indexed,
// secret redacted). Settings shows updated counts.
await shot("02-enabled", async () => {
  // The Claude Code row's toggle reads "Off"; click it to enable.
  await win.evaluate(() => {
    const rows = [...document.querySelectorAll(".lst-row")];
    const row = rows.find((r) => /Claude Code/.test(r.textContent || ""));
    const btn = row?.querySelector("button");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await win.waitForTimeout(1500);
});

// 03 — switch to Search, query a known phrase, see the redacted hit.
await shot("03-search", async () => {
  // The modal's "Search" chip (scoped — the sidebar also has a "Search" item).
  await win
    .locator(".modal .pal-chip", { hasText: "Search" })
    .first()
    .click({ timeout: 8000 });
  await win.waitForTimeout(300);
  const input = win.locator(".modal .pal-input input").first();
  await input.fill("widget");
  await input.press("Enter");
  await win.waitForTimeout(1200);
});

// 04 — open the first hit → the untrusted, escaped, read-only viewer.
await shot("04-viewer", async () => {
  await win.locator(".modal .scroll .lst-row").first().click({ timeout: 8000 });
  await win.waitForTimeout(800);
});

// Ensure the External Sessions modal is open (shot 04 leaves a viewer open;
// Esc drops back to it, but if the modal closed entirely, reopen via palette).
async function ensureModalOpen() {
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
  const open = await win.evaluate(() => !!document.querySelector(".modal"));
  if (open) return;
  await win.locator(".nav-item", { hasText: "Search" }).first().click();
  await win.waitForTimeout(500);
  await win.keyboard.type("external sessions");
  await win.waitForTimeout(600);
  await win.keyboard.press("Enter");
  await win.waitForSelector(".modal", { timeout: 8000 });
}

// 05 — Import tab: render the per-source drop-zones.
await shot("05-import", async () => {
  await ensureModalOpen();
  await win
    .locator(".modal .pal-chip", { hasText: "Import" })
    .first()
    .click({ timeout: 8000 });
  await win.waitForTimeout(500);
});

// Drive the import through the REAL IPC (the native file picker can't be
// automated). This exercises extract → content-hash copy → scan → redaction.
const imp = await win.evaluate(
  (p) => window.hermesAPI.externalContextImportFile("chatgpt", p),
  chatgptZip,
);
console.log(
  "IMPORT_RESULT:",
  JSON.stringify({
    conversations: imp?.conversations,
    messages: imp?.messages,
    reused: imp?.reused,
  }),
);
if (!imp || imp.conversations < 1) {
  console.log("IMPORT_FAIL: no conversations indexed");
  await app.close();
  process.exit(3);
}
// Idempotency: the same ZIP a second time must not change the row counts.
const imp2 = await win.evaluate(
  (p) => window.hermesAPI.externalContextImportFile("chatgpt", p),
  chatgptZip,
);
if (
  imp2.conversations !== imp.conversations ||
  imp2.messages !== imp.messages
) {
  console.log(
    "IMPORT_FAIL: not idempotent",
    `${imp.conversations}/${imp.messages}`,
    "→",
    `${imp2.conversations}/${imp2.messages}`,
  );
  await app.close();
  process.exit(3);
}
console.log("IMPORT_IDEMPOTENT ok");

// 06 — the imported, redacted content is searchable through the UI.
await shot("06-import-search", async () => {
  await win
    .locator(".modal .pal-chip", { hasText: "Search" })
    .first()
    .click({ timeout: 8000 });
  await win.waitForTimeout(300);
  const input = win.locator(".modal .pal-input input").first();
  await input.fill("importedsmoketoken");
  await input.press("Enter");
  await win.waitForTimeout(1200);
});
const importHits = await win.evaluate(
  () => document.querySelectorAll(".modal .scroll .lst-row").length,
);
const importLeak = await win.evaluate(
  () =>
    document.querySelector(".modal")?.textContent?.includes("sk-ant-api03") ??
    false,
);
if (importHits < 1) {
  console.log("IMPORT_FAIL: imported content not searchable in the UI");
  await app.close();
  process.exit(3);
}
if (importLeak) {
  console.log("IMPORT_FAIL: secret leaked into the import search UI");
  await app.close();
  process.exit(3);
}
console.log("IMPORT_SEARCH ok (hit rendered, no secret leak)");

console.log("SHOTS_OK:", shots.length, "—", shots.join(", "));
await app.close();
console.log("SMOKE_DONE");
