// verify-firstrun-seed.mjs — proves the first-run guided seed (P2.8).
//
// Unlike sps-smoke.mjs (which writes its OWN workspace.json fixture), this probe
// launches the BUILT app against a fresh profile with NO sps-agent/workspace.json
// so the renderer falls back to buildInitialWorkspace() — the real first-run path.
// It asserts the seeded "Start here" page lands and the dismissible 3-step
// onboarding checklist renders. Run `npm run build` first.
//
// Usage:  node scripts/verify-firstrun-seed.mjs
import { _electron as electron } from "playwright";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "firstrun-seed");
mkdirSync(OUT, { recursive: true });

const HOME = mkdtempSync(join(tmpdir(), "hermes-firstrun-"));
const SCREENSHOT_DIR = join(HOME, "firstrun-screenshots");
const SEEDED_SCREENSHOT_NAME = "Screenshot 2026-06-22 at 09.00.00.png";

mkdirSync(SCREENSHOT_DIR, { recursive: true });
writeFileSync(
  join(SCREENSHOT_DIR, SEEDED_SCREENSHOT_NAME),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ),
);

// Install markers (skip welcome/installing/setup) + onboarding already completed
// (skip the Onboarding screen) — but deliberately NO sps-agent/ workspace, so the
// SPS store starts from buildInitialWorkspace().
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
  JSON.stringify({ onboardingCompleted: true }, null, 2),
);

console.log("HERMES_HOME=", HOME);

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 90000).unref();

const app = await electron.launch({
  args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    HERMES_RECENT_SCREENSHOT_DIR: SCREENSHOT_DIR,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(2000);

let failures = 0;
async function check(name, fn) {
  try {
    const ok = await fn();
    if (ok) {
      console.log("CHECK ok:", name);
    } else {
      failures++;
      console.log("CHECK FAIL:", name, "— assertion false");
    }
  } catch (e) {
    failures++;
    console.log("CHECK FAIL:", name, "—", e.message);
  }
}

function findSeededScreenshotCapture() {
  const inboxDir = join(HOME, "sps-agent", "vault", "_inbox");
  if (!existsSync(inboxDir)) return null;
  for (const name of readdirSync(inboxDir)) {
    if (!name.endsWith(".md")) continue;
    const markdown = readFileSync(join(inboxDir, name), "utf8");
    if (markdown.includes(SEEDED_SCREENSHOT_NAME)) return { name, markdown };
  }
  return null;
}

async function waitForSeededScreenshotCapture() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const found = findSeededScreenshotCapture();
    if (found) return found;
    await win.waitForTimeout(200);
  }
  return null;
}

await win.screenshot({ path: join(OUT, "firstrun.png") });

// The seeded "Start here" page is the landing page → its title is in the sidebar
// tree and its content renders in the doc.
await check("start-here in sidebar tree", async () => {
  return await win.evaluate(() =>
    [...document.querySelectorAll(".tree-label, .nav-label")].some((n) =>
      (n.textContent || "").includes("Start here"),
    ),
  );
});

await check("start-here doc content renders", async () => {
  const body = (await win.locator("body").innerText()).toLowerCase();
  return body.includes("home base");
});

await check("inbox explainer page seeded", async () => {
  return await win.evaluate(() =>
    [...document.querySelectorAll(".tree-label, .nav-label")].some((n) =>
      (n.textContent || "").includes("How the Inbox works"),
    ),
  );
});

// The dismissible 3-step checklist renders on first run.
await check("onboarding checklist renders", async () => {
  return (await win.locator(".ob-checklist").count()) > 0;
});

await check("checklist has 3 steps", async () => {
  return (await win.locator(".ob-step-card").count()) === 3;
});

await check("Capture opens Inbox image screenshot intake", async () => {
  await win.getByRole("button", { name: "Capture screenshot" }).click();
  await win.getByRole("button", { name: "Capture screen" }).waitFor({
    timeout: 8000,
  });
  await win.getByRole("button", { name: "Import from clipboard" }).waitFor({
    timeout: 8000,
  });
  await win.getByText(SEEDED_SCREENSHOT_NAME).waitFor({ timeout: 8000 });
  return (await win.locator(".inbox-image-capture").count()) === 1;
});

await check("Capture imports a seeded recent screenshot", async () => {
  await win.getByRole("button", { name: SEEDED_SCREENSHOT_NAME }).click();
  const found = await waitForSeededScreenshotCapture();
  if (!found) return false;
  const assetMatch = /!\[Screenshot\]\(\.\.\/_assets\/([^)]+)\)/.exec(
    found.markdown,
  );
  if (!assetMatch) return false;
  return (
    found.markdown.includes('source: "screenshot"') &&
    found.markdown.includes('captureOrigin: "recent-file"') &&
    existsSync(join(HOME, "sps-agent", "vault", "_assets", assetMatch[1]))
  );
});

await check("return to Start here after capture path", async () => {
  await win
    .locator(".tree-label, .nav-label", { hasText: "Start here" })
    .first()
    .click();
  await win.locator(".ob-checklist").waitFor({ timeout: 8000 });
  return (await win.locator(".ob-checklist").count()) > 0;
});

// Dismiss persists: click ×, the checklist disappears.
await check("checklist dismiss hides it", async () => {
  await win.locator(".ob-checklist-dismiss").click();
  await win.waitForTimeout(300);
  return (await win.locator(".ob-checklist").count()) === 0;
});

// Discoverability (P2.9): the ⌘K palette now surfaces Ask / Vault health / Telos.
// Vault health had NO UI entry point before — this command is its only door.
// Open the palette via the sidebar Search button (deterministic in a probe).
await check("palette exposes Vault health + Ask + Telos", async () => {
  await win.locator(".nav-item", { hasText: "Search" }).first().click();
  await win.waitForSelector(".palette", { timeout: 8000 });
  const labels = await win.locator(".pal-item .label").allInnerTexts();
  const blob = labels.join(" | ");
  return (
    blob.includes("Vault health") &&
    blob.includes("Ask your workspace") &&
    blob.includes("Telos alignment audit")
  );
});

await check("Vault health command opens the health surface", async () => {
  // Filter to the single command, then Enter.
  await win.locator(".pal-input input").fill("Vault health");
  await win.waitForTimeout(300);
  await win.keyboard.press("Enter");
  await win.waitForTimeout(600);
  return (await win.locator("body").innerText())
    .toLowerCase()
    .includes("vault health");
});

console.log(`FAILURES=${failures}`);
console.log("VERIFY_DONE");
await app.close();
process.exit(failures === 0 ? 0 : 1);
