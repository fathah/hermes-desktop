// provider-flow-smoke.mjs - deterministic P0 provider credential proof.
//
// Usage: npm run build && node scripts/provider-flow-smoke.mjs
//
// Launches the built Electron app against a throwaway HERMES_HOME and verifies:
// - installed/no-key startup routes to Setup
// - Setup saves an API-key provider through the keychain marker path
// - Providers can update and remove that API key without plaintext .env/log leaks
// - relaunch after removal returns to the no-key Setup gate
// - OAuth sign-in/out uses the existing modal and auth-store IPC path
import { _electron as electron } from "playwright";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const HOME = mkdtempSync(join(tmpdir(), "hermes-provider-flow-"));
const FIRST_KEY = "sk-or-provider-flow-first-0000000000";
const SECOND_KEY = "sk-or-provider-flow-second-1111111111";
const THIRD_KEY = "sk-or-provider-flow-third-2222222222";
const SECRETS = [FIRST_KEY, SECOND_KEY, THIRD_KEY];
const logLines = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf-8") : "";
}

function readJson(file) {
  const text = readText(file);
  return text ? JSON.parse(text) : {};
}

function keychainValue(profile, key) {
  const store = readJson(join(HOME, "fake-keychain.json"));
  return store[profile + ":" + key] || "";
}

function assertNoSecretLeak(stage) {
  const envText = readText(join(HOME, ".env"));
  const logText = logLines.join("\n");
  for (const secret of SECRETS) {
    assert(
      !envText.includes(secret),
      stage + ": plaintext secret leaked to .env",
    );
    assert(
      !logText.includes(secret),
      stage + ": plaintext secret leaked to app logs",
    );
  }
}

function assertOpenRouterEnv(markerExpected) {
  const envText = readText(join(HOME, ".env"));
  assert(
    envText.includes("OPENROUTER_API_KEY="),
    "OPENROUTER_API_KEY line missing from .env",
  );
  if (markerExpected) {
    assert(
      envText.includes("OPENROUTER_API_KEY=__keychain__"),
      "OPENROUTER_API_KEY did not use the keychain marker",
    );
  } else {
    assert(
      !envText.includes("OPENROUTER_API_KEY=__keychain__"),
      "removed OPENROUTER_API_KEY still has a keychain marker",
    );
  }
}

async function waitUntil(label, check, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for " + label);
}

function seedHermesHome() {
  mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
  const pythonShim = join(HOME, "hermes-agent", "venv", "bin", "python");
  writeFileSync(
    pythonShim,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const home = process.env.HERMES_HOME;
const keychainFile = path.join(home, "fake-keychain.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function profileHome(profile) {
  return !profile || profile === "default"
    ? home
    : path.join(home, "profiles", profile);
}

function authFile(profile) {
  return path.join(profileHome(profile), "auth.json");
}

function handleJsonProtocol() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    try {
      const req = JSON.parse(line);
      let result = { ok: true };
      if (req.cmd === "search") result = { results: [] };
      else if (req.cmd === "graph") result = { nodes: [], edges: [] };
      else if (req.cmd === "rag") result = { context: [] };
      else if (req.cmd === "status") result = { ok: true, txtai_installed: false };
      else if (req.cmd === "index") result = { ok: true, engine: "provider-flow-smoke", notes: 0 };
      else result = { error: "Unknown command: " + req.cmd };
      console.log(JSON.stringify({ id: req.id, result }));
    } catch (err) {
      console.log(JSON.stringify({ id: 0, error: String(err && err.message ? err.message : err) }));
    }
  });
}

let args = process.argv.slice(2);
if (args[0] && args[0].endsWith(path.join("hermes-agent", "hermes"))) {
  args = args.slice(1);
}

if (args.length === 0) {
  handleJsonProtocol();
} else if (args.includes("--version")) {
  console.log("hermes-provider-flow-smoke 0.0.0");
} else if (args[0] === "config" && args[1] === "set-secret") {
  const profile = args[2] || "default";
  const key = args[3] || "";
  const value = args[4] || "";
  const store = readJson(keychainFile);
  store[profile + ":" + key] = value;
  writeJson(keychainFile, store);
  console.log("ok");
} else if (args[0] === "config" && args[1] === "get-secret") {
  const profile = args[2] || "default";
  const key = args[3] || "";
  const store = readJson(keychainFile);
  console.log(store[profile + ":" + key] || "");
} else {
  let profile = "default";
  if (args[0] === "-p") {
    profile = args[1] || "default";
    args = args.slice(2);
  }
  if (args[0] === "auth" && args[1] === "add" && args[3] === "--type" && args[4] === "oauth") {
    const provider = args[2];
    const file = authFile(profile);
    const store = readJson(file);
    if (!store.providers || typeof store.providers !== "object") {
      store.providers = {};
    }
    store.providers[provider] = {
      auth_type: "oauth_device_code",
      access_token: "oauth-provider-flow-token-" + provider,
      refresh_token: "oauth-provider-flow-refresh-" + provider,
      source: "provider-flow-smoke"
    };
    store.active_provider = provider;
    writeJson(file, store);
    console.log("OAuth sign-in complete for " + provider);
  } else {
    console.error("Unsupported fake Hermes command: " + args.join(" "));
    process.exit(1);
  }
}
`,
    "utf-8",
  );
  chmodSync(pythonShim, 0o755);
  writeFileSync(join(HOME, "hermes-agent", "hermes"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(HOME, "hermes-agent", "hermes"), 0o755);
  writeFileSync(
    join(HOME, "desktop.json"),
    JSON.stringify(
      { onboardingCompleted: true, schedulerEnabled: false },
      null,
      2,
    ),
    "utf-8",
  );
  writeFileSync(
    join(HOME, "config.yaml"),
    [
      "model:",
      "  provider: openrouter",
      "  default: openai/gpt-4o",
      "  base_url: https://openrouter.ai/api/v1",
      "",
    ].join("\n"),
    "utf-8",
  );
}

async function launchApp(label) {
  const app = await electron.launch({
    args: [".", "--user-data-dir=" + join(HOME, "electron-userdata-" + label)],
    env: {
      ...process.env,
      HERMES_HOME: HOME,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
  const child = app.process();
  child.stdout?.on("data", (chunk) =>
    logLines.push("stdout:" + chunk.toString()),
  );
  child.stderr?.on("data", (chunk) =>
    logLines.push("stderr:" + chunk.toString()),
  );
  const win = await app.firstWindow();
  win.on("console", (message) => logLines.push("renderer:" + message.text()));
  await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector(".app", { timeout: 30000 });
  return { app, win };
}

async function waitForSetup(win) {
  await win.locator(".setup-screen").waitFor({
    state: "visible",
    timeout: 30000,
  });
}

async function waitForWorkspace(win) {
  await win.locator(".sps-scope").waitFor({
    state: "visible",
    timeout: 30000,
  });
}

async function saveOpenRouterThroughSetup(win, apiKey) {
  await waitForSetup(win);
  const setup = win.locator(".setup-screen");
  await setup.locator(".setup-input-group input").fill(apiKey);
  await setup.locator(".setup-continue").click();
  await waitForWorkspace(win);
}

async function openAiSetup(win) {
  await win.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("hermes:open-settings", {
        detail: { view: "aiSetup" },
      }),
    );
  });
  await win.getByRole("heading", { name: "AI Setup" }).waitFor({
    state: "visible",
    timeout: 30000,
  });
}

async function openRouterCard(win) {
  const card = win
    .locator(".provider-key-card")
    .filter({ hasText: "OpenRouter API Key" })
    .first();
  await card.locator("input").waitFor({ state: "visible", timeout: 30000 });
  return card;
}

async function nousOAuthCard(win) {
  const card = win
    .locator(".provider-key-card")
    .filter({ hasText: "Nous Portal (OAuth)" })
    .first();
  await card.waitFor({ state: "visible", timeout: 30000 });
  return card;
}

seedHermesHome();
console.log("HERMES_HOME=" + HOME);

let app;
let win;

try {
  ({ app, win } = await launchApp("first"));
  await waitForSetup(win);
  assert(!existsSync(join(HOME, ".env")), "no-key startup created .env early");

  await saveOpenRouterThroughSetup(win, FIRST_KEY);
  assertOpenRouterEnv(true);
  assert(
    keychainValue("default", "OPENROUTER_API_KEY") === FIRST_KEY,
    "initial OpenRouter key was not stored in fake keychain",
  );
  assertNoSecretLeak("setup save");

  await openAiSetup(win);
  let card = await openRouterCard(win);
  await card.locator("input").fill(SECOND_KEY);
  await card.getByRole("button", { name: "Add key" }).click();
  await waitUntil(
    "updated OpenRouter fake keychain value",
    () => keychainValue("default", "OPENROUTER_API_KEY") === SECOND_KEY,
  );
  assertOpenRouterEnv(true);
  assertNoSecretLeak("provider update");

  card = await openRouterCard(win);
  await card.getByRole("button", { name: "Remove OpenRouter API Key" }).click();
  await waitUntil(
    "removed OpenRouter keychain marker",
    () =>
      readText(join(HOME, ".env")).includes("OPENROUTER_API_KEY=") &&
      !readText(join(HOME, ".env")).includes(
        "OPENROUTER_API_KEY=__keychain__",
      ) &&
      keychainValue("default", "OPENROUTER_API_KEY") === "",
  );
  assertOpenRouterEnv(false);
  assertNoSecretLeak("provider remove");

  await app.close();
  app = undefined;

  ({ app, win } = await launchApp("after-remove"));
  await waitForSetup(win);
  assertNoSecretLeak("relaunch no-key gate");

  await saveOpenRouterThroughSetup(win, THIRD_KEY);
  assertOpenRouterEnv(true);
  assert(
    keychainValue("default", "OPENROUTER_API_KEY") === THIRD_KEY,
    "third OpenRouter key was not stored in fake keychain",
  );

  await openAiSetup(win);
  const nous = await nousOAuthCard(win);
  await nous.getByRole("button", { name: /Sign in/i }).click();
  await win
    .locator(".oauth-login-result-success")
    .waitFor({ state: "visible", timeout: 30000 });
  await win.locator(".models-modal-footer .btn").click();
  await nous.getByText("Signed in").waitFor({ timeout: 30000 });

  let auth = readJson(join(HOME, "auth.json"));
  assert(
    auth.providers?.nous?.access_token === "oauth-provider-flow-token-nous",
    "OAuth sign-in did not persist Nous provider credentials",
  );

  await nous.getByRole("button", { name: "Remove local sign-in" }).click();
  await nous.getByRole("button", { name: /Sign in/i }).waitFor({
    state: "visible",
    timeout: 30000,
  });
  auth = readJson(join(HOME, "auth.json"));
  assert(!auth.providers?.nous, "OAuth sign-out left providers.nous behind");
  assert(
    !auth.credential_pool?.nous,
    "OAuth sign-out left credential_pool.nous behind",
  );
  assert(
    auth.active_provider !== "nous",
    "OAuth sign-out left active_provider",
  );
  assertNoSecretLeak("oauth flow");

  console.log("PROVIDER_FLOW_SMOKE_OK");
} finally {
  if (app) {
    await app.close().catch(() => {});
  }
}
