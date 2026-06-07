// sps-smoke.mjs — F6 visual-verification harness for the SPS Agent workspace.
//
// Launches the BUILT Electron app (run `npm run build` first) against a
// throwaway, pre-seeded profile so it boots straight into the SPS scope, then
// screenshots the key surfaces. This is the only layer the unit suite can't
// cover (better-sqlite3 + the renderer only run inside Electron).
//
// Usage:  npm run build && node scripts/sps-smoke.mjs
//         SMOKE_OUT=/path node scripts/sps-smoke.mjs   (default /tmp/sps-smoke)
//
// It never touches the real profile: HERMES_HOME is a fresh temp dir, seeded
// with install markers (so the welcome/setup gate is skipped) and a small SPS
// workspace (blob + vault) that exercises wikilinks and a folder-backed query
// database.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "sps-smoke");
mkdirSync(OUT, { recursive: true });

const HOME = mkdtempSync(join(tmpdir(), "hermes-smoke-"));

// ── install markers: file existence is enough to pass checkInstallStatus, so
//    App.tsx routes straight to the main (SPS) screen. ───────────────────────
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);

// ── seed an SPS workspace: a home page that wikilinks to Alpha, the Alpha page
//    itself, and a folder-backed query database (source "projects"). ──────────
const sps = join(HOME, "sps-agent");
const vault = join(sps, "vault");
mkdirSync(join(vault, "projects"), { recursive: true });

const workspace = {
  tree: [
    { id: "home", children: [] },
    { id: "alpha", children: [] },
    { id: "db", children: [] },
    { id: "blank", children: [] },
    // An empty "Research" folder ⇒ DocHeader shows the "No papers yet" nudge.
    { id: "research", children: [] },
  ],
  meta: {
    home: { icon: "🏠", title: "Home", cover: null },
    alpha: { icon: "📄", title: "Alpha", cover: null },
    db: { icon: "🗃️", title: "Projects DB", cover: null },
    // Empty title + no content ⇒ the DocHeader shows the "Get started" launcher.
    blank: { icon: "📄", title: "", cover: null },
    research: { icon: "📚", title: "Research", cover: null },
  },
  docs: {
    home: [
      { id: "h1", type: "h1", text: "Home" },
      { id: "p1", type: "p", text: "Welcome to the smoke workspace." },
      { id: "pl1", type: "page", text: "", pageId: "alpha" },
    ],
    alpha: [
      { id: "ah", type: "h1", text: "Alpha" },
      { id: "ap", type: "p", text: "A linked page." },
    ],
    db: [
      { id: "dh", type: "h1", text: "Projects" },
      {
        id: "dbblk",
        type: "database",
        text: "",
        source: "projects",
        view: "table",
      },
    ],
    blank: [],
    research: [
      {
        id: "rh",
        type: "p",
        text: "Scholarly papers you saved from OpenAlex live here.",
      },
    ],
  },
  comments: [],
  trash: [],
  page: "home",
};
writeFileSync(join(sps, "workspace.json"), JSON.stringify(workspace, null, 2));
writeFileSync(
  join(vault, "home.md"),
  `---\ntitle: "Home"\nicon: "🏠"\n---\n\n# Home\n\nWelcome to the smoke workspace.\n\n[[alpha]]\n`,
);
writeFileSync(
  join(vault, "alpha.md"),
  `---\ntitle: "Alpha"\n---\n\n# Alpha\n\nA linked page.\n`,
);
writeFileSync(
  join(vault, "db.md"),
  `---\ntitle: "Projects DB"\n---\n\n# Projects\n`,
);
writeFileSync(
  join(vault, "projects", "r1.md"),
  `---\ntitle: "First project"\nstatus: "doing"\n---\n`,
);

console.log("HERMES_HOME=", HOME);
console.log("SMOKE_OUT=", OUT);

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 120000).unref();

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const shots = [];

const app = await electron.launch({
  // Isolate Electron's userData (alongside the temp HERMES_HOME) so the smoke
  // gets its OWN single-instance lock — otherwise a developer's running app
  // (which holds the default lock; see requestSingleInstanceLock in main) makes
  // this second instance quit at launch ("Target page has been closed").
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

async function shot(name, fn) {
  try {
    if (fn) await fn();
    await win.waitForTimeout(800);
    await win.screenshot({ path: join(OUT, `${name}.png`) });
    shots.push(name);
    console.log("SHOT ok:", name);
  } catch (e) {
    console.log("SHOT FAIL:", name, "—", e.message);
  }
}

// 01 — initial SPS workspace (sectioned sidebar incl. the Graph nav item).
await shot("01-home");

// 02 — ⌘K command palette (two-pane preview).
await shot("02-palette", async () => {
  await win.keyboard.press(`${MOD}+K`);
});
await win.keyboard.press("Escape").catch(() => {});

// 02b — Research (OpenAlex) modal, opened from the first-class sidebar rail item.
// Offline-safe: we screenshot the modal's initial state (no network dependency).
// Proves the "Research" rail affordance → ResearchModal mount → ensure-agent-tool.
await shot("02b-research", async () => {
  await win.locator(".nav-item", { hasText: "Research" }).first().click();
  await win.waitForSelector(".modal", { timeout: 8000 });
});
await win.keyboard.press("Escape").catch(() => {});

// 02c — empty "Research" folder shows the "No papers yet → Search for papers"
// nudge (DocHeader teaches the folder's use). Click the tree node, not the rail
// item (both read "Research"), via the tree-label like the get-started step.
await shot("02c-research-nudge", async () => {
  await win.evaluate(() => {
    const label = [...document.querySelectorAll(".tree-label")].find(
      (l) => (l.textContent || "").trim() === "Research",
    );
    label?.parentElement?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
  await win.waitForSelector(".gs-row", { timeout: 8000 });
});

// 03 — local wikilink graph view (F4).
await shot("03-graph", async () => {
  await win.locator(".nav-item", { hasText: "Graph" }).first().click();
});

// back to a doc page so the doc-only panel/tweaks render.
await win
  .getByText("Home", { exact: true })
  .first()
  .click()
  .catch(() => {});
await win.waitForTimeout(500);

// 04 — Tweaks panel (sidebar-section toggles + the new Storage section, F5).
// The rail button is titled "Appearance" (it opens the Tweaks panel).
await shot("04-tweaks", async () => {
  await win.locator('[title="Appearance"]').click();
});
// 05 — toggle a sidebar section (Notion "customize sidebar").
await shot("05-tweaks-section-toggled", async () => {
  await win.locator('.twk-toggle[aria-label="Meetings"]').click();
});
await win
  .locator(".twk-x")
  .click()
  .catch(() => {});

// 06 — folder-backed query database (rich table view, F1).
await shot("06-querydb", async () => {
  await win.getByText("Projects DB", { exact: true }).first().click();
});
// 07 — add a row through the inline "Form".
await shot("07-querydb-addrow", async () => {
  await win.locator(".qdb-input").fill("Smoke row");
  await win.getByText("Add", { exact: true }).first().click();
});

// 08 — Info-panel "Linked references" (backlinks) on the linked page. The
// titlebar drag-region overlays the panel tabs, so force past it.
await shot("08-backlinks", async () => {
  await win.getByText("Alpha", { exact: true }).first().click({ force: true });
  await win.waitForTimeout(400);
  // Dispatch the click on the tab node directly so the titlebar overlay can't
  // swallow it; React's onClick still fires from the bubbled event.
  await win.evaluate(() => {
    const tab = [...document.querySelectorAll(".rp-tab")].find((t) =>
      /Info/.test(t.textContent || ""),
    );
    tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
});

// 09 — "Get started with" launcher on the empty page (untitled + no content).
// Its sidebar row has an empty label, so select it by clicking the row directly.
await shot("09-getstarted", async () => {
  await win.evaluate(() => {
    const label = [...document.querySelectorAll(".tree-label")].find(
      (l) => !(l.textContent || "").trim(),
    );
    label?.parentElement?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
});

// 10 — Journal calendar surface (month grid + day timeline).
await shot("10-journal", async () => {
  await win.locator(".nav-item", { hasText: "Journal" }).first().click();
  await win.waitForSelector(".jr .cal-grid", { timeout: 8000 });
});

// 11 — create a journal entry (drops into the block editor). Proves the
// journal→page→editor path and that the new 'journal' surface is wired.
await shot("11-journal-entry", async () => {
  await win.locator(".jr-btn.primary").first().click();
  await win.waitForSelector(".doc-scroll", { timeout: 8000 });
});

console.log("SHOTS_OK:", shots.length, "—", shots.join(", "));
await app.close();
console.log("SMOKE_DONE");
