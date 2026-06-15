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
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "sps-smoke");
mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(OUT)) {
  if (name.endsWith(".png")) unlinkSync(join(OUT, name));
}

const HOME = mkdtempSync(join(tmpdir(), "hermes-smoke-"));

// ── install markers: file existence is enough to pass checkInstallStatus, so
//    App.tsx routes straight to the main (SPS) screen. ───────────────────────
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
const pythonShim = join(HOME, "hermes-agent", "venv", "bin", "python");
writeFileSync(
  pythonShim,
  `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });

function resultFor(cmd) {
  if (cmd === "index") return { ok: true, engine: "smoke-shim", notes: 0 };
  if (cmd === "search") return { results: [] };
  if (cmd === "graph") return { nodes: [], edges: [] };
  if (cmd === "rag") return { context: [] };
  if (cmd === "status") return { ok: true, txtai_installed: false };
  return { error: "Unknown command: " + cmd };
}

rl.on("line", (line) => {
  try {
    const req = JSON.parse(line);
    const result = resultFor(req.cmd);
    console.log(JSON.stringify({ id: req.id, result }));
  } catch (err) {
    console.log(JSON.stringify({ id: 0, error: String(err && err.message ? err.message : err) }));
  }
});
`,
);
chmodSync(pythonShim, 0o755);
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

// ── seed an SPS workspace: a home page that wikilinks to Alpha, the Alpha page
//    itself, and a folder-backed query database (source "projects"). ──────────
const sps = join(HOME, "sps-agent");
const vault = join(sps, "vault");
mkdirSync(join(vault, "projects"), { recursive: true });

const now = new Date();
const pad = (n) => (n < 10 ? `0${n}` : n);
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const workspace = {
  tree: [
    { id: "home", children: [] },
    { id: "alpha", children: [] },
    { id: "db", children: [] },
    { id: "blank", children: [] },
    // An empty "Research" folder ⇒ DocHeader shows the "No papers yet" nudge.
    { id: "research", children: [] },
    { id: "journal_dummy", children: [] },
  ],
  meta: {
    home: { icon: "🏠", title: "Home", cover: null },
    alpha: { icon: "📄", title: "Alpha", cover: null },
    db: { icon: "🗃️", title: "Projects DB", cover: null },
    // Empty title + no content ⇒ the DocHeader shows the "Get started" launcher.
    blank: { icon: "📄", title: "", cover: null },
    research: { icon: "📚", title: "Research", cover: null },
    journal_dummy: {
      icon: "📔",
      title: "Reflections on the AI Mentor Integration",
      cover: null,
      journal: true,
      date: today,
      time: "10:30",
      mood: "😄",
      tags: ["ai", "mentor"]
    },
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
    journal_dummy: [
      { id: "j_h1", type: "h1", text: "Reflections on the AI Mentor Integration" },
      { id: "j_p1", type: "p", text: "Today we integrated the AI Mentor. The lessons are extremely well-structured and the system is starting to feel incredibly rich and cohesive. The mental models in the Latticework have seeded perfectly." },
      { id: "j_img", type: "image", text: "", src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='400' viewBox='0 0 800 400'><rect width='100%' height='100%' fill='%231f2937'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%236366f1' font-size='24' font-family='sans-serif'>Visual Memory Palace: major-system-01</text></svg>", caption: "Visual Memory Palace mock representation" },
      { id: "j_bm", type: "bookmark", text: "", bm: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Louis Armstrong - St. James Infirmary (Audio)", desc: "A classic rendition of St. James Infirmary, which is track #1 in our Standard 21 jazz education curriculum." } }
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

const expectedShots = [
  "01-home",
  "02-palette",
  "02a-learn-this",
  "02b-research",
  "02c-research-nudge",
  "03-graph",
  "04-tweaks",
  "05-tweaks-section-toggled",
  "06-querydb",
  "07-querydb-addrow",
  "08-backlinks",
  "09-getstarted",
  "10-journal",
  "11-journal-entry",
  "11b-journal-entry-scrolled",
];
const shots = [];
const shotFailures = [];

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
    const message = e instanceof Error ? e.message : String(e);
    shotFailures.push({ name, message });
    console.log("SHOT FAIL:", name, "-", message);
  }
}

// 01 — initial SPS workspace (sectioned sidebar incl. the Graph nav item).
await shot("01-home");

// 02 — ⌘K command palette (two-pane preview).
await shot("02-palette", async () => {
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent("sps:search"));
  });
});
await win.keyboard.press("Escape").catch(() => {});

// 02a — Learn This: first-class learning surface under My Assistant.
await shot("02a-learn-this", async () => {
  await win.locator(".nav-item", { hasText: "Teach Me" }).first().click();
  await win.getByRole("button", { name: "Skills" }).click();
});

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

// 11 — open the seeded journal entry with image and bookmark embeds.
await shot("11-journal-entry", async () => {
  await win.getByText("Reflections on the AI Mentor Integration", { exact: false }).first().click();
  await win.waitForSelector(".doc-scroll", { timeout: 8000 });
});

// 11b — scroll down to see the image and link/youtube bookmark cards.
await shot("11b-journal-entry-scrolled", async () => {
  await win.evaluate(() => {
    const el = document.querySelector(".doc-scroll");
    if (el) el.scrollTop = 450;
  });
});

console.log("SHOTS_OK:", shots.length, "—", shots.join(", "));
await app.close();
const missingShots = expectedShots.filter((name) => !shots.includes(name));
if (shotFailures.length || missingShots.length) {
  for (const failure of shotFailures) {
    console.log(`SHOT_FAILURE: ${failure.name}: ${failure.message}`);
  }
  if (missingShots.length)
    console.log("SHOTS_MISSING:", missingShots.join(", "));
  console.log("SMOKE_FAILED");
  process.exit(1);
}
console.log("SMOKE_DONE");
