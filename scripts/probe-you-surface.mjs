// probe-you-surface.mjs — one-off verification for the "You" workspace surface.
// Boots the BUILT app against a throwaway HERMES_HOME (mirrors sps-smoke.mjs),
// opens the You surface, adds a rule via a suggestion chip, and asserts the rule
// round-trips into USER.md on disk as a managed `## Rules` block.
//
// Usage:  npm run build && node scripts/probe-you-surface.mjs
import { _electron as electron } from "playwright";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "you-probe");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-you-"));

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
mkdirSync(join(HOME, "sps-agent", "vault"), { recursive: true });
writeFileSync(
  join(HOME, "sps-agent", "workspace.json"),
  JSON.stringify({
    tree: [{ id: "home", children: [] }],
    meta: { home: { title: "Home" } },
    docs: { home: [] },
    page: "home",
  }),
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

function fail(msg) {
  console.error("PROBE_FAIL:", msg);
  app.close();
  process.exit(1);
}

// Open the You surface from the rail.
await win.locator(".nav-item", { hasText: "My Alignment" }).first().click();
await win.waitForSelector(".settings-header", { timeout: 8000 });
const header = await win.locator(".settings-header").first().textContent();
if (!header || !header.includes("You"))
  fail(`You header not shown (got: ${header})`);

// The rules manager + its suggestions should render.
await win.waitForSelector("text=How I like things", { timeout: 8000 });
await win.screenshot({ path: join(OUT, "you-surface.png") });
console.log("SHOT ok: you-surface");

// Add a rule via the first suggestion chip, then confirm it round-trips to disk.
const chip = win.locator(".you-rule-suggestions button").first();
const chipText = (await chip.textContent())?.trim() || "";
await chip.click();

const userMdPath = join(HOME, "memories", "USER.md");
let ok = false;
for (let i = 0; i < 40; i++) {
  if (existsSync(userMdPath)) {
    const content = readFileSync(userMdPath, "utf-8");
    if (content.includes("## Rules") && content.includes("- ")) {
      ok = true;
      console.log("USER.md after add:\n---\n" + content + "\n---");
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 150));
}
if (!ok) fail(`rule did not persist to ${userMdPath}`);

await win.screenshot({ path: join(OUT, "you-surface-with-rule.png") });
console.log("SHOT ok: you-surface-with-rule");
console.log("ADDED_RULE:", chipText);
console.log("PROBE_DONE");
await app.close();
