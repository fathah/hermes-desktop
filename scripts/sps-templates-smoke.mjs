// sps-templates-smoke.mjs — agent-aware templates UI smoke (build first).
//
// Drives the real app: open the template picker → create the "Document / SOP
// review" template → assert its agent-action button renders → click it → assert
// the Assistant panel opens and the button's PROMPT (not its label) is sent to
// the co-author. No gateway is running, so the bridge returns a graceful error
// reply — but the synchronous block→runAgent→panel wiring is what we verify.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "sps-templates-smoke");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-tpl-smoke-"));

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

// Open the template picker and create the Document/SOP review template.
await win.locator(".rail-compose").first().click();
await win.waitForSelector(".tpl-card", { timeout: 10000 });
const card = win.locator(".tpl-card", { hasText: "Document / SOP review" });
if ((await card.count()) === 0) fail("Document / SOP review template missing");
await card.first().click();

// The agent-action button must render in the new page.
const button = win.locator(".b-agent-button", {
  hasText: "Review against our SOPs",
});
try {
  await button.first().waitFor({ timeout: 10000 });
} catch {
  await win.screenshot({ path: join(OUT, "99-no-button.png") });
  fail("agent-action button did not render from the template");
}
await win.screenshot({ path: join(OUT, "01-template-page.png") });

// Click it: the Assistant panel should open and the PROMPT (not the label) sent.
await button.first().click();
try {
  await win
    .getByText(/Review this document against our SOPs/i)
    .first()
    .waitFor({ timeout: 15000 });
} catch {
  await win.screenshot({ path: join(OUT, "98-no-prompt.png") });
  fail("co-author did not receive the button's agentPrompt");
}
await win.waitForTimeout(500);
await win.screenshot({ path: join(OUT, "02-agent-fired.png") });

console.log("SMOKE_OK: template button fired the co-author with its prompt");
await app.close();
console.log("SMOKE_DONE");
