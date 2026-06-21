// verify-admin-overlay.mjs — focused visual check for the task-based Control
// Center. Opens the real SPS Settings gear, verifies the Overview default, and
// checks legacy deep-link aliases still land on their new task destinations.
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
  join(HOME, "desktop.json"),
  JSON.stringify(
    { onboardingCompleted: true, schedulerEnabled: false },
    null,
    2,
  ),
);
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

// Open the admin overlay through the actual SPS rail Settings gear.
await shot("a1-control-center-overview", async () => {
  await win.locator('[aria-label="Settings"]').click();
  await win.getByRole("heading", { name: "Control Center" }).waitFor({
    timeout: 10000,
  });
  await win.getByRole("button", { name: "Open AI Setup" }).waitFor({
    timeout: 10000,
  });
});

// Legacy providers deep-link -> AI Setup.
await shot("a2-legacy-providers-ai-setup", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", {
        detail: { view: "providers" },
      }),
    ),
  );
  await win.getByRole("heading", { name: "AI Setup" }).waitFor({
    timeout: 10000,
  });
});

// Legacy gateway deep-link -> Connected Apps.
await shot("a3-legacy-gateway-connected-apps", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", { detail: { view: "gateway" } }),
    ),
  );
  await win.getByRole("heading", { name: "Connected Apps" }).waitFor({
    timeout: 10000,
  });
});

// Legacy settings deep-link -> Overview, not the old nested Settings taxonomy.
await shot("a4-legacy-settings-overview", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", { detail: { view: "settings" } }),
    ),
  );
  await win.getByRole("heading", { name: "Control Center" }).waitFor({
    timeout: 10000,
  });
});

// Preferences is a flat section: no second-level Settings tab strip.
await shot("a5-preferences-no-subnav", async () => {
  await win.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", {
        detail: { view: "preferences" },
      }),
    ),
  );
  await win.getByRole("heading", { name: "Preferences" }).waitFor({
    timeout: 10000,
  });
});

// Assertions: grouped headers exist, old Settings sub-nav is gone.
const groupCount = await win.$$eval(
  ".sidebar-nav-group-header",
  (els) => els.length,
);
const subnavCount = await win.$$eval(
  ".settings-subnav",
  (els) => els.length,
);
if (groupCount !== 3) {
  throw new Error(`Expected 3 Control Center nav groups, got ${groupCount}`);
}
if (subnavCount !== 0) {
  throw new Error(`Expected no Settings subnav, got ${subnavCount}`);
}
console.log(`GROUPS=${groupCount} SETTINGS_SUBNAV=${subnavCount}`);
console.log(`SHOTS_OK: ${shots.length} — ${shots.join(", ")}`);
console.log("VERIFY_DONE");
await app.close();
