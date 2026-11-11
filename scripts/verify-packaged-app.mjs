#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Executable JavaScript acceptance harness. */
/** Packaged Electron UI + actual Agent with scripted localhost responses, never paid inference. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import * as asar from "@electron/asar";
import { _electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const split = argument.indexOf("=");
    return split < 0
      ? [argument.replace(/^--/, ""), true]
      : [argument.slice(2, split), argument.slice(split + 1)];
  }),
);
const sourcePackage = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const executablePath = path.resolve(
  typeof args["executable-path"] === "string"
    ? args["executable-path"]
    : path.join(
        root,
        "dist/mac-arm64/Hermes One.app/Contents/MacOS/Hermes One",
      ),
);
const mode = args.mode || "remote";
assert.ok(["remote", "local"].includes(mode), "--mode must be remote or local");
if (
  !args["preflight-only"] &&
  mode === "remote" &&
  (typeof args["agent-repo"] !== "string" || typeof args.python !== "string")
) {
  throw new Error(
    "Usage: node scripts/verify-packaged-app.mjs --executable-path=/path/to/packaged/app --agent-repo=/path/to/isolated/Agent --python=/path/to/python3.14 [--output=/path/to/report.json] [--preflight-only]",
  );
}
function ownedLocalHome() {
  assert.equal(
    typeof args["hermes-home"],
    "string",
    "Local UI requires --hermes-home=/absolute/owned/temp/home",
  );
  assert.ok(
    path.isAbsolute(args["hermes-home"]),
    "Local Hermes home must be absolute",
  );
  const home = fs.realpathSync(args["hermes-home"]);
  const temporaryRoots = [os.tmpdir(), "/private/tmp"]
    .filter(fs.existsSync)
    .map((entry) => fs.realpathSync(entry));
  assert.ok(
    temporaryRoots.some((temporary) =>
      home.startsWith(`${temporary}${path.sep}`),
    ),
    "Local Hermes home must belong to a temporary fixture",
  );
  const proof = JSON.parse(
    fs.readFileSync(path.join(home, ".desktop-compat-fixture.json"), "utf8"),
  );
  assert.equal(proof.purpose, "hermes-desktop-packaged-ui");
  assert.equal(
    fs.realpathSync(proof.ownedHome),
    home,
    "Local ownership marker names another home",
  );
  assert.ok(
    fs.existsSync(path.join(home, "hermes-agent/.hermes/bin/hermes")),
    "Local fixture lacks a real managed launcher",
  );
  return home;
}
const output = path.resolve(
  typeof args.output === "string"
    ? args.output
    : path.join(root, ".sandbox/packaged-app/result.json"),
);
const evidence = path.dirname(output);
fs.mkdirSync(evidence, { recursive: true });
const trial = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-packaged-app-"));
const localHome =
  mode === "local" && !args["preflight-only"] ? ownedLocalHome() : null;
const agentHome = localHome || path.join(trial, "agent-home");
const desktopHome = localHome
  ? path.dirname(localHome)
  : path.join(trial, "desktop-home");
const userData = path.join(trial, "desktop-user-data");
for (const folder of [agentHome, desktopHome, userData])
  fs.mkdirSync(folder, { recursive: true });
const expectedVersion =
  typeof args["expected-version"] === "string"
    ? args["expected-version"]
    : sourcePackage.version;
const token = randomBytes(24).toString("hex");
const children = [];
const providerRequests = [];
const pageErrors = [];
const consoleErrors = [];
const wireFrames = [];
const settingsBackups = [];
const fixtureSecrets = new Set([token]);
let application;
let page;
let provider;
let mainLog = "";
let stage = "archive preflight";
const report = {
  mode,
  executablePath,
  expectedVersion,
  agentRef: args["agent-ref"] || "explicit isolated Agent source",
  checks: [],
  screenshots: [],
  limitations: [
    "The application is the supplied packaged executable; this does not install a signed DMG or exercise auto-update.",
    mode === "local"
      ? "The UI uses an explicitly marked temporary managed installation; installation provisioning has its own report."
      : "The UI exercises direct Remote token setup on localhost. Local and SSH wire tiers have separate live runners.",
    "Agent construction and clarify tool execution are real; model responses are scripted localhost fixtures, not ML inference.",
    "No real account, OAuth identity, external deployment, user session or provider credential is used.",
  ],
};

function safeText(value) {
  let result = String(value);
  for (const secret of fixtureSecrets)
    result = result.split(secret).join("[fixture-token]");
  return result;
}

function writeFixtureSetting(name, content) {
  const filename = path.join(agentHome, name);
  if (localHome)
    settingsBackups.push({
      filename,
      original: fs.existsSync(filename) ? fs.readFileSync(filename) : null,
    });
  fs.writeFileSync(filename, content);
}

// @lat: [[compatibility-validation#Packaged application acceptance]]
function verifyArchive() {
  assert.ok(
    fs.existsSync(executablePath),
    `Packaged executable does not exist: ${executablePath}`,
  );
  const archive = path.resolve(
    path.dirname(executablePath),
    "../Resources/app.asar",
  );
  const raw = asar.getRawHeader(archive);
  const entries = asar.listPackage(archive);
  const allowed = new Set([
    "out",
    "resources",
    "node_modules",
    "package.json",
    "LICENSE",
  ]);
  const result = {
    archive,
    packedFiles: 0,
    unpackedFiles: 0,
    links: 0,
    verifiedBytes: 0,
    entries: entries.length,
  };
  report.archive = result;
  const walk = (files, prefix = "") => {
    for (const [name, entry] of Object.entries(files)) {
      const relative = prefix ? `${prefix}/${name}` : name;
      assert.ok(
        allowed.has(relative.split("/")[0]),
        `Unexpected development/root payload: ${relative}`,
      );
      assert.ok(
        name !== ".env" && !name.startsWith(".env."),
        `Environment file packaged: ${relative}`,
      );
      if (entry.files) {
        walk(entry.files, relative);
        continue;
      }
      if (entry.link) {
        result.links += 1;
        continue;
      }
      assert.equal(
        entry.integrity?.algorithm,
        "SHA256",
        `Missing SHA-256 integrity: ${relative}`,
      );
      const bytes = entry.unpacked
        ? fs.readFileSync(
            path.join(`${archive}.unpacked`, ...relative.split("/")),
          )
        : asar.extractFile(archive, relative);
      assert.equal(
        bytes.length,
        entry.size,
        `Archive size mismatch: ${relative}`,
      );
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        entry.integrity.hash,
        `Archive integrity mismatch: ${relative}`,
      );
      if (entry.unpacked) result.unpackedFiles += 1;
      else result.packedFiles += 1;
      result.verifiedBytes += bytes.length;
    }
  };
  walk(raw.header.files);
  const metadata = JSON.parse(
    asar.extractFile(archive, "package.json").toString("utf8"),
  );
  assert.equal(
    metadata.version,
    expectedVersion,
    "Packaged metadata version differs from candidate",
  );
  assert.equal(
    metadata.main,
    sourcePackage.main,
    "Packaged main entry differs from candidate",
  );
  assert.ok(
    entries.includes(`/${metadata.main.replace(/^\.\//, "")}`),
    "Packaged main entry is absent",
  );
  result.version = metadata.version;
  result.main = metadata.main;
  result.sha256 = createHash("sha256")
    .update(fs.readFileSync(archive))
    .digest("hex");
  report.checks.push({
    name: "ASAR integrity and payload allowlist",
    passed: true,
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function until(check, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await check();
    if (found) return found;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function screenshot(name) {
  const filename = path.join(evidence, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  report.screenshots.push(filename);
}

/** Same deterministic clarify exchange as the separate actual-Agent chat tier. */
function createProvider() {
  return http.createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "compat-local-model",
              object: "model",
              owned_by: "local-fixture",
            },
          ],
        }),
      );
      return;
    }
    let text = "";
    for await (const chunk of request) text += chunk;
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    const tools = (body.tools || []).map((tool) => tool.function?.name);
    const toolResults = (body.messages || [])
      .filter((message) => message.role === "tool")
      .map((message) => message.content);
    providerRequests.push({
      path: request.url,
      model: body.model,
      stream: body.stream === true,
      tools,
      toolResults,
    });
    let final = "COMPAT_AUX_OK";
    if (toolResults.length) {
      try {
        const result = JSON.parse(toolResults.at(-1));
        final =
          result.outcome === "submitted" &&
          result.responses?.[0]?.user_response === "Local" &&
          result.responses?.[1]?.user_response === "Dubai"
            ? "COMPAT_ACTUAL_AGENT_OK"
            : "COMPAT_INVALID_TOOL_RESULT";
      } catch {
        final = "COMPAT_INVALID_TOOL_RESULT";
      }
    }
    const callTool = tools.includes("clarify") && !toolResults.length;
    const toolCall = {
      id: "call_packaged_clarify",
      type: "function",
      function: {
        name: "clarify",
        arguments: JSON.stringify({
          questions: [
            { question: "Which target?", choices: ["Local", "Remote"] },
            { question: "Which region?" },
          ],
        }),
      },
    };
    const common = {
      id: "chatcmpl-packaged-fixture",
      created: Math.floor(Date.now() / 1000),
      model: "compat-local-model",
    };
    if (body.stream) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      const frame = (delta, finish_reason = null) => ({
        ...common,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta, finish_reason }],
      });
      for (const chunk of [
        frame({ role: "assistant" }),
        frame(
          callTool
            ? { tool_calls: [{ index: 0, ...toolCall }] }
            : { content: final },
        ),
        frame({}, callTool ? "tool_calls" : "stop"),
      ])
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ...common,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: callTool
                ? { role: "assistant", content: null, tool_calls: [toolCall] }
                : { role: "assistant", content: final },
              finish_reason: callTool ? "tool_calls" : "stop",
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        }),
      );
    }
  });
}

async function startBackend() {
  provider = createProvider();
  await new Promise((resolve, reject) =>
    provider.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const providerPort = provider.address().port;
  if (localHome) {
    writeFixtureSetting(
      "config.yaml",
      `_config_version: 12\nmodel:\n  default: compat-local-model\n  provider: custom\n  base_url: "http://127.0.0.1:${providerPort}/v1"\n  context_length: 128000\nplatform_toolsets:\n  cli: [clarify]\nsecurity:\n  allow_lazy_installs: false\nnous:\n  guest: false\ncompression:\n  enabled: false\nterminal:\n  backend: local\n  cwd: ${JSON.stringify(agentHome)}\nagent:\n  max_turns: 5\n`,
    );
    writeFixtureSetting(
      ".env",
      `CUSTOM_API_KEY=local-fixture-not-a-credential\nOPENAI_API_KEY=local-fixture-not-a-credential\nAPI_SERVER_KEY=${token}\n`,
    );
    report.localInstallation = {
      hermesHome: localHome,
      home: desktopHome,
      launcher: path.join(localHome, "hermes-agent/.hermes/bin/hermes"),
      settingsRestoredOnExit: true,
      fixtureKeys: [
        "CUSTOM_API_KEY and OPENAI_API_KEY are localhost dummy values",
        "API_SERVER_KEY is a generated fixture token matching normal Desktop setup",
      ],
    };
    report.backendStore =
      "Existing explicitly owned installation; the application starts its own managed serve process.";
    return null;
  }
  const agentRepo = path.resolve(args["agent-repo"]);
  const python = path.resolve(args.python);
  assert.ok(
    fs.existsSync(path.join(agentRepo, "tui_gateway/server.py")),
    "Explicit Agent source is incomplete",
  );
  writeFixtureSetting(
    "config.yaml",
    JSON.stringify(
      {
        model: {
          default: "compat-local-model",
          provider: "custom:fixture",
          context_length: 128000,
        },
        providers: {
          fixture: {
            name: "fixture",
            base_url: `http://127.0.0.1:${providerPort}/v1`,
            api_key: "local-fixture-not-a-credential",
            api_mode: "chat_completions",
          },
        },
        platform_toolsets: { cli: ["clarify"] },
        security: { allow_lazy_installs: false },
        nous: { guest: false },
        compression: { enabled: false },
        terminal: { backend: "local", cwd: agentHome },
        agent: { max_turns: 5 },
      },
      null,
      2,
    ),
  );
  const port = await freePort();
  const code = `import sys\nsys.path.insert(0, ${JSON.stringify(agentRepo)})\nfrom hermes_cli import web_server\nweb_server.start_server(host='127.0.0.1', port=${port}, open_browser=False, headless=True, isolated=True)\n`;
  report.backendStore =
    "Fresh home; no state.db schema or conversations seeded.";
  const log = fs.openSync(path.join(trial, "agent.log"), "w");
  const backend = spawn(python, ["-u", "-c", code], {
    cwd: agentHome,
    env: {
      PATH: process.env.PATH,
      LANG: "en_US.UTF-8",
      HOME: agentHome,
      HERMES_HOME: agentHome,
      HERMES_DASHBOARD_SESSION_TOKEN: token,
      HERMES_SERVE_HEADLESS: "1",
      HERMES_DESKTOP: "1",
      HERMES_IGNORE_RULES: "1",
      HERMES_TUI_TOOLSETS: "clarify",
      PYTHONDONTWRITEBYTECODE: "1",
    },
    stdio: ["ignore", log, log],
  });
  fs.closeSync(log);
  backend.once("error", (error) => {
    backend.fixtureError = error;
  });
  children.push(backend);
  const endpoint = `http://127.0.0.1:${port}`;
  await until(async () => {
    if (backend.fixtureError) throw backend.fixtureError;
    if (backend.exitCode !== null)
      throw new Error(`Agent exited ${backend.exitCode}`);
    try {
      return (
        await fetch(`${endpoint}/api/status`, {
          headers: { "X-Hermes-Session-Token": token },
        })
      ).ok;
    } catch {
      return false;
    }
  }, "actual Agent backend startup");
  report.backendProbes = [];
  for (const [route, credential] of [
    ["/api/status", "none"],
    ["/api/sessions?limit=1", "fixture"],
    ["/api/profiles", "fixture"],
    ["/api/profiles", "invalid"],
  ]) {
    const value = credential === "invalid" ? "invalid-fixture-token" : token;
    const result = await fetch(`${endpoint}${route}`, {
      headers:
        credential === "none"
          ? undefined
          : {
              Authorization: `Bearer ${value}`,
              "X-Hermes-Session-Token": value,
            },
    });
    report.backendProbes.push({
      route,
      credential,
      status: result.status,
      contentType: result.headers.get("content-type"),
    });
    await result.arrayBuffer();
  }
  return endpoint;
}

async function runUi(endpoint) {
  stage = "packaged application startup";
  application = await _electron.launch({
    executablePath,
    cwd: desktopHome,
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      LANG: "en_US.UTF-8",
      HOME: desktopHome,
      HERMES_HOME: localHome || desktopHome,
      HERMES_DESKTOP_USER_DATA_DIR: userData,
      HERMES_API_URL: "http://127.0.0.1:9",
      HERMES_API_KEY: "local-fixture",
      ...(localHome
        ? { HERMES_IGNORE_RULES: "1", HERMES_TUI_TOOLSETS: "clarify" }
        : {}),
      ELECTRON_ENABLE_LOGGING: "1",
    },
  });
  const electronProcess = application.process();
  for (const stream of [electronProcess.stdout, electronProcess.stderr])
    stream?.on("data", (data) => {
      mainLog += safeText(data);
    });
  const observedWindows = new WeakSet();
  const observe = (window) => {
    if (observedWindows.has(window)) return;
    observedWindows.add(window);
    window.on("websocket", (socket) => {
      const record = (direction, payload) => {
        try {
          const frame = JSON.parse(String(payload));
          wireFrames.push({
            direction,
            method: frame.method,
            id: frame.id,
            type: frame.type || frame.params?.type,
            sessionId:
              frame.session_id ||
              frame.params?.session_id ||
              frame.result?.session_id,
            questionCount:
              frame.method === "clarify"
                ? frame.params?.questions?.length
                : undefined,
            resultKeys:
              frame.result && typeof frame.result === "object"
                ? Object.keys(frame.result)
                : undefined,
            desktopContract: frame.result?.info?.desktop_contract,
            errorCode: frame.error?.code,
          });
        } catch {
          /* Keep frame contents, including any credential, out of reports. */
        }
      };
      socket.on("framesent", ({ payload }) => record("sent", payload));
      socket.on("framereceived", ({ payload }) => record("received", payload));
    });
    window.on("pageerror", (error) =>
      pageErrors.push(safeText(error.stack || error)),
    );
    window.on("console", (message) => {
      if (message.type() === "error")
        consoleErrors.push(safeText(message.text()));
    });
  };
  application.on("window", observe);
  page = await application.firstWindow({ timeout: 60000 });
  observe(page);
  page.setDefaultTimeout(30000);
  await page.waitForLoadState("domcontentloaded");
  const runtime = await application.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
    arch: process.arch,
    appPath: app.getAppPath(),
  }));
  assert.equal(runtime.packaged, true, "The launched app is not packaged");
  assert.equal(runtime.version, expectedVersion);
  assert.equal(
    path.resolve(runtime.userData),
    path.resolve(userData),
    "Electron user data escaped the isolated fixture",
  );
  report.runtime = runtime;

  const composer = page
    .locator(".chat-container:visible textarea.chat-input")
    .first();
  if (mode === "remote") {
    stage = "Welcome and Remote connection UI";
    await page
      .getByRole("heading", { name: "Welcome to Hermes One", exact: true })
      .waitFor({ state: "visible", timeout: 60000 });
    await page
      .locator('.onboard-screen[data-phase="done"]')
      .waitFor({ state: "visible" });
    await screenshot("01-welcome");
    await page
      .getByRole("button", { name: "Connect to Remote Hermes", exact: true })
      .click();
    await page
      .getByPlaceholder("http://192.168.1.100:8642", { exact: true })
      .fill(endpoint);
    await page
      .getByPlaceholder("Bearer token (API_SERVER_KEY)", { exact: true })
      .fill(token);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await until(async () => {
      const failure = page.locator(".welcome-remote-error").first();
      if (await failure.isVisible())
        throw new Error(
          `Remote connection UI rejected the fixture: ${await failure.innerText()}`,
        );
      return composer.isVisible();
    }, "Remote UI connection to composer");
    report.checks.push({
      name: "Welcome and Remote token connection through UI",
      passed: true,
    });
  } else {
    stage = "Local managed installation startup";
    await composer.waitFor({ state: "visible", timeout: 60000 });
    const install = await page.evaluate(() => window.hermesAPI.checkInstall());
    assert.equal(install.installed, true);
    assert.equal(install.hasApiKey, true);
    report.checks.push({
      name: "Existing managed Local installation opens the actual composer",
      passed: true,
      install,
    });
  }

  // This fresh-state modal mounts only after connectionModeLoaded && readiness.ok.
  stage = "chat connection configuration readiness";
  const initialFollow = page.locator(".follow-us-modal");
  await initialFollow.waitFor({ state: "visible", timeout: 60000 });
  await initialFollow
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.addLocatorHandler(
    page.locator(".follow-us-modal"),
    async (modal) => {
      await modal.getByRole("button", { name: "Close", exact: true }).click();
    },
  );
  if (localHome) await screenshot("01-local-ready");
  report.checks.push({
    name: "Chat connection configuration and readiness committed",
    passed: true,
  });
  const previousSessions = await page
    .evaluate(() => window.hermesAPI.listSessions(100, 0))
    .catch((error) => {
      if (!fs.existsSync(path.join(agentHome, "state.db"))) return [];
      throw error;
    });
  const previousSessionIds = new Set(
    previousSessions.map((session) => session.id),
  );
  report.existingSessions = previousSessions.length;

  stage = "actual composer and multi-question clarification";
  const prompt =
    "Packaged compatibility: exercise the clarification tool, then report the fixture result.";
  const admissionError =
    "Connection settings changed before this message could be sent. Try again on the current connection.";
  const clarify = page
    .locator(".chat-container:visible .chat-clarify-group")
    .first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await composer.fill(prompt);
    await page.locator(".chat-container:visible button.chat-send-btn").click();
    const outcome = await until(
      async () => {
        if (await clarify.isVisible()) return "clarify";
        if (await page.getByText(admissionError, { exact: true }).isVisible())
          return "admission-error";
        return null;
      },
      "real clarification or explicit pre-send admission error",
      90000,
    );
    if (outcome === "clarify") break;
    assert.equal(
      attempt,
      0,
      "Connection admission failed again after the sole safe retry",
    );
    assert.equal(
      providerRequests.length,
      0,
      "Refusing retry after any provider request",
    );
    assert.equal(
      await page.locator(".chat-container:visible .chat-bubble-user").count(),
      0,
      "Refusing retry after a user turn was admitted",
    );
    assert.equal(
      await page.locator(".sidebar-recent-session").count(),
      0,
      "Refusing retry after any saved chat appeared",
    );
    const saved = await page
      .evaluate(() => window.hermesAPI.listSessions(20, 0))
      .catch((error) => {
        if (!fs.existsSync(path.join(agentHome, "state.db"))) return [];
        throw error;
      });
    assert.equal(
      saved.length,
      0,
      "Refusing retry after a stored session was created",
    );
    report.sendAdmissionRetry = {
      reason: admissionError,
      providerRequests: 0,
      userBubbles: 0,
      savedSessions: 0,
    };
  }
  await clarify
    .getByRole("button", { name: /^Local(?: \(Recommended\))?$/ })
    .click();
  await clarify
    .getByRole("textbox", { name: "Which region?", exact: true })
    .fill("Dubai");
  await screenshot("02-clarification");
  await clarify.getByRole("button", { name: "Send", exact: true }).click();
  const finalBubble = () =>
    page
      .locator(".chat-container:visible .chat-bubble-agent")
      .filter({ hasText: "COMPAT_ACTUAL_AGENT_OK" })
      .first();
  await finalBubble().waitFor({ state: "visible", timeout: 90000 });
  const interactive = wireFrames.filter(
    (frame) => frame.direction === "received" && frame.method === "clarify",
  );
  assert.equal(
    interactive.length,
    1,
    "Expected one batched clarification server request",
  );
  assert.ok(
    wireFrames.some(
      (frame) =>
        frame.direction === "sent" &&
        frame.id === interactive[0].id &&
        frame.resultKeys?.includes("answers"),
    ),
    "Clarification was not answered with its matching server request id",
  );
  assert.ok(
    wireFrames.some((frame) => frame.desktopContract === 8),
    "Current Agent contract8 was not observed",
  );
  report.checks.push({
    name: "Contract8 batch clarification answered with matching request id",
    passed: true,
    requestId: interactive[0].id,
    questionCount: interactive[0].questionCount,
  });
  assert.ok(
    providerRequests.some((request) =>
      request.toolResults.some((value) =>
        value.includes('"user_response": "Dubai"'),
      ),
    ),
    "Real tool answers did not reach the scripted provider",
  );
  await screenshot("03-completed-chat");
  if (localHome) {
    const owned = await page.evaluate(() => window.hermesAPI.dashboardStatus());
    if (owned.connection?.token) fixtureSecrets.add(owned.connection.token);
    assert.equal(
      owned.running,
      true,
      owned.error || "Local backend is not running",
    );
    assert.equal(owned.connection?.mode, "local");
    assert.ok(
      owned.connection?.pid,
      "Application did not start its own Local backend",
    );
    report.localBackend = {
      mode: owned.connection.mode,
      pid: owned.connection.pid,
      baseUrl: owned.connection.baseUrl,
      logPath: owned.connection.logPath,
    };
  }
  const sessions = await page.evaluate(() =>
    window.hermesAPI.listSessions(20, 0),
  );
  const created = sessions.filter(
    (session) => !previousSessionIds.has(session.id),
  );
  assert.equal(
    created.length,
    1,
    "Expected exactly one new actual Agent conversation",
  );
  const saved = created[0];
  // Streamed text may render before the Agent finishes its durable transaction.
  const rows = await until(
    async () => {
      const items = await page.evaluate(
        (id) => window.hermesAPI.getSessionMessages(id),
        saved.id,
      );
      const hasFinal = items.some(
        (row) =>
          typeof row.content === "string" &&
          row.content.includes("COMPAT_ACTUAL_AGENT_OK"),
      );
      report.historyObservation = {
        count: items.length,
        kinds: items.map((item) => item.kind),
        hasFinal,
      };
      return items.length >= 4 && hasFinal ? items : null;
    },
    "complete actual Agent persisted history",
    30000,
  );
  report.checks.push({
    name: "Actual Agent composer, real batch clarify and completion",
    passed: true,
    persistedRows: rows.length,
    sessionId: saved.id,
  });

  stage = "saved history restoration through UI";
  await page.reload();
  await page
    .getByRole("button", { name: "New Chat", exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
  const recent = page.locator(".sidebar-recent-session").first();
  await recent.waitFor({ state: "visible", timeout: 60000 });
  await recent.click();
  await finalBubble().waitFor({ state: "visible", timeout: 60000 });
  await screenshot("04-restored-history");
  report.checks.push({
    name: "Saved conversation restored after renderer reload through sidebar",
    passed: true,
  });

  stage = "About version UI";
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.locator(".settings-modal");
  await settings
    .getByRole("button", { name: "About & Updates", exact: true })
    .click();
  await settings
    .getByText(`v${expectedVersion}`, { exact: true })
    .first()
    .waitFor({ state: "visible" });
  await screenshot("05-about");
  report.checks.push({
    name: "About shows candidate desktop version",
    passed: true,
    version: expectedVersion,
  });

  stage = "packaged native SQLite";
  const sqlite = await application.evaluate(({ app }) => {
    const runtimeRequire = process
      .getBuiltinModule("module")
      .createRequire(`${app.getAppPath()}/package.json`);
    const Database = runtimeRequire("better-sqlite3");
    const db = new Database(":memory:");
    try {
      return db
        .prepare("SELECT sqlite_version() AS version, ? AS marker")
        .get("packaged-native-sqlite");
    } finally {
      db.close();
    }
  });
  assert.equal(sqlite.marker, "packaged-native-sqlite");
  report.checks.push({
    name: "Packaged native better-sqlite3 executes under Electron",
    passed: true,
    sqliteVersion: sqlite.version,
  });
  assert.deepEqual(pageErrors, [], "Renderer page errors occurred");
  assert.doesNotMatch(
    mainLog,
    /uncaught(?:exception| exception)|UnhandledPromiseRejection|ERR_DLOPEN_FAILED|Cannot find module|wrong architecture|mach-o.*incompatible/i,
    "Main-process fatal error occurred",
  );
  report.checks.push({
    name: "No renderer page errors or main fatal errors",
    passed: true,
  });
}

try {
  verifyArchive();
  if (!args["preflight-only"]) await runUi(await startBackend());
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.stage = stage;
  report.error = safeText(error.stack || error);
  report.logs = trial;
  if (page && !page.isClosed()) {
    try {
      report.uiBody = safeText(await page.locator("body").innerText());
      const status = await page.evaluate(() =>
        window.hermesAPI.dashboardStatus(),
      );
      if (status.connection?.token) fixtureSecrets.add(status.connection.token);
      report.dashboardFailureStatus = {
        supported: status.supported,
        running: status.running,
        error: safeText(status.error || ""),
        mode: status.connection?.mode,
        pid: status.connection?.pid,
      };
      await screenshot("failure");
    } catch {
      /* Keep the original failure. */
    }
  }
} finally {
  if (application) {
    try {
      await application.close();
    } catch {
      application.process().kill("SIGTERM");
    }
  }
  for (const child of children) child.kill("SIGTERM");
  const deadline = Date.now() + 3000;
  while (
    children.some(
      (child) => child.exitCode === null && child.signalCode === null,
    ) &&
    Date.now() < deadline
  )
    await delay(50);
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  if (provider) await new Promise((resolve) => provider.close(resolve));
  if (localHome && fs.existsSync(path.join(localHome, "dashboard-stderr.log")))
    fs.writeFileSync(
      path.join(evidence, "local-agent.log"),
      safeText(
        fs.readFileSync(path.join(localHome, "dashboard-stderr.log"), "utf8"),
      ),
    );
  for (const setting of settingsBackups.reverse()) {
    if (setting.original === null) fs.rmSync(setting.filename, { force: true });
    else fs.writeFileSync(setting.filename, setting.original);
  }
  fs.writeFileSync(path.join(evidence, "main.log"), safeText(mainLog));
  if (fs.existsSync(path.join(trial, "agent.log")))
    fs.writeFileSync(
      path.join(evidence, "agent.log"),
      safeText(fs.readFileSync(path.join(trial, "agent.log"), "utf8")),
    );
}
report.pageErrors = pageErrors;
report.consoleErrors = consoleErrors;
report.wireFrames = wireFrames;
report.providerRequests = providerRequests;
report.preflightOnly = !!args["preflight-only"];
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
if (report.passed) fs.rmSync(trial, { recursive: true, force: true });
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
