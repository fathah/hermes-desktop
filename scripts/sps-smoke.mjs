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
import { createServer } from "http";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
const SCREENSHOT_DIR = join(HOME, "smoke-screenshots");
const SEEDED_SCREENSHOT_NAME = "Screenshot 2026-06-19 at 09.00.00.png";
const SEEDED_SCREENSHOT_NOTE =
  "Use this screenshot in the smoke Deck Studio brief.";
const QUICK_CAPTURE_TASK_TEXT =
  "Ask Priya to send the launch checklist\nBefore noon.";

mkdirSync(SCREENSHOT_DIR, { recursive: true });
writeFileSync(
  join(SCREENSHOT_DIR, SEEDED_SCREENSHOT_NAME),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ),
);

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
  "model:\n  provider: anthropic\n  default: claude-3-5-sonnet\n",
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
      tags: ["ai", "mentor"],
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
      {
        id: "j_h1",
        type: "h1",
        text: "Reflections on the AI Mentor Integration",
      },
      {
        id: "j_p1",
        type: "p",
        text: "Today we integrated the AI Mentor. The lessons are extremely well-structured and the system is starting to feel incredibly rich and cohesive. The mental models in the Latticework have seeded perfectly.",
      },
      {
        id: "j_img",
        type: "image",
        text: "",
        src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='400' viewBox='0 0 800 400'><rect width='100%' height='100%' fill='%231f2937'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%236366f1' font-size='24' font-family='sans-serif'>Visual Memory Palace: major-system-01</text></svg>",
        caption: "Visual Memory Palace mock representation",
      },
      {
        id: "j_bm",
        type: "bookmark",
        text: "",
        bm: {
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Louis Armstrong - St. James Infirmary (Audio)",
          desc: "A classic rendition of St. James Infirmary, which is track #1 in our Standard 21 jazz education curriculum.",
        },
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

const expectedShots = [
  "01-home",
  "02-palette",
  "02a-learning",
  "02b-research",
  "02c-research-nudge",
  "02d-control-center",
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
  "12-content-studio",
  "13-content-studio-low-score",
  "14-content-studio-run",
  "15-content-studio-analytics",
  "16-content-studio-evidence-block",
  "17-content-studio-evidence-approve",
  "18-content-studio-publish",
  "19-sources-screenshot",
  "20-sources-screenshot-import",
  "21-sources-screenshot-deck",
  "22-deck-studio",
  "23-deck-studio-export",
  "24-quick-capture-task",
];
const shots = [];
const shotFailures = [];

async function startFakeGateway() {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === "/v1/chat/completions") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        if (!body.includes(QUICK_CAPTURE_TASK_TEXT.split("\n")[0])) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unexpected smoke task text" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    route: "human",
                    risky: false,
                    due: "",
                    nagCadence: "daily",
                    assigneeId: "you",
                    reason: "Smoke task needs a human follow-up.",
                    confidence: 0.91,
                  }),
                },
              },
            ],
          }),
        );
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake gateway did not bind to a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const fakeGateway = await startFakeGateway();

const app = await electron.launch({
  // Isolate Electron's userData (alongside the temp HERMES_HOME) so the smoke
  // gets its OWN single-instance lock — otherwise a developer's running app
  // (which holds the default lock; see requestSingleInstanceLock in main) makes
  // this second instance quit at launch ("Target page has been closed").
  args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    HERMES_RECENT_SCREENSHOT_DIR: SCREENSHOT_DIR,
    HERMES_SMOKE_QUICK_CAPTURE: "1",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});
const win = await app.firstWindow({ timeout: 60000 });
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

async function openCommand(label) {
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent("sps:search"));
  });
  await win.waitForSelector(".palette", { timeout: 8000 });
  await win.locator(".pal-item", { hasText: label }).first().click();
}

async function waitForInputValue(locator, predicate, label, timeoutMs = 8000) {
  const start = Date.now();
  let value = "";
  while (Date.now() - start < timeoutMs) {
    value = await locator.inputValue().catch(() => "");
    if (predicate(value)) return value;
    await win.waitForTimeout(100);
  }
  throw new Error(`${label} did not match; last value: ${value}`);
}

function findScreenshotCapture() {
  const inboxDir = join(vault, "_inbox");
  const names = readdirSync(inboxDir).filter((name) => name.endsWith(".md"));
  for (const name of names) {
    const path = join(inboxDir, name);
    const markdown = readFileSync(path, "utf-8");
    if (markdown.includes(SEEDED_SCREENSHOT_NAME)) {
      return { path, markdown };
    }
  }
  throw new Error("seeded screenshot Inbox capture was not written");
}

function assertScreenshotCapturePersisted() {
  const { markdown } = findScreenshotCapture();
  if (!markdown.includes('source: "screenshot"')) {
    throw new Error("screenshot capture is missing screenshot source metadata");
  }
  if (!markdown.includes('captureKind: "source"')) {
    throw new Error("screenshot capture is missing source capture kind");
  }
  if (!markdown.includes(SEEDED_SCREENSHOT_NOTE)) {
    throw new Error("screenshot capture did not persist the smoke note");
  }
  const assetMatch = markdown.match(
    /!\[Screenshot\]\(\.\.\/_assets\/([^)]+)\)/,
  );
  if (!assetMatch?.[1]) {
    throw new Error("screenshot capture is missing an asset reference");
  }
  const assetPath = join(vault, "_assets", assetMatch[1]);
  if (!existsSync(assetPath)) {
    throw new Error(`screenshot asset was not written: ${assetPath}`);
  }
}

function findQuickCaptureTaskRow() {
  const tasksDir = join(vault, "tasks");
  const names = readdirSync(tasksDir).filter((name) => name.endsWith(".md"));
  for (const name of names) {
    const path = join(tasksDir, name);
    const markdown = readFileSync(path, "utf-8");
    if (markdown.includes(QUICK_CAPTURE_TASK_TEXT)) {
      return { rowId: name.replace(/\.md$/, ""), path, markdown };
    }
  }
  throw new Error("quick-capture task row was not written");
}

function assertQuickCaptureTaskPersisted() {
  const { rowId, markdown } = findQuickCaptureTaskRow();
  for (const expected of [
    'status: "todo"',
    'route: "human"',
    'assigneeId: "you"',
    'who: "you"',
    QUICK_CAPTURE_TASK_TEXT.split("\n")[1],
  ]) {
    if (!markdown.includes(expected)) {
      throw new Error(`quick-capture task row is missing ${expected}`);
    }
  }

  const nagPath = join(sps, "task-nag-state.json");
  if (!existsSync(nagPath)) {
    throw new Error("quick-capture task did not create nag state");
  }
  const nagRecords = JSON.parse(readFileSync(nagPath, "utf-8"));
  if (!Array.isArray(nagRecords)) {
    throw new Error("task nag state is not an array");
  }
  const nag = nagRecords.find((record) => record.rowId === rowId);
  if (!nag) {
    throw new Error("task nag state is missing the captured row id");
  }
  if (nag.cadence !== "daily") {
    throw new Error(`task nag cadence mismatch: ${nag.cadence}`);
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

// 02a — Learning surface, opened from command palette.
await shot("02a-learning", async () => {
  await openCommand("Open Learning");
  await win.getByRole("button", { name: "Advanced" }).click();
  await win.getByRole("button", { name: "Skills" }).click();
});

// 02b — Research (OpenAlex) modal, opened from the first-class sidebar rail item.
// Offline-safe: we screenshot the modal's initial state (no network dependency).
// Proves the "Research" rail affordance → ResearchModal mount → ensure-agent-tool.
await shot("02b-research", async () => {
  await openCommand("Research papers");
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

// 02d — Settings opens the Control Center Overview with live AI readiness and
// the active model from the seeded smoke config.
await shot("02d-control-center", async () => {
  await win.getByRole("button", { name: "Settings" }).click();
  await win
    .getByRole("dialog", { name: "SPS Control Center" })
    .waitFor({ timeout: 8000 });
  await win.getByText("claude-3-5-sonnet").waitFor({ timeout: 8000 });
});
await win
  .getByRole("button", { name: "Close settings" })
  .click()
  .catch(() => {});

// 03 — local wikilink graph view (F4).
await shot("03-graph", async () => {
  await openCommand("Open Graph");
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
  await openCommand("Open My Assistant");
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
  await openCommand("Open Work");
  await win.waitForSelector(".jr .cal-grid", { timeout: 8000 });
});

// 11 — open the seeded journal entry with image and bookmark embeds.
await shot("11-journal-entry", async () => {
  await win
    .getByText("Reflections on the AI Mentor Integration", { exact: false })
    .first()
    .click();
  await win.waitForSelector(".doc-scroll", { timeout: 8000 });
});

// 11b — scroll down to see the image and link/youtube bookmark cards.
await shot("11b-journal-entry-scrolled", async () => {
  await win.evaluate(() => {
    const el = document.querySelector(".doc-scroll");
    if (el) el.scrollTop = 450;
  });
});

// 12 — Content Studio surface mounts and creates its review-first workspace pack.
await shot("12-content-studio", async () => {
  await openCommand("Open Content Studio");
  await win.getByRole("heading", { name: "Content Studio" }).waitFor({
    timeout: 8000,
  });
  await win.getByText("Content cockpit").waitFor({ timeout: 8000 });
  await win.getByText("Workspace pack ready").waitFor({ timeout: 8000 });
});

// 13 — low-score ideas are blocked unless explicitly overridden.
await shot("13-content-studio-low-score", async () => {
  await win.getByLabel("Idea title").fill("Smoke thin idea");
  await win
    .getByRole("textbox", { name: "Source URLs", exact: true })
    .fill("https://example.com/smoke");
  await win.getByRole("button", { name: "Start content run" }).click();
  await win.getByText(/Score at least 10\/14/).waitFor({ timeout: 8000 });
});

// 14 — explicit override creates a manual, row-backed content run.
await shot("14-content-studio-run", async () => {
  await win.getByLabel("Override low score").check();
  await win.getByRole("button", { name: "Start content run" }).click();
  await win.getByText(/Created Run - Smoke thin idea/).waitFor({
    timeout: 8000,
  });
});

// 15 — manual analytics entry computes the BM/Like signal.
await shot("15-content-studio-analytics", async () => {
  await win.getByLabel("Analytics slug").fill("smoke-post");
  await win.getByLabel("Views").fill("1000");
  await win.getByLabel("Bookmarks").fill("45");
  await win.getByLabel("Likes").fill("30");
  await win.getByLabel("Comments").fill("6");
  await win.getByRole("button", { name: "Log analytics" }).click();
  await win.getByText("BM/Like 1.50").waitFor({ timeout: 8000 });
  await win.getByText("Bookmark rate 4.50%").waitFor({ timeout: 8000 });
});

// 16 — claim-level approval is blocked until evidence is attached.
await shot("16-content-studio-evidence-block", async () => {
  await win
    .getByLabel("Final draft")
    .fill("This workflow always saves 30 minutes.");
  await win.getByRole("button", { name: "Approve final draft" }).click();
  await win.getByText(/Support claims/).waitFor({ timeout: 8000 });
});

// 17 — attaching evidence allows a manual publish packet to be prepared.
await shot("17-content-studio-evidence-approve", async () => {
  await win.getByLabel("Evidence source URL").fill("https://example.com/smoke");
  await win
    .getByLabel("Evidence snippet")
    .fill("The source documents a 30 minute workflow saving.");
  await win.getByRole("button", { name: "Attach evidence" }).click();
  await win.getByText(/Evidence attached/).waitFor({ timeout: 8000 });
  await win.getByRole("button", { name: "Approve final draft" }).click();
  await win.getByText(/Draft approved/).waitFor({ timeout: 8000 });
});

// 18 — publishing remains manual, but the packet can be marked published.
await shot("18-content-studio-publish", async () => {
  await win
    .getByLabel("Manual publish URL")
    .fill("https://x.com/example/status/1");
  await win.getByRole("button", { name: "Mark published" }).click();
  await win
    .getByText(/Publish packet marked published/)
    .waitFor({ timeout: 8000 });
});

// 19 — Capture surfaces the seeded recent screenshot candidate from the isolated
// smoke directory, not from the developer's real screenshot folders.
await shot("19-sources-screenshot", async () => {
  await openCommand("Open RSS Reader");
  await win.getByText("SPS RSS Intel Reader").waitFor({ timeout: 8000 });
  await win.getByRole("main").getByRole("button", { name: "Capture" }).click();
  await win.getByRole("tab", { name: "Screenshot" }).click();
  await win.getByText(SEEDED_SCREENSHOT_NAME).waitFor({ timeout: 8000 });
});

// 20 — importing the recent screenshot writes the asset and the raw Inbox source
// capture, including the user's note.
await shot("20-sources-screenshot-import", async () => {
  await win.getByLabel("Screenshot note").fill(SEEDED_SCREENSHOT_NOTE);
  await win.getByRole("button", { name: "Import to Inbox" }).click();
  await win.getByText("Imported to Inbox.").waitFor({ timeout: 8000 });
  await win.getByText(/Saved as Inbox capture/).waitFor({ timeout: 8000 });
  assertScreenshotCapturePersisted();
});

// 21 — the imported screenshot opens Deck Studio with a generated source brief
// and the no-OCR-yet handoff, without calling live OCR or network services.
await shot("21-sources-screenshot-deck", async () => {
  await win
    .locator(".source-intake-preview", { hasText: "Saved as Inbox capture" })
    .getByRole("button", { name: "Deck" })
    .click();
  await win.getByRole("heading", { name: "Deck Studio" }).waitFor({
    timeout: 8000,
  });
  const roughNotes = await waitForInputValue(
    win.getByLabel("Rough notes"),
    (value) =>
      value.includes("Screenshot Inbox capture") &&
      value.includes(SEEDED_SCREENSHOT_NAME) &&
      value.includes("OCR has not been run yet"),
    "Deck Studio screenshot brief",
  );
  if (!roughNotes.includes("Stored asset:")) {
    throw new Error("Deck Studio screenshot brief is missing the stored asset");
  }
  await waitForInputValue(
    win.getByLabel("Goal"),
    (value) => value.includes("turn this screenshot capture into a deck brief"),
    "Deck Studio screenshot goal",
  );
});

// 22 — Deck Studio turns rough notes into an approved editable slide preview.
await shot("22-deck-studio", async () => {
  await openCommand("Open Deck Studio");
  await win.getByRole("heading", { name: "Deck Studio" }).waitFor({
    timeout: 8000,
  });
  await win
    .getByLabel("Rough notes")
    .fill(
      "Wallet Club\nSubscription fatigue\nScattered budgeting\nSmart auto-budgeting",
    );
  await win.getByRole("button", { name: "Generate outline" }).click();
  await win.getByText("The Problem").waitFor({ timeout: 8000 });
  await win.getByRole("button", { name: "Approve outline" }).click();
  await win.locator('[data-testid="deck-canvas"]').waitFor({ timeout: 8000 });
  await win.getByLabel("Theme").selectOption("research");
  await win
    .locator('[data-testid="deck-canvas"][data-theme="research"]')
    .waitFor({ timeout: 8000 });
});

// 23 — Deck Studio export writes PDF/PPTX outputs plus notes sidecar.
await shot("23-deck-studio-export", async () => {
  await win.getByRole("button", { name: "export" }).click();
  await win.getByRole("button", { name: "Export PDF" }).click();
  await win.getByText(/PDF exported:/).waitFor({ timeout: 15000 });
  await win.getByRole("button", { name: "Export PPTX" }).click();
  await win.getByText(/PPTX exported:/).waitFor({ timeout: 15000 });
  await win.getByText(/Notes sidecar:/).waitFor({ timeout: 8000 });
});

// 24 — the real task hotkey path opens the separate Quick Capture BrowserWindow
// in Task mode, then persists through renderer → preload IPC → main task routing.
try {
  await win.evaluate((url) => {
    return window.hermesAPI.setConnectionConfig("remote", url, "");
  }, fakeGateway.url);
  const captureWindowPromise = app.waitForEvent("window", { timeout: 8000 });
  await app.evaluate(() => {
    const hook = globalThis.__HERMES_SMOKE_TRIGGER_TASK_CAPTURE__;
    if (typeof hook !== "function") {
      throw new Error("quick-capture smoke hook is unavailable");
    }
    hook();
  });
  const captureWin = await captureWindowPromise;
  await captureWin.waitForLoadState("domcontentloaded");
  await captureWin.waitForSelector(".qc-panel", { timeout: 8000 });
  if (!captureWin.url().includes("window=capture")) {
    throw new Error(`unexpected quick-capture window URL: ${captureWin.url()}`);
  }
  const kind = await captureWin.getByLabel("Capture type").inputValue();
  if (kind !== "task") {
    throw new Error(`quick-capture kind mismatch: ${kind}`);
  }
  await captureWin.getByRole("textbox").fill(QUICK_CAPTURE_TASK_TEXT);
  await captureWin.waitForTimeout(300);
  await captureWin.screenshot({
    path: join(OUT, "24-quick-capture-task.png"),
  });
  await captureWin.getByRole("button", { name: "Save Task" }).click();
  try {
    await captureWin.getByText(/On your list/).waitFor({ timeout: 10000 });
  } catch (err) {
    if (!captureWin.isClosed()) throw err;
  }
  assertQuickCaptureTaskPersisted();
  shots.push("24-quick-capture-task");
  console.log("SHOT ok:", "24-quick-capture-task");
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  shotFailures.push({ name: "24-quick-capture-task", message });
  console.log("SHOT FAIL:", "24-quick-capture-task", "-", message);
}

console.log("SHOTS_OK:", shots.length, "—", shots.join(", "));
await app.close();
await fakeGateway.close();
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
