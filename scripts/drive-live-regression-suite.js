/**
 * Full live visual regression suite for Hermes One.
 *
 * This drives the running Electron app through Chrome DevTools Protocol and
 * checks the rendered UI. It intentionally uses the real chat composer,
 * sessions screen, model picker, file input, and screenshots instead of
 * database-only probes.
 *
 * Start the app first:
 *
 *   $env:ENABLE_CDP = "1"; $env:CDP_PORT = "19333"; npm run dev:sandbox
 *
 * Then run:
 *
 *   node scripts/drive-live-regression-suite.js
 *
 * Useful options:
 *
 *   --modes=local,remote,ssh
 *   --skip-generated
 *   --report=.sandbox/live-visual-regression/latest.json
 *   --paste-image=C:\path\to\image.png
 *   --good-provider=openai-codex --good-model=gpt-5.5 --good-base-url=
 *   --bad-provider=openai --bad-model=definitely-not-a-real-model-xyz
 *   --remote-url=http://127.0.0.1:19080 --remote-token=...
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { attach } = require("./e2e-attach");

const DEFAULT_REMOTE_URL = "http://127.0.0.1:19080";
const DEFAULT_REMOTE_MEDIA = "MEDIA:/opt/data/images/duck_bathtub.png";
const DEFAULT_LOCAL_MEDIA =
  "C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png";

const DEFAULT_GOOD_MODEL = {
  provider: "openai-codex",
  model: "gpt-5.5",
  baseUrl: "",
};

// Used only as a fallback. The suite normally creates temporary dead-route
// custom models so the bad-model checks do not depend on catalog behavior.
const DEFAULT_BAD_MODEL = {
  provider: "custom",
  model: "visual-dead-route",
  baseUrl: "http://127.0.0.1:9/v1",
};

const DEAD_ROUTE_BASE_URL = "http://127.0.0.1:9/v1";

function mediaPathForMode(mode) {
  if (mode === "local") return LOCAL_MEDIA;
  return REMOTE_MEDIA.startsWith("MEDIA:") ? REMOTE_MEDIA.slice("MEDIA:".length) : REMOTE_MEDIA;
}

function imageKey(image) {
  return String(image && image.src ? image.src : "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function duplicateImageGroups(images) {
  const counts = new Map();
  for (const image of images || []) {
    const key = imageKey(image);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([src, count]) => ({ src, count }));
}

function assertNoDuplicateRenderedImages(state, label) {
  const duplicates = duplicateImageGroups(state.bubbleImages);
  assert(duplicates.length === 0, `${label} rendered duplicate images`, {
    duplicates,
    bubbleImages: state.bubbleImages,
    agentTail: state.agentText.slice(-1_500),
  });
}

function badRouteModel(mode, runId, suffix) {
  return {
    name: `Visual Bad ${mode} ${runId} ${suffix}`,
    provider: BAD_MODEL.provider || "custom",
    model: `${BAD_MODEL.model || "visual-dead-route"}-${mode}-${runId}-${suffix}`.toLowerCase(),
    baseUrl: BAD_MODEL.baseUrl || DEAD_ROUTE_BASE_URL,
  };
}

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = eq === -1 ? true : raw.slice(eq + 1);
    if (eq === -1) {
      args[key] = true;
    } else {
      args[key] = value;
    }
    args[camelKey] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const RUN_ID =
  args.runId ||
  new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const MODES = String(args.modes || process.env.HERMES_VISUAL_MODES || "local,remote,ssh")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const CDP_PORT = args.cdpPort || process.env.CDP_PORT || "19333";
const REMOTE_URL =
  args.remoteUrl || process.env.HERMES_REMOTE_URL || DEFAULT_REMOTE_URL;
const REMOTE_MEDIA =
  args.remoteMedia || process.env.HERMES_REMOTE_MEDIA || DEFAULT_REMOTE_MEDIA;
const LOCAL_MEDIA =
  args.localMedia || process.env.HERMES_LOCAL_MEDIA || DEFAULT_LOCAL_MEDIA;
const GOOD_MODEL = {
  provider:
    args.goodProvider ||
    process.env.HERMES_VISUAL_GOOD_PROVIDER ||
    DEFAULT_GOOD_MODEL.provider,
  model:
    args.goodModel ||
    process.env.HERMES_VISUAL_GOOD_MODEL ||
    DEFAULT_GOOD_MODEL.model,
  baseUrl:
    args.goodBaseUrl ||
    process.env.HERMES_VISUAL_GOOD_BASE_URL ||
    DEFAULT_GOOD_MODEL.baseUrl,
};
const BAD_MODEL = {
  provider:
    args.badProvider ||
    process.env.HERMES_VISUAL_BAD_PROVIDER ||
    DEFAULT_BAD_MODEL.provider,
  model:
    args.badModel ||
    process.env.HERMES_VISUAL_BAD_MODEL ||
    DEFAULT_BAD_MODEL.model,
  baseUrl:
    args.badBaseUrl ||
    process.env.HERMES_VISUAL_BAD_BASE_URL ||
    DEFAULT_BAD_MODEL.baseUrl,
};

const OUTPUT_DIR = path.resolve(
  args.outputDir ||
    process.env.HERMES_VISUAL_OUTPUT_DIR ||
    path.join(".sandbox", "live-visual-regression", RUN_ID),
);
const REPORT_PATH = path.resolve(
  args.report ||
    process.env.HERMES_VISUAL_REPORT ||
    path.join(OUTPUT_DIR, "report.json"),
);
const PASTE_IMAGE = path.resolve(
  args.pasteImage ||
    process.env.HERMES_VISUAL_PASTE_IMAGE ||
    firstExisting([
      path.join(os.tmpdir(), "codex-clipboard-bd73d905-fefb-4510-8e87-5bee9e0d7a22.png"),
      LOCAL_MEDIA,
      path.join(process.cwd(), "resources", "icon.png"),
    ]) ||
    "",
);

const TIMEOUTS = {
  short: Number(args.shortTimeout || 30_000),
  normal: Number(args.normalTimeout || 120_000),
  image: Number(args.imageTimeout || 180_000),
  generated: Number(args.generatedTimeout || 420_000),
  restore: Number(args.restoreTimeout || 45_000),
};

let cachedRemoteToken = args.remoteToken || process.env.HERMES_REMOTE_TOKEN || "";

if (args.help) {
  console.log(`
Hermes One live visual regression suite

Usage:
  node scripts/drive-live-regression-suite.js [options]
  npm run test:live-visual -- [options]

Options:
  --modes=local,remote,ssh
  --skip-generated
  --dry-run
  --paste-image=C:\\path\\to\\image.png
  --remote-url=http://127.0.0.1:19080
  --remote-token=<dashboard token>
  --good-provider=openai-codex --good-model=gpt-5.5 --good-base-url=
  --bad-provider=openai --bad-model=definitely-not-a-real-model-xyz --bad-base-url=
  --output-dir=.sandbox/live-visual-regression/<run>
  --report=.sandbox/live-visual-regression/<run>/report.json

The app must already be running with ENABLE_CDP=1 and CDP_PORT matching
--cdp-port or the CDP_PORT environment variable.
`);
  process.exit(0);
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate));
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function includesAny(text, needles) {
  const haystack = String(text || "").toLowerCase();
  return needles.some((needle) => haystack.includes(String(needle).toLowerCase()));
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  return String(text || "").split(needle).length - 1;
}

function ensureDir(fileOrDir) {
  fs.mkdirSync(fileOrDir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

async function renderer(page, fn, arg) {
  return page.evaluate(fn, arg);
}

async function readRemoteDashboardToken() {
  if (cachedRemoteToken) return cachedRemoteToken;
  const response = await fetch(REMOTE_URL, {
    signal: AbortSignal.timeout(15_000),
  });
  const html = await response.text();
  const match = /__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/.exec(html);
  assert(match, "Remote dashboard token was not found in dashboard shell HTML", {
    remoteUrl: REMOTE_URL,
  });
  cachedRemoteToken = match[1];
  return cachedRemoteToken;
}

async function screenshot(page, label) {
  const file = path.join(OUTPUT_DIR, `${label}.png`);
  ensureDir(path.dirname(file));
  try {
    await page.screenshot({ path: file, fullPage: false, timeout: 12_000 });
    return file;
  } catch (playwrightError) {
    try {
      const client = await page.context().newCDPSession(page);
      const shot = await client.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      await client.detach().catch(() => {});
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      return file;
    } catch (cdpError) {
      const diagnosticFile = path.join(OUTPUT_DIR, `${label}.screenshot-failed.txt`);
      const state = await getVisualState(page).catch((stateError) => ({
        body: `Could not collect visual state: ${stateError.stack || stateError.message}`,
      }));
      fs.writeFileSync(
        diagnosticFile,
        [
          "Screenshot capture failed.",
          "",
          "Playwright error:",
          playwrightError.stack || playwrightError.message,
          "",
          "CDP error:",
          cdpError.stack || cdpError.message,
          "",
          "Visible text:",
          state.body || "",
        ].join("\n"),
      );
      console.warn(`[WARN] screenshot failed for ${label}; wrote ${diagnosticFile}`);
      return diagnosticFile;
    }
  }
}

async function getVisualState(page) {
  return renderer(page, () => {
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    };
    const userRows = Array.from(document.querySelectorAll(".chat-message-user")).filter(isVisible);
    const agentRows = Array.from(document.querySelectorAll(".chat-message-agent")).filter(isVisible);
    const errorRows = Array.from(
      document.querySelectorAll(".chat-bubble-error,.chat-error-message"),
    ).filter(isVisible);
    const bubbleImages = Array.from(document.querySelectorAll(".chat-bubble img"))
      .filter(isVisible)
      .map((img) => ({
        src: img.currentSrc || img.getAttribute("src") || "",
        alt: img.getAttribute("alt") || "",
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      }))
      .filter((img) => img.width >= 40 && img.height >= 40);
    const attachmentPreviewImages = Array.from(
      document.querySelectorAll(".chat-attachment-strip img,.attachment-chip-thumb img"),
    )
      .filter(isVisible)
      .map((img) => ({
        src: img.currentSrc || img.getAttribute("src") || "",
        alt: img.getAttribute("alt") || "",
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      }))
      .filter((img) => img.width >= 20 && img.height >= 20);
    const toolRows = Array.from(
      document.querySelectorAll(".tool-activity-row,.tool-activity-group,[class*='tool']"),
    )
      .filter(isVisible)
      .map((el) => el.textContent || "");
    const thoughtRows = Array.from(
      document.querySelectorAll(".thought-card,.thinking-card,[class*='thought']"),
    )
      .filter(isVisible)
      .map((el) => el.textContent || "");
    const lastSendButton = Array.from(document.querySelectorAll("button.chat-send-btn")).at(-1);
    const lastModelButton = Array.from(document.querySelectorAll(".chat-model-name")).at(-1);

    return {
      title: document.querySelector(".chat-header-title")?.textContent || "",
      body: document.body.innerText || "",
      users: userRows.map((el) => el.innerText || ""),
      agents: agentRows.map((el) => el.innerText || ""),
      errors: errorRows.map((el) => el.innerText || ""),
      userText: userRows.map((el) => el.innerText || "").join("\n"),
      agentText: agentRows.map((el) => el.innerText || "").join("\n"),
      errorText: errorRows.map((el) => el.innerText || "").join("\n"),
      bubbleImages,
      attachmentPreviewImages,
      toolText: toolRows.join("\n"),
      thoughtText: thoughtRows.join("\n"),
      modelLabel: lastModelButton?.textContent || "",
      sendTitle: lastSendButton?.getAttribute("title") || "",
      sendDisabled: lastSendButton?.hasAttribute("disabled") || false,
      sessionCards: Array.from(document.querySelectorAll(".sessions-card")).map((el) => ({
        text: el.textContent || "",
        active: el.classList.contains("sessions-card--active"),
      })),
      modelCards: Array.from(document.querySelectorAll(".models-card")).map((el) => ({
        text: el.textContent || "",
      })),
    };
  });
}

async function waitForVisualState(page, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = await getVisualState(page);
  while (Date.now() < deadline) {
    last = await getVisualState(page);
    if (await predicate(last)) return last;
    await sleep(1_000);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

async function clickNav(page, label) {
  await page
    .locator(`button[title="${label}"]`)
    .first()
    .click({ timeout: 10_000 })
    .catch(async () => {
      await page.getByText(label, { exact: true }).first().click({ timeout: 10_000 });
    });
  await sleep(700);
}

function chatInput(page) {
  return page.locator("textarea.chat-input").last();
}

function sendButton(page) {
  return page.locator("button.chat-send-btn").last();
}

function modelButton(page) {
  return page.locator("button.chat-model-trigger").last();
}

async function openChat(page) {
  await clickNav(page, "Chat");
  await chatInput(page).waitFor({ state: "visible", timeout: 15_000 });
}

async function openSessions(page) {
  await clickNav(page, "Sessions");
  await page.waitForSelector("input.sessions-searchbar-input", { timeout: 15_000 });
}

async function openModels(page) {
  await clickNav(page, "Models");
  await page.waitForSelector(".models-header", { timeout: 15_000 });
}

async function newChat(page) {
  await openSessions(page);
  await page.getByRole("button", { name: "New Chat" }).click();
  await chatInput(page).waitFor({ state: "visible", timeout: 15_000 });
  await waitForVisualState(
    page,
    (state) => state.users.length === 0 && state.agents.length === 0 && state.errors.length === 0,
    TIMEOUTS.short,
    "new empty chat",
  );
}

async function setConnectionMode(page, mode) {
  if (mode === "local") {
    await renderer(page, () => window.hermesAPI.setConnectionConfig("local", "", ""));
  } else if (mode === "remote") {
    const token = await readRemoteDashboardToken();
    await renderer(
      page,
      ({ url, token }) => window.hermesAPI.setConnectionConfig("remote", url, token),
      { url: REMOTE_URL, token },
    );
  } else if (mode === "ssh") {
    const token = await readRemoteDashboardToken();
    await renderer(
      page,
      ({ url, token }) => window.hermesAPI.setConnectionConfig("remote", url, token),
      { url: REMOTE_URL, token },
    );
    const cfg = await renderer(page, () => window.hermesAPI.getConnectionConfig());
    await renderer(
      page,
      (ssh) =>
        window.hermesAPI.setSshConfig(
          ssh.host,
          ssh.port,
          ssh.username,
          ssh.keyPath,
          ssh.remotePort,
          ssh.localPort,
        ),
      cfg.ssh,
    );
  } else {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  await sleep(mode === "ssh" ? 5_000 : 2_500);
  const cfg = await renderer(page, () => window.hermesAPI.getConnectionConfig());
  assert(cfg.mode === mode, `Connection mode did not switch to ${mode}`, { cfg });
  return cfg;
}

async function setModel(page, model) {
  await renderer(
    page,
    ({ provider, model, baseUrl }) =>
      window.hermesAPI.setModelConfig(provider, model, baseUrl || ""),
    model,
  );
  await sleep(1_000);
  await openChat(page);

  const state = await getVisualState(page);
  if (!state.modelLabel.toLowerCase().includes(model.model.toLowerCase())) {
    await modelButton(page).click();
    await page.waitForSelector(".chat-model-dropdown", { timeout: 15_000 }).catch(() => {});
    await sleep(750);
    const pickerText = (await getVisualState(page)).body;
    assert(
      pickerText.toLowerCase().includes(model.model.toLowerCase()) ||
        pickerText.toLowerCase().includes(model.provider.toLowerCase()),
      "Model picker did not expose the selected/configured model",
      { model, pickerText: pickerText.slice(0, 2_000) },
    );
    await page.keyboard.press("Escape").catch(() => {});
  }
}

async function setModelConfigOnly(page, model) {
  await renderer(
    page,
    ({ provider, model, baseUrl }) =>
      window.hermesAPI.setModelConfig(provider, model, baseUrl || ""),
    model,
  );
  await sleep(1_000);
}

async function sendPrompt(page, prompt, timeoutMs) {
  await openChat(page);
  const baseline = await getVisualState(page);
  await chatInput(page).fill(prompt);
  await sendButton(page).click();
  return waitForVisualState(
    page,
    (state) =>
      state.sendTitle === "Send" &&
      state.users.length > baseline.users.length &&
      (state.agents.length > baseline.agents.length ||
        state.errors.length > baseline.errors.length),
    timeoutMs,
    `send prompt ${prompt.slice(0, 80)}`,
  );
}

async function sendPromptWithAttachment(page, prompt, imagePath, timeoutMs) {
  assert(fs.existsSync(imagePath), "Pasted-image fixture does not exist", { imagePath });
  await openChat(page);
  const baseline = await getVisualState(page);
  await page.locator("input[type=file]").last().setInputFiles(imagePath);
  await waitForVisualState(
    page,
    (state) =>
      state.attachmentPreviewImages.length > 0 ||
      state.bubbleImages.length > 0 ||
      state.body.includes(path.basename(imagePath)),
    TIMEOUTS.short,
    "attachment preview",
  );
  await chatInput(page).fill(prompt);
  await sendButton(page).click();
  return waitForVisualState(
    page,
    (state) =>
      state.sendTitle === "Send" &&
      state.users.length > baseline.users.length &&
      (state.agents.length > baseline.agents.length ||
        state.errors.length > baseline.errors.length),
    timeoutMs,
    `send attachment prompt ${prompt.slice(0, 80)}`,
  );
}

async function restoreBySearch(page, token) {
  await openSessions(page);
  const search = page.locator("input.sessions-searchbar-input").first();
  await search.fill(token);

  let cards = [];
  const deadline = Date.now() + TIMEOUTS.restore;
  while (Date.now() < deadline) {
    const state = await getVisualState(page);
    cards = state.sessionCards;
    if (cards.length > 0) break;
    await sleep(1_000);
  }

  assert(cards.length > 0, "Sessions search found no matching session", { token });
  await page.locator(".sessions-card").first().click();
  await sleep(2_500);
  await openChat(page);
  await sleep(1_000);
  return getVisualState(page);
}

async function addTemporaryModel(page, mode, runId) {
  const model = {
    name: `Visual Added ${mode} ${runId}`,
    provider: "custom",
    model: `visual-added-${mode}-${runId}`,
    baseUrl: DEAD_ROUTE_BASE_URL,
  };

  return addConfiguredModel(page, model);
}

async function addConfiguredModel(page, model) {
  const added = await renderer(
    page,
    (m) => window.hermesAPI.addModel(m.name, m.provider, m.model, m.baseUrl),
    model,
  );
  await sleep(1_500);
  return { ...model, id: added.id };
}

async function removeTemporaryModel(page, id) {
  if (!id) return;
  await renderer(page, (modelId) => window.hermesAPI.removeModel(modelId), id).catch(
    () => false,
  );
  await sleep(1_500);
}

async function runCase(report, mode, name, fn) {
  const caseId = `${mode}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const startedAt = nowIso();
  console.log(`[CASE] ${mode}: ${name}`);
  try {
    const details = await fn(caseId);
    const record = {
      mode,
      name,
      status: "pass",
      startedAt,
      endedAt: nowIso(),
      ...details,
    };
    report.cases.push(record);
    console.log(`[PASS] ${mode}: ${name}`);
    return record;
  } catch (error) {
    const record = {
      mode,
      name,
      status: "fail",
      startedAt,
      endedAt: nowIso(),
      error: error && error.stack ? error.stack : String(error),
      details: error && error.details ? error.details : undefined,
    };
    report.cases.push(record);
    console.log(`[FAIL] ${mode}: ${name}: ${error.message || error}`);
    return record;
  } finally {
    report.updatedAt = nowIso();
    writeJson(REPORT_PATH, report);
  }
}

function assertNoDuplicates(restored, checks) {
  for (const check of checks) {
    const userCount = check.user
      ? restored.users.filter((row) => row.includes(check.user)).length
      : 0;
    const agentCount = check.agent
      ? restored.agents.filter((row) => row.includes(check.agent)).length
      : 0;
    if (check.user) {
      assert(userCount === 1, `Unexpected user message count for ${check.user}`, {
        userCount,
        restoredUsers: restored.users,
        restoredUserText: restored.userText,
      });
    }
    if (check.agent) {
      assert(agentCount === 1, `Unexpected assistant message count for ${check.agent}`, {
        agentCount,
        restoredAgents: restored.agents,
        restoredAgentText: restored.agentText,
      });
    }
  }
}

async function runMode(page, report, mode) {
  const modeRun = `${RUN_ID}_${mode}`;
  await setConnectionMode(page, mode);
  await setModel(page, GOOD_MODEL);

  await runCase(report, mode, "normal prompt with valid model and session restore", async (caseId) => {
    const token = `VIS_${modeRun}_NORMAL_OK`;
    await newChat(page);
    const live = await sendPrompt(
      page,
      `Visual regression ${mode} normal. Reply exactly ${token} and nothing else. Do not use tools.`,
      TIMEOUTS.normal,
    );
    assert(live.agentText.includes(token), "Live assistant response missing token", {
      agentText: live.agentText,
      errorText: live.errorText,
    });
    const liveShot = await screenshot(page, `${caseId}-live`);
    const restored = await restoreBySearch(page, token);
    const restoreShot = await screenshot(page, `${caseId}-restore`);
    assert(restored.agentText.includes(token), "Restored assistant response missing token");
    assertNoDuplicates(restored, [{ user: token, agent: token }]);
    return { token, liveShot, restoreShot };
  });

  await runCase(report, mode, "bad-good-bad-good in one session and session restore", async (caseId) => {
    const base = `VIS_${modeRun}_ALT`;
    const badModels = [];
    await newChat(page);
    try {
      badModels.push(await addConfiguredModel(page, badRouteModel(mode, modeRun, "bad1")));
      badModels.push(await addConfiguredModel(page, badRouteModel(mode, modeRun, "bad2")));

      await setModel(page, badModels[0]);
      const bad1 = await sendPrompt(
        page,
        `${base}_BAD1: Reply BAD_SHOULD_FAIL_1.`,
        TIMEOUTS.normal,
      );
      assert(
        bad1.errorText ||
          includesAny(bad1.agentText, ["error", "failed", "connection", "refused", "unreachable"]),
        "First bad-model leg did not visibly fail",
        { agentText: bad1.agentText, errorText: bad1.errorText, badModel: badModels[0] },
      );

      await setModel(page, GOOD_MODEL);
      const good1Token = `${base}_GOOD1_OK`;
      const good1 = await sendPrompt(
        page,
        `${base}_GOOD1: Reply exactly ${good1Token} and nothing else. Do not use tools.`,
        TIMEOUTS.normal,
      );
      assert(good1.agentText.includes(good1Token), "First recovery leg missing token");

      await setModel(page, badModels[1]);
      const bad2 = await sendPrompt(
        page,
        `${base}_BAD2: Reply BAD_SHOULD_FAIL_2.`,
        TIMEOUTS.normal,
      );
      assert(
        bad2.errorText ||
          includesAny(bad2.agentText, ["error", "failed", "connection", "refused", "unreachable"]),
        "Second bad-model leg did not visibly fail",
        { agentText: bad2.agentText, errorText: bad2.errorText, badModel: badModels[1] },
      );

      await setModel(page, GOOD_MODEL);
      const good2Token = `${base}_GOOD2_OK`;
      const good2 = await sendPrompt(
        page,
        `${base}_GOOD2: Reply exactly ${good2Token} and nothing else. Do not use tools.`,
        TIMEOUTS.normal,
      );
      assert(good2.agentText.includes(good2Token), "Second recovery leg missing token");

      const liveShot = await screenshot(page, `${caseId}-live`);
      const restored = await restoreBySearch(page, good2Token);
      const restoreShot = await screenshot(page, `${caseId}-restore`);
      const restoredText = `${restored.body}\n${restored.errorText}\n${restored.agentText}`;
      assert(restored.userText.includes(`${base}_BAD1`), "Restored session missing BAD1 prompt");
      assert(restored.userText.includes(`${base}_GOOD1`), "Restored session missing GOOD1 prompt");
      assert(restored.userText.includes(`${base}_BAD2`), "Restored session missing BAD2 prompt");
      assert(restored.userText.includes(`${base}_GOOD2`), "Restored session missing GOOD2 prompt");
      assert(restored.agentText.includes(good1Token), "Restored session missing GOOD1 answer");
      assert(restored.agentText.includes(good2Token), "Restored session missing GOOD2 answer");
      assert(
        includesAny(restoredText, ["error", "failed", "connection", "refused", "unreachable"]),
        "Restored session missing bad-model errors",
      );
      assertNoDuplicates(restored, [
        { user: `${base}_BAD1` },
        { user: `${base}_GOOD1`, agent: good1Token },
        { user: `${base}_BAD2` },
        { user: `${base}_GOOD2`, agent: good2Token },
      ]);
      return { base, liveShot, restoreShot, badModels };
    } finally {
      for (const bad of badModels) {
        await removeTemporaryModel(page, bad.id);
      }
      await setModel(page, GOOD_MODEL);
    }
  });

  await runCase(report, mode, "add-remove models persistence and chat selector availability", async (caseId) => {
    let added;
    try {
      added = await addTemporaryModel(page, mode, modeRun);
      await openModels(page);
      await waitForVisualState(
        page,
        (state) => state.body.includes(added.name) && state.body.includes(added.model),
        TIMEOUTS.short,
        "models page showing added model",
      );
      const modelsShot = await screenshot(page, `${caseId}-models-added`);

      await openChat(page);
      await modelButton(page).click();
      const picker = await waitForVisualState(
        page,
        (state) => state.body.includes(added.model) || state.body.includes(added.name),
        TIMEOUTS.short,
        "chat selector showing added model",
      );
      await page.keyboard.press("Escape").catch(() => {});
      const pickerShot = await screenshot(page, `${caseId}-picker-added`);

      const opposite = mode === "local" ? "remote" : "local";
      await setConnectionMode(page, opposite);
      await setConnectionMode(page, mode);
      const persisted = await renderer(page, (model) =>
        window.hermesAPI
          .listModels()
          .then((rows) => rows.some((row) => row.model === model)),
        added.model,
      );
      assert(persisted, "Added model was not persisted after mode switch", { added });

      await removeTemporaryModel(page, added.id);
      const removed = await renderer(page, (model) =>
        window.hermesAPI
          .listModels()
          .then((rows) => !rows.some((row) => row.model === model)),
        added.model,
      );
      assert(removed, "Removed model still appears in model library", { added });
      await openModels(page);
      const removedState = await getVisualState(page);
      assert(!removedState.body.includes(added.model), "Removed model still visible in Models UI");
      return { added, modelsShot, pickerShot, pickerExcerpt: picker.body.slice(0, 1_000) };
    } finally {
      if (added) await removeTemporaryModel(page, added.id);
      await setModel(page, GOOD_MODEL);
    }
  });

  await runCase(report, mode, "pasted image display in live prompt and restored session", async (caseId) => {
    const token = `VIS_${modeRun}_PASTE`;
    await setModel(page, GOOD_MODEL);
    await newChat(page);
    const live = await sendPromptWithAttachment(
      page,
      `${token}: what is this image? Answer in one sentence.`,
      PASTE_IMAGE,
      TIMEOUTS.image,
    );
    assert(live.userText.includes(token), "Live pasted-image prompt missing");
    assert(live.bubbleImages.length > 0, "Live pasted-image bubble did not display image");
    assert(live.agentText.trim().length > 0, "Live pasted-image response missing");
    const liveShot = await screenshot(page, `${caseId}-live`);

    const restored = await restoreBySearch(page, token);
    const restoreShot = await screenshot(page, `${caseId}-restore`);
    assert(restored.userText.includes(token), "Restored pasted-image prompt missing");
    assert(restored.bubbleImages.length > 0, "Restored pasted-image bubble did not display image");
    assert(
      !restored.userText.includes("[The user attached an image"),
      "Restored pasted-image prompt showed fallback text instead of attachment",
    );
    assertNoDuplicates(restored, [{ user: token }]);
    return {
      token,
      liveShot,
      restoreShot,
      liveImages: live.bubbleImages.length,
      restoredImages: restored.bubbleImages.length,
    };
  });

  await runCase(report, mode, "same image markdown and file path renders once", async (caseId) => {
    const token = `VIS_${modeRun}_IMAGE_DEDUPE`;
    const mediaPath = mediaPathForMode(mode);
    await setModel(page, GOOD_MODEL);
    await newChat(page);
    await sendPrompt(
      page,
      `${token}: Reply with exactly these three lines and no extra text. Do not use tools.\nHere it is:\n![Toy Duck](${mediaPath})\nFile: \`${mediaPath}\``,
      TIMEOUTS.normal,
    );
    const live = await waitForVisualState(
      page,
      (state) => state.bubbleImages.length > 0 || state.errorText.trim().length > 0,
      TIMEOUTS.image,
      "duplicate image/path live media render",
    );
    assert(!live.errorText, "Duplicate image/path live response has an error", {
      errorText: live.errorText,
    });
    assert(live.agentText.includes(mediaPath), "Live response did not include the requested path", {
      mediaPath,
      agentTail: live.agentText.slice(-1_500),
    });
    assert(live.bubbleImages.length > 0, "Live duplicate image/path response rendered no image", {
      agentTail: live.agentText.slice(-1_500),
    });
    assertNoDuplicateRenderedImages(live, "Live duplicate image/path response");
    const liveShot = await screenshot(page, `${caseId}-live`);

    const restored = await restoreBySearch(page, token);
    const restoreShot = await screenshot(page, `${caseId}-restore`);
    assert(restored.userText.includes(token), "Restored duplicate image/path prompt missing");
    assert(restored.bubbleImages.length > 0, "Restored duplicate image/path response rendered no image");
    assertNoDuplicateRenderedImages(restored, "Restored duplicate image/path response");
    assertNoDuplicates(restored, [{ user: token }]);
    return {
      token,
      mediaPath,
      liveShot,
      restoreShot,
      liveImages: live.bubbleImages.length,
      restoredImages: restored.bubbleImages.length,
    };
  });

  if (!args.skipGenerated) {
    await runCase(report, mode, "generated image display in live prompt and restored session", async (caseId) => {
      const token = `VIS_${modeRun}_GEN`;
      await setModel(page, GOOD_MODEL);
      await newChat(page);
      const remoteHint =
        mode === "local"
          ? "Use the local AI Playground / ComfyUI endpoint if needed."
          : "Use host.docker.internal:49000 for AI Playground / ComfyUI if needed.";
      await sendPrompt(
        page,
        `${token}: Generate an image of a toy duck in a bathtub using AI Playground / ComfyUI. Do not ask clarification. ${remoteHint} Save it and include a markdown image link or file path to the generated PNG.`,
        TIMEOUTS.generated,
      );
      const live = await waitForVisualState(
        page,
        (state) => state.bubbleImages.length > 0 || state.errorText.trim().length > 0,
        TIMEOUTS.image,
        "generated-image live media render",
      );
      const liveShot = await screenshot(page, `${caseId}-live`);
      assert(
        live.bubbleImages.length > 0,
        "Generated-image live response did not render an image in a chat bubble",
        {
          agentTail: live.agentText.slice(-1_500),
          errorText: live.errorText,
          bubbleImages: live.bubbleImages,
        },
      );
      assert(!live.errorText, "Generated-image live response has an error", {
        errorText: live.errorText,
      });
      assertNoDuplicateRenderedImages(live, "Generated-image live response");

      const restored = await restoreBySearch(page, token);
      const restoreShot = await screenshot(page, `${caseId}-restore`);
      assert(restored.userText.includes(token), "Restored generated-image prompt missing");
      assert(
        restored.bubbleImages.length > 0,
        "Restored generated-image session did not render an image",
        { agentTail: restored.agentText.slice(-1_500) },
      );
      assertNoDuplicateRenderedImages(restored, "Restored generated-image response");
      assertNoDuplicates(restored, [{ user: token }]);
      return {
        token,
        liveShot,
        restoreShot,
        liveImages: live.bubbleImages.length,
        restoredImages: restored.bubbleImages.length,
      };
    });
  }
}

(async () => {
  ensureDir(OUTPUT_DIR);
  const { browser, page } = await attach({
    cdpUrl: `http://127.0.0.1:${CDP_PORT}`,
    titleHint: "Hermes One",
  });
  page.setDefaultTimeout(15_000);

  const original = await renderer(page, async () => ({
    connection: await window.hermesAPI.getConnectionConfig(),
    model: await window.hermesAPI.getModelConfig().catch(() => null),
  }));

  if (original.connection.mode !== "local" && !cachedRemoteToken) {
    try {
      cachedRemoteToken = await readRemoteDashboardToken();
    } catch {
      /* Cleanup will avoid replacing an existing token unless we have one. */
    }
  }

  const report = {
    runId: RUN_ID,
    startedAt: nowIso(),
    cdpPort: CDP_PORT,
    remoteUrl: REMOTE_URL,
    modes: MODES,
    goodModel: GOOD_MODEL,
    badModel: BAD_MODEL,
    pasteImage: PASTE_IMAGE,
    outputDir: OUTPUT_DIR,
    reportPath: REPORT_PATH,
    cases: [],
  };

  if (args.dryRun) {
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    return;
  }

  try {
    assert(page.url(), "No renderer page attached");
    assert(await page.title(), "Renderer page has no title");
    assert(
      await renderer(page, () => Boolean(window.hermesAPI && window.hermesAPI.sendMessage)),
      "Renderer hermesAPI is not available",
    );
    assert(
      fs.existsSync(PASTE_IMAGE),
      "No pasted-image fixture found. Pass --paste-image=C:\\path\\image.png",
      { pasteImage: PASTE_IMAGE },
    );

    for (const mode of MODES) {
      await runMode(page, report, mode);
    }
  } finally {
    try {
      await renderer(
        page,
        async ({ connection, model, remoteToken }) => {
          try {
            if (connection.mode === "local") {
              await window.hermesAPI.setConnectionConfig("local", "", "");
            } else if (connection.mode === "remote") {
              if (remoteToken) {
                await window.hermesAPI.setConnectionConfig(
                  "remote",
                  connection.remoteUrl || "",
                  remoteToken,
                );
              }
            } else if (connection.mode === "ssh") {
              if (remoteToken) {
                await window.hermesAPI.setConnectionConfig(
                  "remote",
                  connection.remoteUrl || "",
                  remoteToken,
                );
              }
              if (connection.ssh) {
                await window.hermesAPI.setSshConfig(
                  connection.ssh.host,
                  connection.ssh.port,
                  connection.ssh.username,
                  connection.ssh.keyPath,
                  connection.ssh.remotePort,
                  connection.ssh.localPort,
                );
              }
            }
          } catch {
            /* best effort */
          }
          try {
            await window.hermesAPI.setConnectionChatTransports(
              connection.remoteChatTransport || "auto",
              connection.sshChatTransport || "auto",
            );
          } catch {
            /* best effort */
          }
          if (model) {
            try {
              await window.hermesAPI.setModelConfig(
                model.provider,
                model.model,
                model.baseUrl || "",
              );
            } catch {
              /* best effort */
            }
          }
        },
        { ...original, remoteToken: cachedRemoteToken },
      );
    } catch {
      /* best effort cleanup */
    }
    report.endedAt = nowIso();
    writeJson(REPORT_PATH, report);
    await browser.close();
  }

  const failed = report.cases.filter((c) => c.status === "fail");
  const passed = report.cases.filter((c) => c.status === "pass");
  console.log(`[SUMMARY] ${passed.length}/${report.cases.length} passed`);
  console.log(`[REPORT] ${REPORT_PATH}`);
  if (failed.length > 0) {
    for (const failure of failed) {
      console.log(`[FAILED] ${failure.mode}: ${failure.name}`);
      console.log(failure.error.split("\n")[0]);
    }
    process.exit(1);
  }
})().catch((error) => {
  console.error("[FATAL]", error && error.stack ? error.stack : error);
  process.exit(1);
});
