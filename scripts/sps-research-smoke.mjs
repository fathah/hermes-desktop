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
//           SMOKE_TOPIC="your topic" node scripts/sps-research-smoke.mjs
//
// Exit: 0 = saved (then Undone), 1 = ran but did not save (see PHASE/DETAIL),
//       2 = watchdog timeout, 3 = could not open the Research modal.
import { _electron as electron } from "playwright";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
