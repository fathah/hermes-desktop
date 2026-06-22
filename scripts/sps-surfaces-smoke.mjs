// Offline smoke for SPS surfaces that were still only manually tracked in the
// feature-status workbook: dashboard, trash, My Work, task drawer, automations,
// Insights, and Personal Health.
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

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "sps-surfaces-smoke");
mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(OUT)) {
  if (name.endsWith(".png")) unlinkSync(join(OUT, name));
}

const HOME = mkdtempSync(join(tmpdir(), "hermes-surfaces-"));
const sps = join(HOME, "sps-agent");
const vault = join(sps, "vault");
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
mkdirSync(join(vault, "projects"), { recursive: true });

const pythonShim = join(HOME, "hermes-agent", "venv", "bin", "python");
writeFileSync(
  pythonShim,
  `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let id = 0;
  try { id = JSON.parse(line).id || 0; } catch {}
  console.log(JSON.stringify({ id, result: { ok: true, results: [], nodes: [], edges: [] } }));
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
    trashed: { icon: "🗑️", title: "Smoke deleted page", cover: null },
    trashed_delete: { icon: "🗑️", title: "Smoke purge page", cover: null },
  },
  docs: {
    home: [
      { id: "h1", type: "h1", text: "Home" },
      { id: "p1", type: "p", text: "Dashboard smoke workspace." },
      {
        id: "home_tasks",
        type: "database",
        text: "",
        source: "projects",
        view: "table",
        rows: [
          {
            id: "home_task_1",
            title: "Seed task",
            status: "todo",
            prio: "med",
            who: "you",
            due: "",
            est: "",
          },
        ],
      },
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
    trashed: [{ id: "th", type: "p", text: "Restore me from trash." }],
    trashed_delete: [{ id: "tdh", type: "p", text: "Delete me forever." }],
  },
  comments: [
    {
      id: "cmt_home_1",
      quote: "Dashboard smoke workspace.",
      blockId: "p1",
      page: "home",
      resolved: false,
      messages: [
        {
          name: "You",
          initials: "Y",
          color: "#2563EB",
          time: "just now",
          text: "Seeded panel note.",
        },
      ],
    },
  ],
  trash: [
    {
      id: "trashed",
      title: "Smoke deleted page",
      icon: "🗑️",
      ids: ["trashed"],
    },
    {
      id: "trashed_delete",
      title: "Smoke purge page",
      icon: "🗑️",
      ids: ["trashed_delete"],
    },
  ],
  page: "home",
};

writeFileSync(join(sps, "workspace.json"), JSON.stringify(workspace, null, 2));
writeFileSync(
  join(vault, "home.md"),
  `---\ntitle: "Home"\nicon: "🏠"\n---\n\n# Home\n\nDashboard smoke workspace.\n\n[[Alpha]]\n`,
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
  `---\ntitle: "First project"\nstatus: "todo"\nprio: "med"\nwho: "you"\n---\n\nSeed row.\n`,
);
writeFileSync(
  join(vault, "trashed.md"),
  `---\ntitle: "Smoke deleted page"\n---\n\nRestore me from trash.\n`,
);
writeFileSync(
  join(vault, "trashed_delete.md"),
  `---\ntitle: "Smoke purge page"\n---\n\nDelete me forever.\n`,
);

console.log("HERMES_HOME=", HOME);
console.log("SMOKE_OUT=", OUT);

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 120000).unref();

const expectedShots = [
  "01-dashboard",
  "02-dashboard-scratchpad",
  "03-dashboard-task-drawer",
  "04-docs-page-menu",
  "04b-doc-right-panel",
  "04c-doc-editor-persistence",
  "05-trash-restore",
  "06-my-work",
  "07-automations",
  "08-insights",
  "09-journal-entry",
  "09-health-journal",
  "10-health-peptide",
  "11-health-vault",
  "12-health-digest",
];
const shots = [];
const failures = [];
const healthBrowserErrors = [];
const healthErrorPattern =
  /Database not available|messages_metadata|no such table|\[Health UI\] Load error/i;

function recordHealthBrowserError(kind, text) {
  if (healthErrorPattern.test(text)) {
    healthBrowserErrors.push(`${kind}: ${text}`);
  }
}

const { _electron: electron } = await import("playwright");
const app = await electron.launch({
  args: [`--user-data-dir=${join(HOME, "electron-userdata")}`, "."],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});
const win = await app.firstWindow();
win.on("console", (msg) => {
  if (msg.type() === "error") {
    const text = msg.text();
    console.log("BROWSER_CONSOLE_ERROR:", text);
    recordHealthBrowserError("console", text);
  }
});
win.on("pageerror", (error) => {
  console.log("BROWSER_PAGE_ERROR:", error.message);
  recordHealthBrowserError("pageerror", error.message);
});
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(1800);

async function shot(name, fn) {
  try {
    if (fn) await fn();
    await win.waitForTimeout(500);
    await win.screenshot({ path: join(OUT, `${name}.png`) });
    shots.push(name);
    console.log("SHOT ok:", name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name, message });
    console.log("SHOT FAIL:", name, "-", message);
    await win
      .screenshot({ path: join(OUT, `${name}-failure.png`) })
      .catch(() => {});
    await closeOverlays();
  }
}

async function clickNav(label) {
  await win.locator(".nav-item", { hasText: label }).first().click();
}

async function expectVisible(text, timeout = 8000) {
  await win.getByText(text, { exact: false }).first().waitFor({ timeout });
}

async function getHealthCollections() {
  return win.evaluate(async () => {
    const api = window.hermesAPI;
    if (!api) throw new Error("hermesAPI unavailable");
    const [journalEntries, protocols, medicalDocs, clinicalDigest] =
      await Promise.all([
        api.spsHealthGetJournalEntries(),
        api.spsHealthGetMedicationProtocols(),
        api.spsHealthGetMedicalDocs(),
        api.spsRssGetClinicalDigest(),
      ]);
    return { journalEntries, protocols, medicalDocs, clinicalDigest };
  });
}

async function seedOfflineClinicalDigest() {
  return win.evaluate(async () => {
    const api = window.hermesAPI;
    if (!api) throw new Error("hermesAPI unavailable");
    const feedId = await api.spsRssAddFeed({
      url: "mock://health-smoke-feed",
      title: "Health Smoke Feed",
      site_url: "mock://health-smoke-feed",
      description: "Offline clinical digest smoke feed",
      category: "Clinical",
    });
    const sync = await api.spsRssSyncFeeds();
    const digest = await api.spsRssGetClinicalDigest();
    return {
      feedId,
      sync,
      digestCount: digest.length,
      titles: digest.map((article) => article.title),
    };
  });
}

async function closeDrawerIfOpen() {
  const drawer = win.locator(".drawer");
  if ((await drawer.count()) === 0) return;
  await win
    .locator(".drawer-head .tb-btn")
    .first()
    .click({ force: true })
    .catch(() => {});
  await drawer.waitFor({ state: "hidden", timeout: 1500 }).catch(async () => {
    await win
      .locator(".scrim")
      .first()
      .click({ position: { x: 4, y: 4 }, force: true })
      .catch(() => {});
  });
  await drawer.waitFor({ state: "hidden", timeout: 1500 }).catch(async () => {
    await win.keyboard.press("Escape").catch(() => {});
  });
  await drawer.waitFor({ state: "hidden", timeout: 3000 });
}

async function closeModalIfOpen() {
  const modal = win.locator(".modal");
  if ((await modal.count()) === 0) return;
  await win.keyboard.press("Escape").catch(() => {});
  await modal.waitFor({ state: "hidden", timeout: 1500 }).catch(async () => {
    await win
      .locator(".scrim")
      .first()
      .click({ position: { x: 4, y: 4 }, force: true })
      .catch(() => {});
  });
  await modal.waitFor({ state: "hidden", timeout: 3000 });
}

async function closePaletteIfOpen() {
  const palette = win.locator(".palette");
  if ((await palette.count()) === 0) return;
  await win.keyboard.press("Escape").catch(() => {});
  await palette.waitFor({ state: "hidden", timeout: 1500 }).catch(async () => {
    await win
      .locator(".scrim")
      .first()
      .click({ position: { x: 4, y: 4 }, force: true })
      .catch(() => {});
  });
  await palette.waitFor({ state: "hidden", timeout: 3000 });
}

async function closeOverlays() {
  await closePaletteIfOpen().catch(() => {});
  await closeDrawerIfOpen().catch(() => {});
  await closeModalIfOpen().catch(() => {});
}

async function clickPanelTab(label) {
  await win.evaluate((tabLabel) => {
    const tab = [...document.querySelectorAll(".rp-tab")].find((node) =>
      (node.textContent || "").includes(tabLabel),
    );
    tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, label);
}

await shot("01-dashboard", async () => {
  await clickNav("Home Dashboard");
  await expectVisible("Scratch Pad");
  await expectVisible("Pinned Notes");
  await expectVisible("Today's Schedule");
});

await shot("02-dashboard-scratchpad", async () => {
  await win.locator(".postit-card").click();
  await win
    .locator(".scratchpad-modal-textarea")
    .fill("Smoke dashboard scratchpad note.");
  await win.getByRole("button", { name: "Done" }).click();
  await expectVisible("Smoke dashboard scratchpad note.");
});

await shot("03-dashboard-task-drawer", async () => {
  await win
    .locator(".dashboard-quick-actions")
    .getByRole("button", { name: "Task" })
    .click();
  await win.locator(".drawer-title-input").waitFor({ timeout: 8000 });
  await win.locator(".drawer-title-input").fill("Smoke dashboard task");
  await win.locator(".drawer-title-input").blur();
  await win.getByLabel("Status").selectOption("doing");
  await win.getByLabel("Description").fill("Task drawer smoke description.");
  await win.getByLabel("Description").blur();
  await win.getByRole("button", { name: /Add item/ }).click();
  await win
    .locator(".drawer-checklist-input")
    .last()
    .waitFor({ timeout: 8000 });
  const subtaskText = await win
    .locator(".drawer-checklist-input")
    .last()
    .inputValue();
  if (subtaskText !== "New subtask") {
    throw new Error(
      `Expected checklist input value "New subtask", got "${subtaskText}"`,
    );
  }
  await closeDrawerIfOpen();
});

await closeDrawerIfOpen();

await shot("04-docs-page-menu", async () => {
  await win.getByText("Home", { exact: true }).first().click();
  await win.locator(".topbar .tb-btn").first().click();
  await win.getByText("Add sub-page", { exact: true }).click();
  await expectVisible("Untitled");
  await win.locator(".doc-title").fill("Smoke child page");
  await win.locator(".doc-title").blur();
  await expectVisible("Smoke child page");
  await win.locator(".topbar .tb-btn").first().click();
  await win.getByText("Move to trash", { exact: true }).click();
  await expectVisible("Moved to trash");
  await win.locator(".nav-item", { hasText: "Trash" }).first().click();
  await expectVisible("Smoke child page");
  await win
    .locator(".lst-row", { hasText: "Smoke child page" })
    .getByRole("button", { name: "Restore" })
    .click();
  await expectVisible("Restored to workspace");
  await win.keyboard.press("Escape").catch(() => {});
  await expectVisible("Smoke child page");
});

await shot("04b-doc-right-panel", async () => {
  await win.getByText("Home", { exact: true }).first().click({ force: true });
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent("sps:search"));
  });
  await win.getByPlaceholder("Search or open in new tab…").fill("outline");
  await win.locator(".pal-item", { hasText: "Show outline" }).first().click();
  await win.locator(".outline-item", { hasText: "Home" }).waitFor({
    timeout: 8000,
  });

  await clickPanelTab("Notes");
  await expectVisible("Seeded panel note.");
  await win.getByPlaceholder("Add a note…").fill("Panel smoke reply");
  await win.keyboard.press("Enter");
  await expectVisible("Panel smoke reply");
  await win.getByRole("button", { name: "Archive" }).click();
  await win.getByRole("button", { name: "Restore" }).click();

  await win.getByText("Alpha", { exact: true }).first().click({ force: true });
  await clickPanelTab("Backlinks");
  await expectVisible("Pages that reference this note.");
  await expectVisible("No explicit backlinks found");
  await expectVisible("No unlinked mentions found");

  await clickPanelTab("Info");
  await expectVisible("Linked references");
  await expectVisible("Words");
  await expectVisible("No pages link here yet");
});

await shot("04c-doc-editor-persistence", async () => {
  await win.getByText("Alpha", { exact: true }).first().click({ force: true });
  await win.locator(".doc-title").waitFor({ timeout: 8000 });
  await win.locator(".doc-title").fill("Alpha Smoke Edited");
  await win
    .locator(".block")
    .filter({ hasText: "A linked page." })
    .fill("Alpha smoke persisted body.");
  await win.getByText("Home", { exact: true }).first().click({ force: true });
  await win
    .getByText("Alpha Smoke Edited", { exact: true })
    .first()
    .click({ force: true });
  await expectVisible("Alpha smoke persisted body.");
});

await shot("05-trash-restore", async () => {
  await win.locator(".nav-item", { hasText: "Trash" }).first().click();
  await expectVisible("Smoke deleted page");
  await expectVisible("Smoke purge page");
  await win
    .locator(".lst-row", { hasText: "Smoke deleted page" })
    .getByRole("button", { name: "Restore" })
    .click();
  await expectVisible("Restored to workspace");
  win.once("dialog", (dialog) => dialog.accept());
  await win
    .locator(".lst-row", { hasText: "Smoke purge page" })
    .getByRole("button", { name: "Delete forever" })
    .click();
  await expectVisible("Permanently deleted");
  await expectVisible("Trash is empty");
  await win.keyboard.press("Escape").catch(() => {});
  await expectVisible("Smoke deleted page");
});

await shot("06-my-work", async () => {
  await clickNav("My Work");
  await expectVisible("At a Glance");
  await expectVisible("Quick Actions");
  await expectVisible("Assistant Status");
  await win
    .getByRole("button", { name: /New entry/ })
    .first()
    .click();
  await expectVisible("Untitled entry");
});

await shot("07-automations", async () => {
  await win.locator(".nav-item", { hasText: "Automations" }).first().click();
  await win.locator(".modal").waitFor({ timeout: 8000 });
  await expectVisible("Schedules");
  await win
    .getByPlaceholder("Research this topic on a schedule…")
    .fill("Smoke automation topic");
  await win
    .locator(".modal")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expectVisible("Smoke automation topic", 20000);
  await win.getByRole("button", { name: "Delete" }).first().click();
  await expectVisible("No schedules yet");
  await closeModalIfOpen();
});

await shot("08-insights", async () => {
  await clickNav("Insights");
  await expectVisible("Token usage and cost");
  await expectVisible("No usage recorded yet");
});

await shot("09-journal-entry", async () => {
  await clickNav("Journal");
  await expectVisible("New entry");
  await win
    .getByRole("button", { name: /New entry/ })
    .first()
    .click();
  await expectVisible("Journal entry created");
  await win.locator(".doc-title").fill("Smoke journal entry");
  await win.locator(".block.empty").first().fill("Smoke journal body.");
  await clickNav("Journal");
  await expectVisible("Smoke journal entry");
  const entry = win.locator(".jr-entry", { hasText: "Smoke journal entry" });
  await entry.getByTitle("Set mood").click();
  await win.locator(".jr-mood-pop").getByRole("button", { name: "🙂" }).click();
  await entry.locator(".jr-entry-body").click();
  await expectVisible("Good");
  await expectVisible("Smoke journal body.");
});

await shot("09-health-journal", async () => {
  await clickNav("Health & Ledger");
  await expectVisible("My Health & Ledger");
  await win.getByLabel("Weight (kg)").fill("78.4");
  await win.getByLabel("Fasting Glucose (mg/dL)").fill("92");
  await win.locator("#quick-bp").fill("120/80");
  await win.getByRole("button", { name: "Save Metrics" }).click();
  await win
    .getByPlaceholder(/How do you feel today/)
    .fill("Smoke health journal entry.");
  await win.getByRole("button", { name: "Save Entry" }).click();
  await expectVisible("Smoke health journal entry.");
  let health = await getHealthCollections();
  if (
    !health.journalEntries.some(
      (entry) => entry.text_raw === "Smoke health journal entry.",
    )
  ) {
    throw new Error("Saved health journal entry missing from IPC readback");
  }
  await win
    .locator(".timeline-card", { hasText: "Smoke health journal entry." })
    .getByRole("button", { name: "Delete Entry" })
    .click();
  await win
    .getByText("Smoke health journal entry.", { exact: true })
    .waitFor({ state: "hidden", timeout: 10000 });
  health = await getHealthCollections();
  if (
    health.journalEntries.some(
      (entry) => entry.text_raw === "Smoke health journal entry.",
    )
  ) {
    throw new Error(
      "Deleted health journal entry still present in IPC readback",
    );
  }
  console.log("HEALTH_DELETE_OK: journal entry");
});

await shot("10-health-peptide", async () => {
  await win.getByRole("button", { name: /Peptide Ledger/ }).click();
  await expectVisible("Peptide Reconstitution Calculator");
  await expectVisible("Required Syringe Plunger Position");
  await win.locator("#new-protocol-name").fill("Smoke peptide protocol");
  await win.locator(".create-protocol-row .log-submit-btn").click();
  await expectVisible("Smoke peptide protocol", 15000);
  let health = await getHealthCollections();
  if (
    !health.protocols.some(
      (protocol) => protocol.name === "Smoke peptide protocol",
    )
  ) {
    throw new Error("Saved peptide protocol missing from IPC readback");
  }
  await win
    .locator(".protocol-card", { hasText: "Smoke peptide protocol" })
    .getByRole("button", { name: "Delete Protocol" })
    .click();
  await win
    .getByText("Smoke peptide protocol", { exact: true })
    .waitFor({ state: "hidden", timeout: 10000 });
  health = await getHealthCollections();
  if (
    health.protocols.some(
      (protocol) => protocol.name === "Smoke peptide protocol",
    )
  ) {
    throw new Error("Deleted peptide protocol still present in IPC readback");
  }
  console.log("HEALTH_DELETE_OK: medication protocol");
});

await shot("11-health-vault", async () => {
  await win.getByRole("button", { name: /Medical Vault/ }).click();
  await expectVisible("Medical Vault");
  await win.locator(".scan-pdf-btn").click();
  await expectVisible("LabCorp_BloodPanel_2026.pdf", 20000);
  let health = await getHealthCollections();
  if (
    !health.medicalDocs.some(
      (doc) => doc.file_name === "LabCorp_BloodPanel_2026.pdf",
    )
  ) {
    throw new Error("Saved medical document missing from IPC readback");
  }
  await win
    .locator(".doc-card-item", { hasText: "LabCorp_BloodPanel_2026.pdf" })
    .getByRole("button", { name: "Delete Document" })
    .click();
  await win
    .getByText("LabCorp_BloodPanel_2026.pdf", { exact: true })
    .waitFor({ state: "hidden", timeout: 10000 });
  health = await getHealthCollections();
  if (
    health.medicalDocs.some(
      (doc) => doc.file_name === "LabCorp_BloodPanel_2026.pdf",
    )
  ) {
    throw new Error("Deleted medical document still present in IPC readback");
  }
  console.log("HEALTH_DELETE_OK: medical document");
});

await shot("12-health-digest", async () => {
  const digestSeed = await seedOfflineClinicalDigest();
  if (!digestSeed.sync.success || digestSeed.sync.count < 2) {
    throw new Error(
      `Expected offline digest sync to insert at least 2 articles, got ${JSON.stringify(
        digestSeed.sync,
      )}`,
    );
  }
  if (digestSeed.digestCount < 2) {
    throw new Error(
      `Expected clinical digest readback to return at least 2 articles, got ${digestSeed.digestCount}`,
    );
  }
  await win.getByRole("button", { name: /Refresh/ }).click();
  await win.getByRole("button", { name: /Clinical Digest/ }).click();
  await expectVisible("Dosing and Titration Schedules", 10000);
  await expectVisible("HRV and Sleep Latency", 10000);
  const health = await getHealthCollections();
  if (health.clinicalDigest.length < 2) {
    throw new Error("Clinical digest UI refresh did not preserve IPC readback");
  }
  console.log(
    `HEALTH_DIGEST_OK: ${health.clinicalDigest.length} offline clinical articles`,
  );
});

await app.close();

console.log("SHOTS_OK:", shots.length, "—", shots.join(", "));
const missing = expectedShots.filter((name) => !shots.includes(name));
if (failures.length || missing.length || healthBrowserErrors.length) {
  for (const failure of failures) {
    console.log(`SHOT_FAILURE: ${failure.name}: ${failure.message}`);
  }
  if (missing.length) console.log("SHOTS_MISSING:", missing.join(", "));
  for (const error of healthBrowserErrors) {
    console.log(`HEALTH_BROWSER_ERROR: ${error}`);
  }
  console.log("SURFACES_SMOKE_FAILED");
  process.exit(1);
}

const scratchPath = join(vault, "dashboard_scratchpad.md");
if (!existsSync(scratchPath)) {
  console.log("SCRATCHPAD_MISSING:", scratchPath);
  process.exit(1);
}
const scratchMarkdown = readFileSync(scratchPath, "utf8");
if (!scratchMarkdown.includes("Smoke dashboard scratchpad note.")) {
  console.log("SCRATCHPAD_TEXT_MISSING");
  process.exit(1);
}
if (existsSync(join(vault, "trashed_delete.md"))) {
  console.log("TRASH_PURGE_FILE_STILL_EXISTS");
  process.exit(1);
}
const alphaMarkdown = readFileSync(join(vault, "alpha.md"), "utf8");
if (
  !alphaMarkdown.includes('title: "Alpha Smoke Edited"') ||
  !alphaMarkdown.includes("Alpha smoke persisted body.")
) {
  console.log("DOC_EDITOR_MARKDOWN_MISSING");
  process.exit(1);
}
const journalMarkdowns = readdirSync(vault)
  .filter((name) => name.endsWith(".md"))
  .map((name) => readFileSync(join(vault, name), "utf8"));
const journalMarkdown = journalMarkdowns.find((markdown) =>
  markdown.includes('title: "Smoke journal entry"'),
);
if (
  !journalMarkdown ||
  !journalMarkdown.includes("journal: true") ||
  !journalMarkdown.includes("Smoke journal body.")
) {
  console.log("JOURNAL_MARKDOWN_MISSING");
  process.exit(1);
}

console.log("SURFACES_SMOKE_DONE");
