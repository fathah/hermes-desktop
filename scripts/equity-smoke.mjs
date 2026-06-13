// equity-smoke.mjs — visual verification for the India Equity Research surface.
//
// Boots the BUILT Electron app (run `npm run build` first) against a throwaway
// seeded profile, opens the Equity rail surface, screenshots the empty state,
// then pushes a fixture report through the REAL chat-chunk / chat-done IPC
// channels so useEquityRun renders the full report + charts (radar, peer bars,
// DCF heatmap) with the actual SPS design tokens — no gateway needed.
//
// Usage:  npm run build && node scripts/equity-smoke.mjs
//         SMOKE_OUT=/path node scripts/equity-smoke.mjs
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "equity-smoke");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-eq-smoke-"));

// install markers so App.tsx routes straight to the SPS scope
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);

// minimal SPS workspace so it boots into the scope
const sps = join(HOME, "sps-agent");
mkdirSync(join(sps, "vault"), { recursive: true });
writeFileSync(
  join(sps, "workspace.json"),
  JSON.stringify(
    {
      tree: [{ id: "home", children: [] }],
      meta: { home: { icon: "🏠", title: "Home", cover: null } },
      docs: { home: [{ id: "h1", type: "h1", text: "Home" }] },
      comments: [],
      trash: [],
      page: "home",
    },
    null,
    2,
  ),
);

// ── fixture report: exactly what report_builder.py emits (JSON frontmatter) ──
const frontmatter = {
  hermes_report: "india-equity-research",
  schema: 1,
  ticker: "NTPC",
  updated: "2030-01-01T00:00:00Z",
  exchange: "NSE",
  company: "NTPC Limited",
  sector: "Power Generation (PSU)",
  as_of: "2026-06-05",
  price: 312.4,
  currency: "INR",
  rating: "ACCUMULATE",
  confidence: "medium",
  scores: {
    composite: 64,
    fundamental: 71,
    technical: 55,
    risk: 60,
    sentiment: 58,
    macro: 67,
  },
  valuation: {
    intrinsic_inr: 348,
    upside_pct: 11.4,
    method: "FCFF-10yr-DCF (psu-valuation)",
  },
  risk_matrix: {
    financial: { severity: "Low", factor: "ROCE 11%, regulated returns" },
    governance: { severity: "Medium", factor: "GoI 51% stake, DIPAM overhang" },
    geopolitical: { severity: "Low", factor: "domestic power demand" },
    tech_disruption: {
      severity: "Medium",
      factor: "renewable transition pace",
    },
    fx_trade: { severity: "Low", factor: "partial coal import" },
    legislative: { severity: "Medium", factor: "CERC tariff regs, GST" },
    political: { severity: "Medium", factor: "PLI, election capex cycle" },
    technical: { severity: "Medium", factor: "below SMA200, neutral RSI" },
  },
  peers: [
    { name: "NTPC", pe: 14.2, roe: 12.1 },
    { name: "POWERGRID", pe: 11.8, roe: 18.4 },
    { name: "NHPC", pe: 17.5, roe: 9.2 },
    { name: "SJVN", pe: 22.1, roe: 8.0 },
  ],
  price_series: Array.from({ length: 70 }, (_, i) => {
    const c = 300 + Math.round(Math.sin(i / 4) * 28 + i * 0.5);
    return {
      date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
      o: c - 2,
      h: c + 4,
      l: c - 5,
      c,
      v: 1000000 + i * 1000,
    };
  }),
  sector_heatmap: {
    metrics: ["pe_z", "roe_z", "mom_z"],
    rows: [
      { name: "NTPC", values: [0.4, -0.2, 0.6] },
      { name: "POWERGRID", values: [-0.3, 0.8, 0.1] },
      { name: "NHPC", values: [0.9, -0.5, -0.2] },
    ],
  },
  dcf_sensitivity: {
    wacc: [0.09, 0.1, 0.11],
    growth: [0.03, 0.04, 0.095],
    grid: [
      [420, 465, null],
      [398, 418, null],
      [382, 398, null],
    ],
  },
  evidence_refs: [
    { uuid: "evidence-NTPC-001", source: "nse", tier: "tier2" },
    { uuid: "evidence-NTPC-001", source: "screener", tier: "tier3" },
    { uuid: "evidence-NTPC-001", source: "ntpc-ir", tier: "tier1" },
  ],
  data_gaps: ["Q4 FY26 capex guidance not yet filed; capex array is estimated"],
  provenance: {
    run_id: "run_smoke_001",
    model: "hermes-agent",
    sources: ["NSE", "screener.in", "NTPC IR"],
  },
};
const frontmatterLines = Object.keys(frontmatter).map(
  (k) => `${k}: ${JSON.stringify(frontmatter[k])}`,
);
const REPORT_MD = `---\n${frontmatterLines.join("\n")}\n---\n\n# NTPC Limited (NTPC) — India Equity Research Report\n\n## Executive Summary\nDefensive regulated utility with a dividend floor; accumulate on dips.\n\n## Data Gaps & Epistemic Notes\n- Q4 FY26 capex guidance not yet filed; capex array is estimated\n\n## Disclaimer\nAI-generated analysis, not investment advice.\n`;

const ROW_MD = `---\n${frontmatterLines.join("\n")}\n---\n\n<!-- sps:equity:report -->\n${REPORT_MD}\n<!-- /sps:equity:report -->\n\n## Run history\n| Date | Rating | Composite | Intrinsic | Note |\n|---|---|---|---|---|\n| 2026-06-08 | ACCUMULATE | 64 | 348 | initial |\n\n## My notes\n_Your notes, theses, and addenda — never overwritten by a refresh._\n`;

console.log("HERMES_HOME=", HOME);
console.log("SMOKE_OUT=", OUT);
setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 120000).unref();

// Own user-data-dir so requestSingleInstanceLock doesn't collide with any
// already-running instance of the app (which would make this one quit at boot).
const USERDATA = join(HOME, "electron-data");
mkdirSync(USERDATA, { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${USERDATA}`, "."],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});
app
  .process()
  .stdout.on("data", (data) =>
    console.log("MAIN STDOUT:", data.toString().trim()),
  );
app
  .process()
  .stderr.on("data", (data) =>
    console.log("MAIN STDERR:", data.toString().trim()),
  );

const win = await app.firstWindow();
win.on("console", (msg) => console.log("BROWSER CONSOLE:", msg.text()));
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(1800);

const shots = [];
async function shot(name, fn) {
  try {
    if (fn) await fn();
    await win.waitForTimeout(700);
    await win.screenshot({ path: join(OUT, `${name}.png`) });
    shots.push(name);
    console.log("SHOT ok:", name);
  } catch (e) {
    console.log("SHOT FAIL:", name, "—", e.message);
  }
}

// 01 — open the Equity surface from the rail (proves nav-item + empty state)
await shot("01-equity-empty", async () => {
  await win.locator(".nav-item", { hasText: "Equity" }).first().click();
  await win.waitForSelector(".eq-surface", { timeout: 8000 });
});

// 02 — launcher with a ticker typed (proves token-styled input + hero CTA)
await shot("02-equity-launcher", async () => {
  await win.locator(".eq-ticker-input").fill("NTPC");
});

// 03 — push a fixture report through the real chat IPC; renders full report+charts
await shot("03-equity-report", async () => {
  // Stub the main process IPC send-message and sps-read-row handlers to return the report
  await app.evaluate(
    ({ ipcMain }, stubs) => {
      console.log("STUBBING send-message AND sps-read-row");
      ipcMain.removeHandler("send-message");
      ipcMain.handle("send-message", async (event, prompt) => {
        console.log(
          "MOCK send-message called with prompt:",
          prompt.slice(0, 100),
        );
        return { response: stubs.REPORT_MD };
      });
      ipcMain.removeHandler("sps-read-row");
      ipcMain.handle("sps-read-row", async (event, dbFolder, rowId) => {
        console.log("MOCK sps-read-row called:", dbFolder, rowId);
        if (dbFolder === "equity-research" && rowId === "ntpc") {
          console.log("MOCK sps-read-row matches ntpc! Returning ROW_MD.");
          return stubs.ROW_MD;
        }
        return null;
      });
    },
    { REPORT_MD, ROW_MD },
  );

  // Click the run button to trigger the run flow
  console.log("Clicking Run research...");
  await win.evaluate(() => {
    const buttons = [...document.querySelectorAll(".eq-run-btn")].map((b) => ({
      text: (b.textContent || "").trim(),
      outerHTML: b.outerHTML,
      visible: b.offsetWidth > 0 && b.offsetHeight > 0,
      disabled: b.disabled,
    }));
    console.log("ALL FOUND RUN BUTTONS:", JSON.stringify(buttons));

    const btn = [...document.querySelectorAll(".eq-run-btn")].find(
      (b) => (b.textContent || "").trim() === "Run research",
    );
    if (btn) {
      console.log("Clicking button:", btn.outerHTML);
      btn.click();
      console.log("Click dispatched successfully.");
    } else {
      console.log("ERROR: Run research button NOT found.");
    }
  });

  // wait for the parsed report + charts to mount
  try {
    await win.waitForSelector(".eq-report", { timeout: 12000 });
    await win.waitForSelector(".eq-radar svg", { timeout: 12000 });
  } catch (e) {
    const surfaceText = await win.evaluate(
      () => document.querySelector(".eq-surface")?.innerText || "not found",
    );
    const html = await win.evaluate(
      () => document.querySelector(".eq-surface")?.innerHTML || "not found",
    );
    console.log("TIMEOUT ON SELECTOR! SURFACE_TEXT=", surfaceText);
    console.log("TIMEOUT ON SELECTOR! HTML=", html.slice(0, 1000));
    throw e;
  }
});

// quick assertions so the harness fails loudly if the surface is broken
const checks = await win.evaluate(() => {
  const q = (s) => document.querySelector(s);
  return {
    surface: !!q(".eq-surface"),
    report: !!q(".eq-report"),
    rating: q(".eq-rating")?.textContent?.trim(),
    gauges: document.querySelectorAll(".eq-gauge-track").length,
    svgs: document.querySelectorAll(".eq-report svg").length,
    tiers: document.querySelectorAll(".eq-tier").length,
    dataGaps: document.querySelectorAll(".eq-gaps li").length,
    technical: !!q(".eq-technical"),
    activeBar: !!q(".eq-active-bar"),
    tagEditor: !!q(".eq-tags"),
    sector: !!q(".eq-sector"),
    pnf: !![...document.querySelectorAll(".eq-technical svg")].find(
      (s) => s.getAttribute("aria-label") === "Point and Figure chart",
    ),
    // confirm tokens resolved (not the old fabricated fallback blue #2d6cdf)
    ctaBg: getComputedStyle(q(".eq-run-btn")).backgroundColor,
  };
});
console.log("CHECKS=", JSON.stringify(checks));

await app.close();

const ok =
  checks.surface &&
  checks.report &&
  checks.rating === "ACCUMULATE" &&
  checks.gauges === 6 &&
  checks.svgs >= 6 &&
  checks.tiers === 3 &&
  checks.dataGaps >= 1 &&
  checks.technical &&
  checks.sector &&
  checks.pnf &&
  checks.activeBar &&
  checks.tagEditor;

console.log(
  ok ? "EQUITY_SMOKE_PASS" : "EQUITY_SMOKE_FAIL",
  "shots:",
  shots.join(","),
);
process.exit(ok ? 0 : 1);
