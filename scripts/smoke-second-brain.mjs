// smoke-second-brain.mjs — UI smoke for the agent-maintained second-brain loop
// (P0–P6 + extras). Launches the BUILT Electron app (run `npm run build` first)
// against a throwaway pre-seeded profile and drives the new surfaces.
//
// The ingest step calls the Hermes gateway; with no gateway running it must fail
// GRACEFULLY (proving the renderer→IPC→main wiring + error handling). Capture,
// lint, and the editable wiki-schema page are fully exercised.
//
// Usage:  npm run build && node scripts/smoke-second-brain.mjs
import { _electron as electron } from "playwright";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "sps-2brain-smoke");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-2brain-"));

// install markers → App routes straight to the SPS main screen.
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

// Seed a small vault: home → [[alpha]] (connected), plus db + a folder row that
// are orphans (no links) so the lint surface has something to show.
const sps = join(HOME, "sps-agent");
const vault = join(sps, "vault");
mkdirSync(join(vault, "projects"), { recursive: true });
const workspace = {
  tree: [
    { id: "home", children: [] },
    { id: "alpha", children: [] },
    { id: "db", children: [] },
  ],
  meta: {
    home: { icon: "🏠", title: "Home", cover: null },
    alpha: { icon: "📄", title: "Alpha", cover: null },
    db: { icon: "🗃️", title: "Projects DB", cover: null },
  },
  docs: {
    home: [
      { id: "h1", type: "h1", text: "Home" },
      { id: "pl1", type: "page", text: "", pageId: "alpha" },
    ],
    alpha: [{ id: "ah", type: "h1", text: "Alpha" }],
    db: [{ id: "dh", type: "h1", text: "Projects" }],
  },
  comments: [],
  trash: [],
  page: "home",
};
writeFileSync(join(sps, "workspace.json"), JSON.stringify(workspace, null, 2));
writeFileSync(
  join(vault, "home.md"),
  `---\ntitle: "Home"\nicon: "🏠"\n---\n\n# Home\n\n[[alpha]]\n`,
);
writeFileSync(join(vault, "alpha.md"), `---\ntitle: "Alpha"\n---\n\n# Alpha\n`);
writeFileSync(
  join(vault, "db.md"),
  `---\ntitle: "Projects DB"\n---\n\n# Projects\n`,
);
writeFileSync(
  join(vault, "projects", "r1.md"),
  `---\ntitle: "First project"\nstatus: "doing"\n---\n`,
);

console.log("HERMES_HOME=", HOME, "\nSMOKE_OUT=", OUT);

const failures = [];
function check(cond, msg) {
  if (cond) {
    console.log("  ok -", msg);
  } else {
    console.log("  FAIL -", msg);
    failures.push(msg);
  }
}

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 120000).unref();

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
await win.waitForTimeout(1800);

const shot = (n) => win.screenshot({ path: join(OUT, `${n}.png`) });

try {
  // 1 — open the Inbox surface.
  await win.locator(".nav-item", { hasText: "Inbox" }).first().click();
  await win.waitForSelector(".inbox-surface", { timeout: 8000 });
  await shot("01-inbox-empty");
  check(true, "Inbox surface renders");

  // 2 — capture a quick note; it should appear in the unprocessed list.
  const NOTE =
    "Met Sarah from Acme Corp re: the Q3 security guarding contract.";
  await win.locator(".inbox-textarea").fill(NOTE);
  await win.locator("button.btn-primary", { hasText: "Capture" }).click();
  await win.waitForTimeout(1600); // reconcile + chokidar re-index
  const listed = await win
    .getByText("Met Sarah from Acme", { exact: false })
    .count();
  check(listed > 0, "captured quick-note appears in the unprocessed list");
  const inboxFiles = existsSync(join(vault, "_inbox"))
    ? readdirSync(join(vault, "_inbox")).filter((f) => f.endsWith(".md"))
    : [];
  check(
    inboxFiles.length === 1,
    "capture wrote one markdown file to vault/_inbox",
  );
  await shot("02-inbox-captured");

  // 3 — Process inbox. With no gateway it must fail gracefully (error shown),
  //     proving the renderer→IPC→main ingest wiring without a model.
  await win.locator("button.btn-primary", { hasText: "Process inbox" }).click();
  await win.waitForTimeout(2500);
  const proposed = await win
    .getByText("Proposed changes", { exact: false })
    .count();
  const errored = await win
    .locator(".inbox-surface")
    .getByText(/gateway|couldn't|unavailable|usable changeset|failed/i)
    .count();
  check(
    proposed > 0 || errored > 0,
    "Process inbox produced a review queue OR a graceful error (wiring ok)",
  );
  await shot("03-inbox-processed");

  // 4 — Vault health (lint) surface: open through the command palette.
  await win.locator(".nav-item", { hasText: "Search" }).first().click();
  await win.waitForSelector(".palette", { timeout: 8000 });
  await win.locator(".pal-input input").fill("Vault health");
  await win.keyboard.press("Enter");
  await win.waitForTimeout(1500);
  const hasOrphans = await win.getByText("Orphans", { exact: false }).count();
  check(hasOrphans > 0, "Vault health surface renders lint groups");
  await shot("04-vault-health");

  // 5 — back to Inbox; open the editable Wiki schema page from the footer.
  await win.locator(".nav-item", { hasText: "Inbox" }).first().click();
  await win.waitForSelector(".inbox-surface", { timeout: 8000 });
  await win.getByText("Edit wiki schema", { exact: false }).click();
  await win.waitForTimeout(1200);
  const schemaOpen = await win
    .getByText("Wiki schema", { exact: false })
    .count();
  check(schemaOpen > 0, "Edit wiki schema opens the WIKI page");
  const wikiFile = existsSync(join(vault, "WIKI.md"));
  check(wikiFile, "WIKI.md materialized in the vault (editable schema)");
  await shot("05-wiki-schema");
} catch (e) {
  console.log("SMOKE ERROR:", e.message);
  failures.push(`exception: ${e.message}`);
  await shot("99-error").catch(() => {});
}

await app.close();
console.log(
  failures.length === 0
    ? `\nSMOKE PASS — all checks ok (shots in ${OUT})`
    : `\nSMOKE FAIL — ${failures.length} issue(s): ${failures.join("; ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
