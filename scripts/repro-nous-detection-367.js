/**
 * Live verification of the #367 Bug 4 fix in PR #369.
 *
 * Setup: switch the active model's provider to "nous" with no
 * NOUS_API_KEY in .env and no Nous evidence in auth.json. Then:
 *
 *   1. validateChatReadiness() should return ok:false with
 *      MISSING_API_KEY / NOUS_API_KEY.
 *   2. getConfigHealth() should report a MODEL_KEY_MISSING issue
 *      with context.provider="nous" and context.expectedKey="NOUS_API_KEY".
 *   3. After dropping a properly-shaped credential into auth.json,
 *      both checks should clear.
 *
 * Pre-fix (the gap this commit closes): all checks fail open and the
 * user gets no warning until the chat itself errors with "Hermes is
 * not logged into Nous Portal".
 */
const { attach } = require("./e2e-attach");
const fs = require("fs");
const path = require("path");
const os = require("os");

const HERMES_HOME = path.join(os.homedir(), "AppData", "Local", "hermes");
const CONFIG = path.join(HERMES_HOME, "config.yaml");
const ENV_FILE = path.join(HERMES_HOME, ".env");
const AUTH = path.join(HERMES_HOME, "auth.json");

const CONFIG_BAK = CONFIG + ".nous-test-bk";
const ENV_BAK = ENV_FILE + ".nous-test-bk";
const AUTH_BAK = AUTH + ".nous-test-bk";

function backup() {
  fs.copyFileSync(CONFIG, CONFIG_BAK);
  fs.copyFileSync(ENV_FILE, ENV_BAK);
  if (fs.existsSync(AUTH)) fs.copyFileSync(AUTH, AUTH_BAK);
}
function restore() {
  if (fs.existsSync(CONFIG_BAK)) {
    fs.copyFileSync(CONFIG_BAK, CONFIG);
    fs.unlinkSync(CONFIG_BAK);
  }
  if (fs.existsSync(ENV_BAK)) {
    fs.copyFileSync(ENV_BAK, ENV_FILE);
    fs.unlinkSync(ENV_BAK);
  }
  if (fs.existsSync(AUTH_BAK)) {
    fs.copyFileSync(AUTH_BAK, AUTH);
    fs.unlinkSync(AUTH_BAK);
  } else if (fs.existsSync(AUTH)) {
    fs.unlinkSync(AUTH);
  }
}

(async () => {
  backup();

  try {
    // Mutate config: provider=nous, no NOUS_API_KEY, no auth.json
    const cfg = fs.readFileSync(CONFIG, "utf-8");
    const cfgNew = cfg
      .replace(/^( *provider: ).*$/m, '$1"nous"')
      .replace(/^( *default: ).*$/m, '$1"hermes-4"');
    fs.writeFileSync(CONFIG, cfgNew);
    // Strip NOUS_API_KEY if present
    const env = fs.readFileSync(ENV_FILE, "utf-8");
    fs.writeFileSync(ENV_FILE, env.replace(/^NOUS_API_KEY=.*\n?/m, ""));
    // Remove nous entries from auth.json if any
    if (fs.existsSync(AUTH)) {
      const auth = JSON.parse(fs.readFileSync(AUTH, "utf-8"));
      if (auth.providers) delete auth.providers.nous;
      if (auth.credential_pool) delete auth.credential_pool.nous;
      fs.writeFileSync(AUTH, JSON.stringify(auth, null, 2));
    }

    const { browser, page } = await attach();

    // Bust the readEnv/getModelConfig caches by writing a dummy env entry
    await page.evaluate(async () => {
      await window.hermesAPI.setEnv("__NOUS_PROBE__", String(Date.now()));
      // Also trigger a model config reload — getModelConfig is cached
      // for 5s; invalidating it requires either a write or a wait.
    });
    // Trigger model config write to bust mc cache
    await page.evaluate(async () => {
      const mc = await window.hermesAPI.getModelConfig();
      await window.hermesAPI.setModelConfig(mc.provider, mc.model, mc.baseUrl);
    });

    // 1. validateChatReadiness
    const readiness = await page.evaluate(async () => {
      return await window.hermesAPI.validateChatReadiness();
    });
    console.log("[A] validateChatReadiness:", JSON.stringify(readiness));

    // 2. getConfigHealth
    const health = await page.evaluate(async () => {
      return await window.hermesAPI.getConfigHealth();
    });
    const modelKeyIssue = (health.issues || []).find(
      (i) => i.code === "MODEL_KEY_MISSING",
    );
    console.log(
      "[B] MODEL_KEY_MISSING issue:",
      JSON.stringify(modelKeyIssue || null),
    );

    // 3. Drop a properly-shaped credential pool entry → re-check
    const auth = fs.existsSync(AUTH)
      ? JSON.parse(fs.readFileSync(AUTH, "utf-8"))
      : { version: 1 };
    auth.credential_pool = auth.credential_pool || {};
    auth.credential_pool.nous = [
      {
        id: "test-nous-1",
        label: "Test Nous Key",
        auth_type: "api_key",
        access_token: "sk-nous-test-properly-shaped",
        base_url: "https://inference-api.nousresearch.com/v1",
        priority: 0,
      },
    ];
    fs.writeFileSync(AUTH, JSON.stringify(auth, null, 2));
    // Cache bust again
    await page.evaluate(async () => {
      await window.hermesAPI.setEnv("__NOUS_PROBE2__", String(Date.now()));
    });
    const readinessAfter = await page.evaluate(async () => {
      return await window.hermesAPI.validateChatReadiness();
    });
    const healthAfter = await page.evaluate(async () => {
      return await window.hermesAPI.rerunConfigHealth();
    });
    const modelKeyIssueAfter = (healthAfter.issues || []).find(
      (i) => i.code === "MODEL_KEY_MISSING",
    );
    console.log("[C] validateChatReadiness after adding pool entry:", JSON.stringify(readinessAfter));
    console.log(
      "[D] MODEL_KEY_MISSING issue after adding pool entry:",
      JSON.stringify(modelKeyIssueAfter || null),
    );

    await browser.close();

    console.log();
    const aBlocks = readiness.ok === false &&
      readiness.code === "MISSING_API_KEY" &&
      readiness.expectedEnvKey === "NOUS_API_KEY";
    const bFlags = modelKeyIssue &&
      modelKeyIssue.context?.expectedKey === "NOUS_API_KEY" &&
      modelKeyIssue.context?.provider === "nous";
    const cAllows = readinessAfter.ok === true;
    const dClears = !modelKeyIssueAfter;
    console.log(`[VERDICT A] ${aBlocks ? "✅" : "🔴"} validateChatReadiness blocks with MISSING_API_KEY / NOUS_API_KEY`);
    console.log(`[VERDICT B] ${bFlags ? "✅" : "🔴"} config-health flags MODEL_KEY_MISSING for nous`);
    console.log(`[VERDICT C] ${cAllows ? "✅" : "🔴"} validateChatReadiness clears after a properly-shaped pool entry`);
    console.log(`[VERDICT D] ${dClears ? "✅" : "🔴"} config-health MODEL_KEY_MISSING clears after pool entry`);
  } finally {
    restore();
    console.log("[teardown] config.yaml + .env + auth.json restored");
  }
})().catch((e) => {
  try { restore(); } catch {}
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
