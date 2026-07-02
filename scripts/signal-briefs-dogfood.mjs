// signal-briefs-dogfood.mjs - deterministic Electron smoke for topic monitors.
//
// Launches the BUILT app against a throwaway HERMES_HOME and a local stub
// gateway. It proves the real renderer -> preload -> IPC -> main-process path:
// Telegram unavailable gating, Telegram configured enablement, monitor create,
// Run now, pending update, Apply, rendered page, and vault markdown.
//
// Usage: npm run build && npm run smoke:signal-briefs
import { _electron as electron } from "playwright";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import http from "http";

const TOPIC = "AI agent launches";
const PAGE_ID = "ai-agent-launches";
const OUT = process.env.SMOKE_OUT || join(tmpdir(), "signal-briefs-dogfood");
mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(OUT)) {
  if (name.endsWith(".png")) unlinkSync(join(OUT, name));
}

const shots = [];
const consoleErrors = [];
let activeApp = null;
let activeWin = null;
const gatewayHits = {
  jobCreate: 0,
  research: 0,
  merge: 0,
  telegram: 0,
};
const cronJobs = [];

const RESEARCH_BRIEF = `# AI Agent Launches

Acme announced a new public agent workspace with monitor-style launch tracking for teams.

## Sources
- [Acme AI Launch](https://example.com/agents-launch)
`;

const CHANGESET = JSON.stringify({
  summary: "Topic monitor updated - Acme launched an agent workspace",
  pages: [
    {
      op: "create",
      pageId: "ignored-by-main",
      title: "AI Agent Launches",
      markdown:
        "# AI Agent Launches\n\nAcme launched a public agent workspace for teams tracking AI agent releases.\n\n## Sources\n- [Acme AI Launch](https://example.com/agents-launch)\n\n## Updates\n- 2026-06-25: Acme launched an agent workspace.",
    },
  ],
  captures: [],
  memory: [],
});

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function chat(content) {
  return { choices: [{ message: { role: "assistant", content } }] };
}

function collectBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    json(res, 200, { jobs: cronJobs });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs") {
    const raw = await collectBody(req);
    const body = raw ? JSON.parse(raw) : {};
    gatewayHits.jobCreate += 1;
    const id = `job_${cronJobs.length + 1}`;
    cronJobs.push({
      id,
      name: body.name || `(job ${cronJobs.length + 1})`,
      schedule: { value: body.schedule || "0 8 * * 1" },
      prompt: body.prompt || "",
      state: "active",
      enabled: true,
      next_run_at: null,
      last_run_at: null,
      last_status: null,
      last_error: null,
      deliver: body.deliver || "local",
    });
    json(res, 200, { job_id: id });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const raw = await collectBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const prompt = (body.messages || [])
      .map((m) => m && m.content)
      .filter(Boolean)
      .join("\n");

    if (/Send exactly one Telegram message/i.test(prompt)) {
      gatewayHits.telegram += 1;
      json(res, 200, chat("TELEGRAM_SENT"));
      return;
    }

    if (/Output EXACTLY ONE JSON object/i.test(prompt)) {
      gatewayHits.merge += 1;
      json(res, 200, chat(CHANGESET));
      return;
    }

    if (/Research this topic thoroughly/i.test(prompt)) {
      gatewayHits.research += 1;
      json(res, 200, chat(RESEARCH_BRIEF));
      return;
    }

    json(res, 500, { error: `Unhandled stub prompt: ${prompt.slice(0, 120)}` });
    return;
  }

  json(res, 404, { error: `Unhandled ${req.method} ${url.pathname}` });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("stub gateway did not bind to a TCP port");
}
const GATEWAY_URL = `http://127.0.0.1:${address.port}`;

const HOME = mkdtempSync(join(tmpdir(), "hermes-signal-briefs-"));
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
    {
      onboardingCompleted: true,
      connectionMode: "remote",
      remoteUrl: GATEWAY_URL,
      schedulerEnabled: false,
    },
    null,
    2,
  ),
);

const sps = join(HOME, "sps-agent");
const vault = join(sps, "vault");
mkdirSync(vault, { recursive: true });
writeFileSync(
  join(sps, "workspace.json"),
  JSON.stringify(
    {
      tree: [{ id: "home", children: [] }],
      meta: { home: { icon: "home", title: "Home", cover: null } },
      docs: { home: [{ id: "h1", type: "h1", text: "Home" }] },
      comments: [],
      trash: [],
      page: "home",
    },
    null,
    2,
  ),
);
writeFileSync(join(vault, "home.md"), `---\ntitle: "Home"\n---\n\n# Home\n`);

console.log("HERMES_HOME=", HOME);
console.log("SMOKE_OUT=", OUT);
console.log("GATEWAY=", GATEWAY_URL);

const watchdog = setTimeout(() => {
  console.log("SIGNAL_BRIEFS_FAIL: WATCHDOG_TIMEOUT");
  process.exit(2);
}, 180000);
watchdog.unref();

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function waitFor(label, fn, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`${label} timed out${lastError ? `: ${lastError}` : ""}`);
}

async function shot(win, name) {
  await win.waitForTimeout(300);
  await win.screenshot({ path: join(OUT, `${name}.png`) });
  shots.push(name);
  console.log("SHOT ok:", name);
}

async function launch(label) {
  const app = await electron.launch({
    args: [".", `--user-data-dir=${join(HOME, `electron-userdata-${label}`)}`],
    env: {
      ...process.env,
      HERMES_HOME: HOME,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
  const win = await app.firstWindow();
  win.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (/spsLintVault error in DocHeader.*remote method/.test(text)) return;
      consoleErrors.push(`${label}: ${text.slice(0, 200)}`);
    }
  });
  await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector(".app", { timeout: 30000 });
  activeApp = app;
  activeWin = win;
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 1000);
  });
  await win.waitForTimeout(1200);
  return { app, win };
}

async function openSignalBriefs(win) {
  await win.locator(".nav-item", { hasText: "Work" }).first().click({
    timeout: 8000,
  });
  await win.getByRole("tab", { name: "Scheduled" }).click();
  await win.getByRole("button", { name: "Manage scheduled items" }).click();
  await win.waitForSelector(".modal", { timeout: 8000 });
  await win.getByText("Scheduled", { exact: true }).first().waitFor({
    timeout: 8000,
  });
}

function telegramCheckbox(win) {
  return win.locator('label:has-text("Telegram summary") input').first();
}

function readRegistry() {
  return JSON.parse(
    readFileSync(join(sps, "scheduled-research.json"), "utf-8"),
  );
}

async function waitForRegistrySchedule() {
  return waitFor(
    "scheduled-research registry",
    () => {
      if (!existsSync(join(sps, "scheduled-research.json"))) return null;
      const schedules = readRegistry().schedules || [];
      return schedules.find((schedule) => schedule.topic === TOPIC) || null;
    },
    10000,
  );
}

function assertRegistryShape(schedule) {
  assert(schedule.kind === "research", "monitor schedule kind is not research");
  assert(schedule.topic === TOPIC, "monitor topic did not persist");
  assert(schedule.pageId === PAGE_ID, "monitor pageId did not persist");
  assert(
    schedule.sourceIntent === "all",
    "monitor sourceIntent did not persist",
  );
  assert(
    schedule.importanceThreshold === "noteworthy",
    "monitor threshold did not persist",
  );
  assert(schedule.telegramPush === true, "Telegram push did not persist");
  assert(
    schedule.telegramMode === "summary-only",
    "Telegram summary-only mode did not persist",
  );
  assert(schedule.cronJobId, "paired cron job id did not persist");
}

try {
  // Phase 1: no channel_directory.json, so the Telegram push toggle is gated.
  let phase = await launch("missing-telegram");
  await openSignalBriefs(phase.win);
  await phase.win
    .getByText(
      "Telegram is not configured. Set it up before enabling push summaries.",
      { exact: false },
    )
    .waitFor({ timeout: 10000 });
  assert(
    await telegramCheckbox(phase.win).isDisabled(),
    "Telegram summary toggle was enabled without a configured channel",
  );
  assert(
    (await phase.win.getByRole("button", { name: "Set up Telegram" }).count()) >
      0,
    "Telegram setup button did not render",
  );
  await shot(phase.win, "01-telegram-gated");
  await phase.app.close();
  activeApp = null;
  activeWin = null;
  console.log("CHECK ok: Telegram unavailable gating");

  // Phase 2: configure Telegram, relaunch, create and run a real monitor.
  writeFileSync(
    join(HOME, "channel_directory.json"),
    JSON.stringify({ channels: [{ target: "telegram:123456" }] }, null, 2),
  );
  phase = await launch("telegram-configured");
  await openSignalBriefs(phase.win);
  await waitFor(
    "Telegram summary toggle enabled",
    () => telegramCheckbox(phase.win).isEnabled(),
    10000,
  );
  assert(
    await telegramCheckbox(phase.win).isEnabled(),
    "Telegram summary toggle was not enabled with a configured channel",
  );
  await telegramCheckbox(phase.win).check();
  await phase.win.getByPlaceholder(/Monitor this topic/i).fill(TOPIC);
  await phase.win.getByRole("button", { name: "Create" }).click();
  await phase.win
    .locator(".lst-row", { hasText: TOPIC })
    .first()
    .waitFor({ timeout: 15000 });
  await phase.win
    .locator(".lst-row", { hasText: TOPIC })
    .first()
    .getByText("Telegram summary", { exact: false })
    .waitFor({ timeout: 8000 });
  await shot(phase.win, "02-monitor-created");

  const schedule = await waitForRegistrySchedule();
  assertRegistryShape(schedule);
  assert(gatewayHits.jobCreate === 1, "paired cron job was not created once");
  assert(cronJobs.length === 1, "stub gateway did not retain the cron job");
  console.log("CHECK ok: monitor created with Telegram summary");

  await phase.win
    .locator(".lst-row", { hasText: TOPIC })
    .first()
    .getByRole("button", { name: "Run now" })
    .click();
  await phase.win
    .getByText("Pending updates (1)", { exact: false })
    .waitFor({ timeout: 30000 });
  await phase.win
    .getByText("Topic monitor updated - Acme launched an agent workspace", {
      exact: false,
    })
    .waitFor({ timeout: 8000 });
  await shot(phase.win, "03-pending-update");

  assert(gatewayHits.research === 1, "research gateway call did not run once");
  assert(gatewayHits.merge === 1, "merge gateway call did not run once");
  assert(gatewayHits.telegram === 1, "Telegram gateway call did not run once");
  console.log("CHECK ok: run produced pending update and Telegram send");

  await phase.win.getByRole("button", { name: "Apply" }).click();
  await phase.win.waitForTimeout(1500);
  await phase.win.keyboard.press("Escape");
  await phase.win
    .getByText("Acme launched a public agent workspace", { exact: false })
    .first()
    .waitFor({ timeout: 10000 });
  await shot(phase.win, "04-applied-page");

  const pagePath = join(vault, `${PAGE_ID}.md`);
  await waitFor(
    "applied topic monitor vault markdown",
    () =>
      existsSync(pagePath) &&
      readFileSync(pagePath, "utf-8").includes(
        "Acme launched a public agent workspace",
      ),
    10000,
  );
  const markdown = readFileSync(pagePath, "utf-8");
  assert(markdown.includes("# AI Agent Launches"), "page title missing");
  assert(
    markdown.includes("https://example.com/agents-launch"),
    "source link missing from vault markdown",
  );
  assert(
    markdown.includes("2026-06-25: Acme launched an agent workspace"),
    "update line missing from vault markdown",
  );
  console.log("CHECK ok: applied page rendered and persisted");

  await phase.app.close();
  activeApp = null;
  activeWin = null;
  console.log("RESULT gatewayHits=", JSON.stringify(gatewayHits));
  console.log("RESULT shots=", shots.join(", "));
  console.log("RESULT consoleErrors=", JSON.stringify(consoleErrors));
  console.log("SMOKE_OK: topic monitor flow");
} catch (err) {
  if (activeWin) {
    await activeWin
      .screenshot({ path: join(OUT, "99-failure.png") })
      .catch(() => {});
  }
  console.log(
    "SIGNAL_BRIEFS_FAIL:",
    err instanceof Error ? err.message : String(err),
  );
  process.exitCode = 1;
} finally {
  if (activeApp) {
    await activeApp.close().catch(() => {});
  }
  clearTimeout(watchdog);
  server.close();
}
