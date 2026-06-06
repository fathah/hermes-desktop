/* eslint-disable @typescript-eslint/explicit-function-return-type */
// verify-agentic.mjs — throwaway live verification of the M1/M2 renderer UI:
//   • slash menu shows the AI group (Plan / Work)
//   • selection toolbar shows the AI actions menu (TLDR / Rewrite / …)
//   • Settings → Automation shows the auto-approve + completion-sound toggles
// Reuses the sps-smoke seeding (throwaway HERMES_HOME). Asserts, doesn't just shot.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "verify-agentic");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-verify-"));

mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);

const sps = join(HOME, "sps-agent");
const vault = join(sps, "vault");
mkdirSync(vault, { recursive: true });
const workspace = {
  tree: [{ id: "home", children: [] }],
  meta: { home: { icon: "🏠", title: "Home", cover: null } },
  docs: {
    home: [
      { id: "h1", type: "h1", text: "Home" },
      { id: "p1", type: "p", text: "Welcome to the smoke workspace." },
    ],
  },
  comments: [],
  trash: [],
  page: "home",
};
writeFileSync(join(sps, "workspace.json"), JSON.stringify(workspace, null, 2));
writeFileSync(
  join(vault, "home.md"),
  `---\ntitle: "Home"\nicon: "🏠"\n---\n\n# Home\n\nWelcome to the smoke workspace.\n`,
);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`,
  );
};

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 90000).unref();

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(1800);

// ── 1. Slash menu AI group ───────────────────────────────────────────────────
try {
  const para = win
    .locator(".block")
    .filter({ hasText: "Welcome to the smoke" })
    .first();
  await para.click();
  // Select the line and replace it with "/" to trigger the slash menu.
  await win.keyboard.press(`${MOD}+a`);
  await win.keyboard.type("/");
  await win.waitForSelector(".menu", { timeout: 4000 });
  const menuText = await win.locator(".menu").first().innerText();
  check(
    "slash menu shows AI group",
    /AI/.test(menuText),
    `labels: ${menuText.replace(/\n/g, " ").slice(0, 80)}`,
  );
  check("slash menu has Plan action", /Plan/.test(menuText));
  check("slash menu has Work action", /Work this plan/.test(menuText));
  await win.screenshot({ path: join(OUT, "slash-ai.png") });
} catch (e) {
  check("slash menu AI group", false, e.message);
}
await win.keyboard.press("Escape").catch(() => {});
await win.waitForTimeout(400);

// ── 2. Selection toolbar AI menu ─────────────────────────────────────────────
try {
  // Re-seed text into the block (we replaced it with "/"), then select it.
  const block = win.locator(".block").first();
  await block.click();
  await win.keyboard.press(`${MOD}+a`);
  await win.keyboard.type("Some sentence to act on.");
  await win.keyboard.press(`${MOD}+a`);
  await win.waitForSelector(".sel-toolbar", { timeout: 4000 });
  const aiBtn = win.locator('.sel-toolbar button[title="AI actions"]');
  check("selection toolbar has AI actions button", (await aiBtn.count()) > 0);
  await aiBtn.first().click();
  await win.waitForSelector(".st-pop", { timeout: 4000 });
  const popText = await win.locator(".st-pop").first().innerText();
  check(
    "AI menu shows TLDR",
    /TLDR/.test(popText),
    popText.replace(/\n/g, " ").slice(0, 80),
  );
  check("AI menu shows Rewrite", /Rewrite/.test(popText));
  await win.screenshot({ path: join(OUT, "selection-ai.png") });
} catch (e) {
  check("selection toolbar AI menu", false, e.message);
}
await win.keyboard.press("Escape").catch(() => {});
await win.waitForTimeout(400);

// ── 3. Settings → Automation toggles ─────────────────────────────────────────
try {
  await win.keyboard.press(`${MOD}+,`);
  await win.waitForTimeout(1200);
  // Find and click a "Settings" nav entry if present, else assume already shown.
  await win.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find(
      (n) =>
        n.children.length === 0 &&
        /^Settings$/.test((n.textContent || "").trim()),
    );
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await win.waitForTimeout(1000);
  const bodyText = await win.evaluate(() => document.body.innerText);
  check("Settings shows Automation section", /Automation/i.test(bodyText));
  check(
    "Settings shows Scoped auto-approve",
    /Scoped auto-approve/.test(bodyText),
  );
  check("Settings shows Completion sound", /Completion sound/.test(bodyText));
  await win.screenshot({ path: join(OUT, "settings-automation.png") });
} catch (e) {
  check("Settings Automation toggles", false, e.message);
}

await app.close();
const failed = results.filter((r) => !r.ok);
console.log(
  `\nVERIFY_DONE: ${results.length - failed.length}/${results.length} passed`,
);
console.log("SHOTS:", OUT);
process.exit(failed.length ? 1 : 0);
