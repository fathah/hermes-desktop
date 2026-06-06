// skills-smoke.mjs — admin Skills UI smoke (build first).
//
// Drives the real app: open the admin overlay (gear) → Skills → author a new
// skill via the New-skill modal → assert it appears under Installed → click
// Disable → assert it moves to the Disabled section (folder moved to
// skills-disabled/, the gateway no longer sees it).
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "skills-smoke");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-skills-smoke-"));

mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);
const sps = join(HOME, "sps-agent");
mkdirSync(join(sps, "vault"), { recursive: true });
writeFileSync(
  join(sps, "workspace.json"),
  JSON.stringify({
    tree: [{ id: "home", children: [] }],
    meta: { home: { icon: "🏠", title: "Home", cover: null } },
    docs: { home: [{ id: "h1", type: "h1", text: "Home" }] },
    comments: [],
    trash: [],
    page: "home",
  }),
);
writeFileSync(
  join(sps, "vault", "home.md"),
  `---\ntitle: "Home"\n---\n\n# Home\n`,
);

console.log("HERMES_HOME=", HOME);
const fail = (m) => {
  console.log("SMOKE_FAIL:", m);
  process.exit(1);
};
setTimeout(() => fail("WATCHDOG_TIMEOUT"), 120000).unref();

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
await win.waitForTimeout(1500);

// Open the admin overlay and navigate to Skills.
await win.locator(".sps-admin-gear").first().click();
await win.waitForTimeout(600);
await win.locator(".sidebar-nav-item", { hasText: "Skills" }).first().click();
await win.waitForSelector(".skills-container", { timeout: 10000 });
await win.screenshot({ path: join(OUT, "01-skills.png") });

// Author a new skill.
await win.getByText("New skill", { exact: true }).click();
await win.waitForSelector(".skills-new-form", { timeout: 5000 });
await win.locator(".skills-new-input").first().fill("Smoke Skill");
await win
  .locator(".skills-new-textarea")
  .fill("# Smoke Skill\n\nA skill created by the smoke test.");
await win.getByText("Create", { exact: true }).click();

// It should appear under Installed.
const installedCard = win.locator(".skills-card", { hasText: "Smoke Skill" });
try {
  await installedCard.first().waitFor({ timeout: 10000 });
} catch {
  await win.screenshot({ path: join(OUT, "99-no-create.png") });
  fail("new skill did not appear under Installed");
}
if (!existsSync(join(HOME, "skills", "custom", "smoke-skill", "SKILL.md")))
  fail("SKILL.md was not written to the profile skills dir");
await win.screenshot({ path: join(OUT, "02-created.png") });

// Disable it → it should move to the Disabled section.
await win.getByText("Disable", { exact: true }).first().click();
try {
  await win
    .locator(".skills-card-disabled", { hasText: "Smoke Skill" })
    .first()
    .waitFor({ timeout: 10000 });
} catch {
  await win.screenshot({ path: join(OUT, "98-no-disable.png") });
  fail("skill did not move to the Disabled section");
}
if (
  !existsSync(
    join(HOME, "skills-disabled", "custom", "smoke-skill", "SKILL.md"),
  )
)
  fail("disabled skill folder was not moved to skills-disabled/");
if (existsSync(join(HOME, "skills", "custom", "smoke-skill")))
  fail("disabled skill still present in the gateway-visible skills/ dir");
await win.screenshot({ path: join(OUT, "03-disabled.png") });

console.log("SMOKE_OK: authored a skill, then disabled it (moved off skills/)");
await app.close();
console.log("SMOKE_DONE");
