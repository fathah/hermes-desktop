// digest-dogfood.mjs — end-to-end dogfood of the weekly External-Sessions Digest.
//
// Seeds a THROWAWAY HERMES_HOME + a fake Claude Code source, and points the app
// at a LOCAL STUB GATEWAY (remote mode) so the only mocked piece is the external
// LLM — every line of the digest feature (backfill → +Weekly digest → Run now →
// runDigest → listConversationsSince → assemble → mergeBriefAndQueue → pending →
// Apply → page) runs for real. Never touches the real ~/.hermes.
//
// Modes (env): GATEWAY_MODE=ok|fail (stub 200 changeset vs 500);
//              SESSION_AGE_DAYS=N (how old the seeded session is; >7 ⇒ out of the
//              weekly window ⇒ "no sessions this period").
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import http from "http";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "digest-dogfood");
mkdirSync(OUT, { recursive: true });
const MODE = process.env.GATEWAY_MODE || "ok";
const AGE_DAYS = Number(process.env.SESSION_AGE_DAYS || "0");

// ── stub gateway ────────────────────────────────────────────────────────────
let gatewayHits = 0;
const CHANGESET = JSON.stringify({
  summary: "Weekly digest — 1 external session",
  pages: [
    {
      op: "create",
      pageId: "external-sessions-digest",
      title: "External Sessions Digest",
      markdown:
        "# External Sessions Digest\n\n## Highlights\n- Designed the widget pipeline in Claude Code (worker-pool batching)\n\n## Decisions\n- Batch widgets and reduce in a worker pool\n\n## Sources\n- Claude Code · project: proj\n\n## Updates\n- 2026-06-10: initial digest",
    },
  ],
  captures: [],
  memory: [],
});

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  // POST /v1/chat/completions
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    gatewayHits += 1;
    if (MODE === "fail") {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("stub gateway: simulated 5xx");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: CHANGESET } }],
      }),
    );
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const GATEWAY_URL = `http://127.0.0.1:${PORT}`;

// ── throwaway HERMES_HOME ───────────────────────────────────────────────────
const HOME = mkdtempSync(join(tmpdir(), "hermes-digest-dogfood-"));
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);
// Remote mode → the app's gateway calls hit our stub. onboardingCompleted skips
// the welcome so ⌘K / the sidebar work.
writeFileSync(
  join(HOME, "desktop.json"),
  JSON.stringify({
    onboardingCompleted: true,
    connectionMode: "remote",
    remoteUrl: GATEWAY_URL,
  }),
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

// ── seeded Claude Code source (one session, timestamped AGE_DAYS ago) ─────────
const ecClaude = join(HOME, "ec-claude");
const ecEmpty = (n) => {
  const p = join(HOME, n);
  mkdirSync(p, { recursive: true });
  return p;
};
const proj = join(ecClaude, "-Users-test-proj");
mkdirSync(proj, { recursive: true });
const ts = new Date(Date.now() - AGE_DAYS * 86_400_000).toISOString();
const sid = "dddddddd-eeee-ffff-0000-111111111111";
writeFileSync(
  join(proj, `${sid}.jsonl`),
  [
    JSON.stringify({
      type: "user",
      cwd: "/Users/test/proj",
      gitBranch: "main",
      sessionId: sid,
      timestamp: ts,
      message: { role: "user", content: "design the widget pipeline" },
    }),
    JSON.stringify({
      type: "assistant",
      cwd: "/Users/test/proj",
      gitBranch: "main",
      sessionId: sid,
      timestamp: ts,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Batch the widgets in a worker pool." },
        ],
      },
    }),
  ].join("\n") + "\n",
);

console.log(`MODE=${MODE} AGE_DAYS=${AGE_DAYS} GATEWAY=${GATEWAY_URL}`);
console.log("HERMES_HOME=", HOME, "SMOKE_OUT=", OUT);

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 120000).unref();

const shots = [];
const notes = [];
const app = await electron.launch({
  args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    HERMES_EC_CLAUDE_ROOT: ecClaude,
    HERMES_EC_CODEX_ROOT: ecEmpty("ec-codex"),
    HERMES_EC_GEMINI_ROOT: ecEmpty("ec-gemini"),
    HERMES_EC_GROK_ROOT: ecEmpty("ec-grok"),
  },
});
const win = await app.firstWindow();
win.on("console", (m) => {
  if (m.type() === "error")
    notes.push(`console.error: ${m.text().slice(0, 160)}`);
});
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(1800);

async function shot(name, fn) {
  try {
    if (fn) await fn();
    await win.waitForTimeout(700);
    await win.screenshot({ path: join(OUT, `${name}.png`) });
    shots.push(name);
    console.log("SHOT ok:", name);
  } catch (e) {
    console.log("SHOT FAIL:", name, "—", e.message);
    notes.push(`SHOT FAIL ${name}: ${e.message}`);
  }
}

// 1 — open External sessions, enable Claude Code (real backfill).
await shot("01-enable-source", async () => {
  await win.locator(".nav-item", { hasText: "Search" }).first().click();
  await win.waitForTimeout(500);
  await win.keyboard.type("external sessions");
  await win.waitForTimeout(500);
  await win.keyboard.press("Enter");
  await win.waitForSelector(".modal", { timeout: 8000 });
  // Ensure we're on the Sources view (the modal opens on search then flips to
  // settings async — click the chip so we don't race that flip), then wait for
  // the Claude Code row to render before toggling it on.
  await win
    .locator(".modal .pal-chip", { hasText: "Sources" })
    .first()
    .click({ timeout: 8000 });
  await win.waitForFunction(
    () =>
      [...document.querySelectorAll(".lst-row")].some((r) =>
        /Claude Code/.test(r.textContent || ""),
      ),
    { timeout: 8000 },
  );
  await win.evaluate(() => {
    const row = [...document.querySelectorAll(".lst-row")].find((r) =>
      /Claude Code/.test(r.textContent || ""),
    );
    row
      ?.querySelector("button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // Wait until the backfill has actually indexed the seeded session (the Claude
  // Code row shows a non-zero session count) so the digest isn't run on an empty
  // index. For the empty-period case (AGE_DAYS>7) the session is still indexed —
  // it's only excluded by the digest's weekly WINDOW, so this wait still holds.
  await win
    .waitForFunction(
      () => {
        const row = [...document.querySelectorAll(".lst-row")].find((r) =>
          /Claude Code/.test(r.textContent || ""),
        );
        return /[1-9]\d* session/.test(row?.textContent || "");
      },
      { timeout: 8000 },
    )
    .catch(() => {});
  await win.waitForTimeout(500);
});

// 2 — "+ Digest" (default weekly / all tools) → creates the schedule + opens Scheduled.
await shot("02-scheduled-modal", async () => {
  await win
    .locator(".modal .cover-btn", { hasText: "+ Digest" })
    .first()
    .click({ timeout: 8000 });
  await win.waitForTimeout(1200);
  // The Scheduled modal should now show a Digest schedule row.
  await win.waitForSelector(".modal", { timeout: 8000 });
});

// 3 — Run now on the digest schedule → gateway (stub) → pending (or no-change).
await shot("03-run-now", async () => {
  await win.evaluate(() => {
    const rows = [...document.querySelectorAll(".lst-row")];
    const digestRow = rows.find((r) =>
      /Digest|External sessions/.test(r.textContent || ""),
    );
    const runBtn = [...(digestRow?.querySelectorAll("button") || [])].find(
      (b) => /Run now/.test(b.textContent || ""),
    );
    runBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // Capture the transient run-outcome toast (poll briefly).
  let toast = "";
  for (let i = 0; i < 30; i++) {
    toast = await win
      .evaluate(() => {
        const el = document.querySelector(".toast, [class*='toast']");
        return (el && el.textContent) || "";
      })
      .catch(() => "");
    if (toast) break;
    await win.waitForTimeout(100);
  }
  console.log("RUN_TOAST:", JSON.stringify(toast));
  await win.waitForTimeout(1800);
});

// 4 — Apply the pending update (happy path) → page created.
await shot("04-after-run", async () => {
  await win.evaluate(() => {
    const applyBtn = [...document.querySelectorAll(".modal button")].find((b) =>
      /^Apply$/.test((b.textContent || "").trim()),
    );
    applyBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await win.waitForTimeout(1500);
});

// Capture the rendered digest page text (if applied).
const pageText = await win
  .evaluate(() => document.body.innerText)
  .catch(() => "");
const hasDigestHeading = /External Sessions Digest/i.test(pageText);
const hasHighlights = /Highlights/i.test(pageText);

console.log("RESULT gatewayHits=", gatewayHits);
console.log(
  "RESULT hasDigestHeading=",
  hasDigestHeading,
  "hasHighlights=",
  hasHighlights,
);
console.log("NOTES:", JSON.stringify(notes));
console.log("SHOTS_OK:", shots.length, "—", shots.join(", "));
await app.close();
server.close();
console.log("DOGFOOD_DONE");
