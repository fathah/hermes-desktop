// sps-research-smoke.mjs — LIVE smoke for "research any topic → save to the KB".
//
// Unlike sps-smoke.mjs (which boots a throwaway, pre-seeded HERMES_HOME and is
// purely a UI/visual smoke), THIS harness drives the BUILT app against your
// REAL ~/.hermes gateway — it makes real model + web-search calls and writes a
// real (then Undone) wiki page. It is therefore opt-in, NOT part of CI, and
// costs gateway tokens. Use it to confirm the research→KB path works end-to-end
// against a live gateway after changing the research feature or the gateway
// auth path.
//
// Prereqs:  npm run build   (this drives out/main, like sps-smoke.mjs)
// Usage:    node scripts/sps-research-smoke.mjs
//           HERMES_LIVE_SMOKE=1 node scripts/sps-research-smoke.mjs
//           SMOKE_TOPIC="your topic" node scripts/sps-research-smoke.mjs
//
// Exit: 0 = skipped unless HERMES_LIVE_SMOKE=1, or saved (then Undone);
//       1 = missing credentials, or ran but did not save (see PHASE/DETAIL);
//       2 = watchdog timeout; 3 = could not open the Research modal.
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

const LIVE_KEY_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
];

function hasUsableKeyValue(value) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  return !!trimmed && trimmed !== "sk-ant-test-0000000000";
}

function envFileHasLiveKey(path) {
  if (!existsSync(path)) return false;
  const lines = readFileSync(path, "utf-8").split(/\r?\n/);
  return lines.some((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !LIVE_KEY_NAMES.includes(match[1])) return false;
    return hasUsableKeyValue(match[2]);
  });
}

if (process.env.HERMES_LIVE_SMOKE !== "1") {
  console.log("LIVE_SMOKE_SKIPPED: set HERMES_LIVE_SMOKE=1 to run");
  process.exit(0);
}

const hasLiveKey =
  LIVE_KEY_NAMES.some((name) => hasUsableKeyValue(process.env[name] || "")) ||
  envFileHasLiveKey(join(homedir(), ".hermes", ".env"));

if (!hasLiveKey) {
  console.log(
    "LIVE_SMOKE_MISSING_CREDENTIALS: configure a live provider key before running",
  );
  process.exit(1);
}

const { _electron: electron } = await import("playwright");

const OUT =
  process.env.SMOKE_OUT || mkdtempSync(join(tmpdir(), "sps-research-smoke-"));
const TOPIC =
  process.env.SMOKE_TOPIC ||
  "What is the EU AI Act's risk-tier classification?";
const log = (...a) => console.log(...a);
log("OUT=", OUT, "\nTOPIC=", TOPIC);

const watchdog = setTimeout(() => {
  log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 300000);
watchdog.unref();

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 40000 });
await win.waitForTimeout(2000);

const shots = [];
async function shot(name) {
  await win.waitForTimeout(500);
  const p = join(OUT, `${name}.png`);
  await win.screenshot({ path: p });
  shots.push(p);
  log("SHOT:", p);
}

// First-run onboarding can intercept; click through it.
try {
  const enter = win.locator(
    'button:has-text("Enter workspace"), button:has-text("Skip")',
  );
  if (await enter.first().isVisible({ timeout: 1500 })) {
    await enter.first().click();
    await win.waitForTimeout(800);
  }
} catch {
  /* none */
}
await shot("00-launch");

async function openResearch() {
  const tries = [
    () =>
      win
        .locator('.nav-item:has-text("Research")')
        .first()
        .click({ timeout: 3000 }),
    () =>
      win
        .locator('button:has-text("Research"), .lst-row:has-text("Research")')
        .first()
        .click({ timeout: 3000 }),
  ];
  for (const t of tries) {
    try {
      await t();
      await win.waitForSelector(".modal", { timeout: 6000 });
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}
if (!(await openResearch())) {
  log("RESULT: COULD_NOT_OPEN_RESEARCH_MODAL");
  await shot("99-no-modal");
  await app.close();
  clearTimeout(watchdog);
  process.exit(3);
}
await shot("01-modal-open");

log(
  "MODAL_HEADER=",
  JSON.stringify(
    (
      await win
        .locator(".modal h3")
        .first()
        .textContent()
        .catch(() => "")
    ).trim(),
  ),
);
log(
  "WEB_PREFLIGHT_BANNER_SHOWN=",
  await win
    .locator('.modal:has-text("Enable web research")')
    .first()
    .isVisible()
    .catch(() => false),
);

try {
  await win
    .locator('.pal-chip:has-text("Any topic")')
    .first()
    .click({ timeout: 2000 });
} catch {
  /* already there */
}
await win.locator(".modal .pal-input input").first().fill(TOPIC);
await win.locator('.modal button:has-text("Research")').first().click();
log("research run started; polling for result…");

let phase = "running";
let detail = "";
const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  if (
    await win
      .locator('.modal .c-name:has-text("Saved to your Knowledge Base")')
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    phase = "saved";
    detail =
      (await win
        .locator(".modal small")
        .first()
        .textContent()
        .catch(() => "")) || "";
    break;
  }
  if (
    await win
      .locator('.modal button:has-text("Try again")')
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    phase = "warn-or-error";
    detail =
      (await win
        .locator(".modal small")
        .last()
        .textContent()
        .catch(() => "")) || "";
    break;
  }
  await win.waitForTimeout(2500);
}
log(
  "PHASE=",
  phase,
  "\nDETAIL=",
  JSON.stringify((detail || "").trim().slice(0, 300)),
);
await shot("03-result");

if (phase === "saved") {
  try {
    await win
      .locator('.modal button:has-text("Undo")')
      .first()
      .click({ timeout: 4000 });
    await win.waitForTimeout(1000);
    log("UNDO: clicked (page moved to trash)");
  } catch (e) {
    log("UNDO: could not click —", e.message);
  }
}

await win.waitForTimeout(500);
await app.close();
clearTimeout(watchdog);
log("SMOKE_DONE phase=" + phase);
process.exit(phase === "saved" ? 0 : 1);
