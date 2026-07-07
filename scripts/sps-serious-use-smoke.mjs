// Serious-use dogfood smoke for the SPS Agent operator loop.
//
// Usage: npm run build && node scripts/sps-serious-use-smoke.mjs
//        SPS_SERIOUS_USE_GATEWAY=local SPS_GATEWAY_URL=http://127.0.0.1:8642 node scripts/sps-serious-use-smoke.mjs
//        SPS_SERIOUS_USE_GATEWAY=remote SPS_GATEWAY_URL=http://host:8642 node scripts/sps-serious-use-smoke.mjs
//
// The harness launches the BUILT Electron app against a throwaway HERMES_HOME,
// seeds real persisted readiness signals, and verifies the surfaces an operator
// needs for daily work: capture, Review Queue, Work, Scheduled skip visibility,
// Vault Health, gateway status, and Operator readiness.
import { _electron as electron } from "playwright";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SMOKE_TMP_ROOT =
  process.env.SPS_SMOKE_TMPDIR?.trim() ||
  (process.platform === "darwin" ? "/private/tmp" : tmpdir());
const OUT =
  process.env.SMOKE_OUT || join(SMOKE_TMP_ROOT, "sps-serious-use-smoke");
mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(OUT)) {
  if (name.endsWith(".png")) unlinkSync(join(OUT, name));
}

const HOME = mkdtempSync(join(SMOKE_TMP_ROOT, "hermes-serious-use-"));
const sps = join(HOME, "sps-agent");
const vault = join(sps, "vault");
const now = Date.now();
const GATEWAY_MODE = (process.env.SPS_SERIOUS_USE_GATEWAY || "hermetic")
  .trim()
  .toLowerCase();
const GATEWAY_STATUS_LABELS = [
  "Gateway healthy",
  "Gateway unhealthy",
  "Gateway recovering",
  "Gateway down",
];
const LIVE_GATEWAY = GATEWAY_MODE !== "hermetic";
const GATEWAY_URL =
  process.env.SPS_GATEWAY_URL?.trim() ||
  (GATEWAY_MODE === "local" ? "http://127.0.0.1:8642" : "");
const GATEWAY_KEY = process.env.SPS_GATEWAY_KEY?.trim() || "";

if (!["hermetic", "local", "remote"].includes(GATEWAY_MODE)) {
  console.log(
    "INVALID_GATEWAY_MODE: set SPS_SERIOUS_USE_GATEWAY=hermetic|local|remote",
  );
  process.exit(1);
}

if (GATEWAY_MODE === "remote" && !GATEWAY_URL) {
  console.log("LIVE_GATEWAY_MISSING_URL: set SPS_GATEWAY_URL for remote mode");
  process.exit(1);
}

function localGatewayPort() {
  if (GATEWAY_MODE !== "local") return 8642;
  try {
    const url = new URL(GATEWAY_URL);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      console.log(
        "LIVE_GATEWAY_LOCAL_URL_UNSUPPORTED: local mode only supports localhost URLs",
      );
      process.exit(1);
    }
    if (url.port) return Number(url.port);
    return url.protocol === "https:" ? 443 : 80;
  } catch {
    console.log(
      "LIVE_GATEWAY_INVALID_URL: SPS_GATEWAY_URL must be a valid URL",
    );
    process.exit(1);
  }
}

mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
mkdirSync(join(vault, "projects"), { recursive: true });
mkdirSync(join(HOME, "cron"), { recursive: true });

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
writeFileSync(
  join(HOME, ".env"),
  [
    GATEWAY_MODE === "hermetic"
      ? "ANTHROPIC_API_KEY=sk-ant-test-0000000000"
      : "",
    GATEWAY_KEY ? `API_SERVER_KEY=${GATEWAY_KEY}` : "",
  ]
    .filter(Boolean)
    .join("\n") + "\n",
);
writeFileSync(
  join(HOME, "config.yaml"),
  GATEWAY_MODE === "hermetic"
    ? "model:\n  provider: anthropic\n  default: claude-3-5-sonnet\n  model: claude-3-5-sonnet\n"
    : [
        "model:",
        "  provider: auto",
        "  default: auto",
        "  model: auto",
        GATEWAY_MODE === "local"
          ? [
              "platforms:",
              "  api_server:",
              "    enabled: true",
              "    extra:",
              `      port: ${localGatewayPort()}`,
              '      host: "127.0.0.1"',
            ].join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n") + "\n",
);
writeFileSync(
  join(HOME, "desktop.json"),
  JSON.stringify(
    {
      onboardingCompleted: true,
      schedulerEnabled: false,
      connectionMode: GATEWAY_MODE === "remote" ? "remote" : "local",
      remoteUrl: GATEWAY_MODE === "remote" ? GATEWAY_URL : "",
      remoteApiKey:
        GATEWAY_MODE === "hermetic" ? "smoke-gateway-key" : GATEWAY_KEY,
    },
    null,
    2,
  ),
);

const workspace = {
  tree: [
    { id: "home", children: [] },
    { id: "alpha", children: [] },
    { id: "orphan", children: [] },
  ],
  meta: {
    home: { icon: "H", title: "Home", cover: null },
    alpha: { icon: "A", title: "Alpha", cover: null },
    orphan: { icon: "O", title: "Orphan", cover: null },
  },
  docs: {
    home: [
      { id: "h1", type: "h1", text: "Home" },
      { id: "p1", type: "p", text: "Serious-use smoke workspace." },
      { id: "pl1", type: "page", text: "", pageId: "alpha" },
    ],
    alpha: [
      { id: "ah", type: "h1", text: "Alpha" },
      { id: "ap", type: "p", text: "Linked page." },
    ],
    orphan: [
      { id: "oh", type: "h1", text: "Orphan" },
      { id: "op", type: "p", text: "No pages link here." },
    ],
  },
  comments: [],
  trash: [],
  page: "home",
};

writeFileSync(join(sps, "workspace.json"), JSON.stringify(workspace, null, 2));
writeFileSync(
  join(vault, "home.md"),
  `---\ntitle: "Home"\nicon: "H"\n---\n\n# Home\n\nSerious-use smoke workspace.\n\n[[alpha]]\n[[missing-smoke-page]]\n`,
);
writeFileSync(
  join(vault, "alpha.md"),
  `---\ntitle: "Alpha"\nicon: "A"\n---\n\n# Alpha\n\nLinked page.\n`,
);
writeFileSync(
  join(vault, "orphan.md"),
  `---\ntitle: "Orphan"\nicon: "O"\n---\n\n# Orphan\n\nNo pages link here.\n`,
);
writeFileSync(
  join(vault, "projects", "r1.md"),
  `---\ntitle: "Seed task"\nstatus: "todo"\nprio: "med"\n---\n\nSeed row.\n`,
);

writeFileSync(
  join(sps, "vault-review-queue.json"),
  JSON.stringify(
    [
      {
        id: "vp_serious_use",
        source: "manual",
        title: "Smoke review proposal",
        summary: "Review-first proposal seeded for serious-use smoke.",
        status: "pending",
        createdAt: now,
        updatedAt: now,
        operations: [
          {
            id: "op_smoke_page",
            kind: "upsert-page",
            operationStatus: "pending",
            pageId: "smoke_proposal",
            title: "Smoke Proposal",
            markdown:
              '---\ntitle: "Smoke Proposal"\n---\n\n# Smoke Proposal\n\nReview-first smoke page.\n',
          },
        ],
      },
    ],
    null,
    2,
  ),
);
writeFileSync(
  join(HOME, "cron", "jobs.json"),
  JSON.stringify(
    {
      jobs: [
        {
          id: "scheduler-skip",
          name: "Smoke skipped job",
          schedule: "*/5 * * * *",
          prompt: "Run the serious-use smoke job.",
          state: "active",
          enabled: true,
          next_run_at: null,
          last_run_at: null,
          last_status: "skipped",
          last_error: "lock held",
          repeat: null,
          deliver: [],
          skills: [],
          script: null,
        },
      ],
    },
    null,
    2,
  ),
);
writeFileSync(
  join(HOME, "scheduler-skips.json"),
  JSON.stringify(
    {
      "scheduler-skip": {
        skipCount: 2,
        lastSkipAt: now,
        lastReason: "lock held",
      },
    },
    null,
    2,
  ),
);
writeFileSync(
  join(HOME, "mirror-failures.json"),
  JSON.stringify(
    { count: 1, lastError: "Smoke mirror warning", lastAt: now },
    null,
    2,
  ),
);

console.log("HERMES_HOME=", HOME);
console.log("SMOKE_OUT=", OUT);
console.log(
  "SEAM_AUDIT=",
  JSON.stringify({
    gatewayMode: GATEWAY_MODE,
    gatewayPath: LIVE_GATEWAY ? "real-health-status" : "fixture-visible-only",
    gatewayUrl: GATEWAY_URL || null,
    hasGatewayKey: Boolean(GATEWAY_KEY),
    hermesInstall: "fixture-for-ui-boot",
    spsWorkspace: "fixture",
    readinessSignals: "seeded-fixture",
  }),
);

const failures = [];
function check(condition, message) {
  if (condition) {
    console.log("  ok -", message);
  } else {
    console.log("  FAIL -", message);
    failures.push(message);
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
win.on("console", (msg) => {
  if (msg.type() === "error") console.log("BROWSER_CONSOLE_ERROR:", msg.text());
});
win.on("pageerror", (error) => {
  console.log("BROWSER_PAGE_ERROR:", error.message);
});

async function shot(name) {
  await win.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});
}

async function expectText(text, timeout = 8000) {
  await win.getByText(text, { exact: false }).first().waitFor({ timeout });
}

async function openCommand(label) {
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent("sps:search"));
  });
  await win.waitForSelector(".palette", { timeout: 8000 });
  await win.locator(".pal-item", { hasText: label }).first().click();
}

async function clickNav(label) {
  await win.locator(".nav-item", { hasText: label }).first().click();
}

try {
  await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector(".app", { timeout: 30000 });
  await win.waitForTimeout(1800);

  const report = await win.evaluate(async () => {
    return window.hermesAPI.getOperatorReadiness("default");
  });
  const byId = Object.fromEntries(report.items.map((item) => [item.id, item]));
  check(
    report.status === "attention" || report.status === "blocked",
    "operator readiness aggregates serious-use warnings",
  );
  check(
    byId.review?.status === "attention",
    "pending Review Queue proposal is counted",
  );
  check(
    byId.scheduler?.status === "attention",
    "scheduler disabled/skipped state is counted",
  );
  check(byId.vault?.status === "attention", "Vault Health issues are counted");
  check(byId.storage?.status === "attention", "storage warnings are counted");

  if (LIVE_GATEWAY) {
    const gatewayProof = await win.evaluate(async () => {
      const [running, health] = await Promise.all([
        window.hermesAPI.gatewayStatus(),
        window.hermesAPI.gatewayHealthStatus(),
      ]);
      return { running, health };
    });
    check(gatewayProof.running === true, "real gateway status is reachable");
    check(
      gatewayProof.health === "healthy",
      "real gateway health reports healthy",
    );
    check(
      byId.gateway?.status === "ready",
      "operator readiness gateway item is ready from real status",
    );
    await win
      .getByRole("button", { name: /Gateway healthy/ })
      .first()
      .waitFor({ timeout: 8000 });
    check(true, "gateway status chip shows Gateway healthy");
  } else {
    const gatewayButton = win.getByRole("button", {
      name: new RegExp(GATEWAY_STATUS_LABELS.join("|")),
    });
    await gatewayButton.first().waitFor({ timeout: 8000 });
    check(true, "gateway status chip is visible");
  }

  await win.getByRole("button", { name: "Settings" }).click();
  const dialog = win.getByRole("dialog", { name: "SPS Control Center" });
  await dialog.waitFor({ timeout: 8000 });
  await dialog.getByText("Operator readiness", { exact: false }).waitFor();
  await dialog.getByText("pending vault proposal", { exact: false }).waitFor();
  await dialog.getByText("Scheduler is disabled", { exact: false }).waitFor();
  check(true, "Operator readiness displays in Control Center");
  await shot("01-control-center-readiness");
  await win.getByRole("button", { name: "Close settings" }).click();

  await clickNav("Capture");
  await win.waitForSelector(".inbox-surface", { timeout: 8000 });
  await win
    .locator(".inbox-textarea")
    .fill("Serious-use capture for tomorrow's operator review.");
  await win.locator("button.btn-primary", { hasText: "Capture" }).click();
  await win.waitForTimeout(1600);
  const inboxFiles = existsSync(join(vault, "_inbox"))
    ? readdirSync(join(vault, "_inbox")).filter((name) => name.endsWith(".md"))
    : [];
  check(inboxFiles.length === 1, "capture wrote one markdown file");
  await shot("02-inbox-capture");

  await openCommand("Open AI Review Queue");
  await expectText("AI Review Queue");
  await expectText("Smoke review proposal");
  await expectText("Apply selected");
  check(true, "Review Queue renders seeded proposal");
  await shot("03-review-queue");

  await openCommand("Open Work");
  await win
    .getByRole("tablist", { name: "Work sections" })
    .waitFor({ timeout: 8000 });
  await expectText("Operator readiness");
  await expectText("At a Glance");
  await win.getByRole("tab", { name: "Scheduled" }).click();
  await expectText("Scheduled");
  await win.getByRole("button", { name: "Manage scheduled items" }).click();
  await win.locator(".modal").waitFor({ timeout: 8000 });
  await expectText("Scheduled");
  await expectText("Smoke skipped job");
  await win
    .getByText(/skipped 2/i)
    .first()
    .waitFor({ timeout: 8000 });
  check(true, "scheduled skip visibility is rendered");
  await shot("04-work-scheduled-skips");
  await win.keyboard.press("Escape").catch(() => {});

  await openCommand("Vault health");
  await expectText("Vault health");
  await expectText("Vault Health Guide");
  check(true, "Vault Health surface renders");
  await shot("05-vault-health");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log("SMOKE ERROR:", message);
  failures.push(`exception: ${message}`);
  await shot("99-error");
}

await app.close();
console.log(
  failures.length === 0
    ? `\nSMOKE PASS - all checks ok (shots in ${OUT})`
    : `\nSMOKE FAIL - ${failures.length} issue(s): ${failures.join("; ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
