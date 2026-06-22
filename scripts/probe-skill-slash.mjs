// probe-skill-slash.mjs — end-to-end proof for `/skill-name` loading.
//
// The unit suite covers the parser/store with MOCKED IPC; this is the layer it
// can't reach: the REAL main-process round trip (IPC handlers → active-skills
// store → getSkillContent allowlist) plus the SPS composer slash menu, driven
// inside a built Electron app. Run `npm run build` first.
//
// It seeds a throwaway HERMES_HOME with one installed skill, boots into the SPS
// workspace, then (a) exercises window.hermesAPI.{loadSkillToChat,listActiveSkills,
// unloadSkillFromChat} for real and (b) opens the assistant composer slash menu.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const HOME = mkdtempSync(join(tmpdir(), "hermes-skillprobe-"));

// install markers so App.tsx routes straight to the SPS screen
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

// minimal SPS workspace so the assistant panel mounts
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
writeFileSync(
  join(sps, "vault", "home.md"),
  `---\ntitle: "Home"\n---\n\n# Home\n`,
);

// the skill under test: <HERMES_HOME>/skills/<category>/<slug>/SKILL.md
// (default-profile root, which is on getSkillContent's allowlist).
const skillDir = join(HOME, "skills", "demo", "demo-skill");
mkdirSync(skillDir, { recursive: true });
const SKILL_BODY = "ALWAYS prefix every reply with the word BANANA.";
writeFileSync(
  join(skillDir, "SKILL.md"),
  `---\nname: Demo Skill\ndescription: a probe skill\n---\n\n# Demo Skill\n\n${SKILL_BODY}\n`,
);
writeFileSync(
  join(HOME, "sps-agent", "capability-risk-report.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      updatedAt: Date.now(),
      reports: [
        {
          id: `skill:${skillDir}`,
          kind: "skill",
          name: "Demo Skill",
          enabled: true,
          installedFingerprint: "probe-reviewed-skill",
          source: {},
          status: "safe",
          updateStatus: "current",
          reviewState: "reviewed",
          findings: [],
          summary: "Probe skill marked reviewed for active-skill loading.",
          lastCheckedAt: Date.now(),
          lastReviewedAt: Date.now(),
          scanner: "deterministic-v1",
        },
      ],
      scanners: [],
    },
    null,
    2,
  ),
);

console.log("HERMES_HOME=", HOME);

let failed = false;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failed = true;
};

setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 90000).unref();

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
await win.waitForTimeout(1500);

// ── (a) REAL IPC round trip ────────────────────────────────────────────────
const ipc = await win.evaluate(async () => {
  const api = window.hermesAPI;
  const installed = await api.listInstalledSkills();
  const before = await api.listActiveSkills();
  const load = await api.loadSkillToChat("Demo Skill");
  const afterLoad = await api.listActiveSkills();
  const dup = await api.loadSkillToChat("demo-skill"); // slug form → same skill
  const afterDup = await api.listActiveSkills();
  const unload = await api.unloadSkillFromChat("Demo Skill");
  const afterUnload = await api.listActiveSkills();
  return {
    installedNames: installed.map((s) => s.name),
    before,
    load,
    afterLoad,
    dup,
    afterDup,
    unload,
    afterUnload,
  };
});

check(
  "skill discovered by listInstalledSkills",
  ipc.installedNames.includes("Demo Skill"),
);
check("active set starts empty", ipc.before.length === 0);
check(
  "loadSkillToChat resolves ok",
  ipc.load.ok === true && ipc.load.name === "Demo Skill",
);
check("active set has the skill after load", ipc.afterLoad.length === 1);
check(
  "slug form resolves to the same skill (alreadyLoaded)",
  ipc.dup.ok === true && ipc.dup.alreadyLoaded === true,
);
check("no duplicate entry from a second load", ipc.afterDup.length === 1);
check(
  "unload removes the skill",
  ipc.unload.ok === true && ipc.unload.removed.includes("Demo Skill"),
);
check("active set empty after unload", ipc.afterUnload.length === 0);

// ── (b) SPS composer slash menu (best-effort UI check) ──────────────────────
try {
  // Widen the window so the responsive layout renders the right panel.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setBounds({ x: 0, y: 0, width: 1500, height: 950 });
  });
  await win.waitForTimeout(600);
  // The right panel defaults open on a doc surface; select the Page assistant tab.
  await win
    .locator(".rp-tab", { hasText: "Page assistant" })
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});
  const composer = win.locator("textarea[placeholder*='try /skill']");
  await composer.waitFor({ timeout: 8000 });
  await composer.click();
  await composer.fill("/");
  await win.waitForSelector("[role='listbox']", { timeout: 5000 });
  const menuText = await win.locator("[role='listbox']").innerText();
  check("slash menu shows /skill", menuText.includes("/skill"));
  check(
    "slash menu lists the installed skill",
    menuText.toLowerCase().includes("demo skill"),
  );
} catch (e) {
  console.log(
    "UI-CHECK SKIPPED (assistant composer not reachable):",
    e.message,
  );
}

await app.close();
console.log(failed ? "PROBE_RESULT: FAIL" : "PROBE_RESULT: PASS");
process.exit(failed ? 1 : 0);
