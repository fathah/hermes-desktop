// skill-from-repo-smoke.mjs — "Generate skill from a repo" UI smoke (build first).
//
// Drives the real app: admin → Skills → Generate from repo. Playwright can't
// click the OS folder picker or run a live gateway, so we stub BOTH in the main
// process — dialog.showOpenDialog returns a fixture repo path, and fetch returns
// a canned SKILL.md. Everything between (digest → request → parse → prefill →
// createSkill) runs for real.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "skill-from-repo-smoke");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-sfr-smoke-"));

// A tiny fixture repo for the digest.
const REPO = mkdtempSync(join(tmpdir(), "fixture-repo-"));
writeFileSync(join(REPO, "README.md"), "# Fixture\n\nA fixture repository.");
writeFileSync(
  join(REPO, "package.json"),
  '{"name":"fixture","version":"1.0.0"}',
);

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
  JSON.stringify(
    { onboardingCompleted: true, schedulerEnabled: false },
    null,
    2,
  ),
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
  args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});

// Stub the folder picker → fixture repo, and the gateway fetch → canned SKILL.md.
await app.evaluate(async ({ dialog }, repo) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [repo] });
  const skill =
    "---\nname: generated-skill\ndescription: when working in the fixture repo\n---\n\n# Generated\n\nDrafted by the smoke.";
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: skill } }] }),
    text: async () => "",
  });
}, REPO);

const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(1500);

// Learning → Skills.
await win.locator(".nav-item", { hasText: "Teach Me" }).first().click();
await win.waitForSelector(".settings-subnav", { timeout: 10000 });
await win.locator(".settings-subnav-tab", { hasText: "Skills" }).click();
await win.getByText("Generate from repo", { exact: true }).waitFor({
  timeout: 10000,
});

// Generate from repo → pending draft should appear, then accept it.
await win.getByLabel("Repository path").fill(REPO);
await win.getByText("Generate draft", { exact: true }).click();
const draft = win.locator(".memory-entry-card", { hasText: "generated-skill" });
try {
  await draft.first().waitFor({ timeout: 15000 });
} catch {
  await win.screenshot({ path: join(OUT, "99-no-draft.png") });
  fail("generated skill draft did not appear");
}
await win.screenshot({ path: join(OUT, "01-draft.png") });

await draft.getByText("Accept", { exact: true }).click();
try {
  await win
    .locator(".memory-entry-card", { hasText: "generated-skill" })
    .filter({ hasText: "Disable" })
    .first()
    .waitFor({ timeout: 10000 });
} catch {
  await win.screenshot({ path: join(OUT, "98-no-save.png") });
  fail("generated skill did not appear under Installed");
}
if (!existsSync(join(HOME, "skills", "custom", "generated-skill", "SKILL.md")))
  fail("generated skill SKILL.md was not written");
await win.screenshot({ path: join(OUT, "02-saved.png") });

console.log("SMOKE_OK: generated a skill from a repo, reviewed, and saved it");
await app.close();
console.log("SMOKE_DONE");
