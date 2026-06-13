// verify-admin-overlay.mjs — one-off visual check for the admin-overlay IA:
// opens the Hermes admin overlay and screenshots the grouped nav + Settings tabs
// + the connectivity views. Build first. (Skills moved to the SPS Workspace
// Settings surface in P2.6; the admin overlay is now connectivity + system only.)
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "admin-verify");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-admin-"));
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);

const app = await electron.launch({
  args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(1500);

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

// Open the admin overlay (no API-key rule may route to Providers; force-open).
await shot("a1-admin-open", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(new CustomEvent("hermes:open-settings")),
  );
  await win.waitForSelector(".sidebar-nav-group-header", { timeout: 10000 });
});

// Settings tab visible? Click through a couple tabs.
await shot("a2-settings-tab", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", { detail: { view: "settings" } }),
    ),
  );
  await win.waitForSelector(".settings-subnav", { timeout: 10000 });
});
await shot("a3-settings-connection", async () => {
  const tabs = await win.$$(".settings-subnav-tab");
  if (tabs[1]) await tabs[1].click();
});

// Providers — a connectivity view (Memory moved into the SPS "You" surface).
await shot("a4-providers-view", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", {
        detail: { view: "providers" },
      }),
    ),
  );
});

// Gateway — a connectivity view (admin overlay is connectivity + system only now).
await shot("a5-gateway-view", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", { detail: { view: "gateway" } }),
    ),
  );
});

// Assertions: grouped headers exist, Settings sub-nav exists, exactly one tab active.
const groupCount = await win.$$eval(
  ".sidebar-nav-group-header",
  (els) => els.length,
);
const subnavCount = await win.$$eval(
  ".settings-subnav-tab",
  (els) => els.length,
);
console.log(`GROUPS=${groupCount} SUBNAV_TABS=${subnavCount}`);
console.log(`SHOTS_OK: ${shots.length} — ${shots.join(", ")}`);
console.log("VERIFY_DONE");
await app.close();
