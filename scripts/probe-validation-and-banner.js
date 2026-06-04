/**
 * Live probe for Piece 4 (pre-send validation) and Piece 5 (config-health
 * banner). Exercises both happy and unhappy paths in a single run.
 *
 * Setup expectation: dev electron running with ENABLE_CDP=1, active
 * model is DeepSeek (which is the case after the prior repro scripts).
 */
const { attach } = require("./e2e-attach");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ENV_FILE = path.join(os.homedir(), "AppData", "Local", "hermes", ".env");
const ENV_BACKUP = ENV_FILE + ".probe-validation-bk";

function readEnvKeys() {
  const m = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const mm = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (mm) m[mm[1]] = mm[2];
  }
  return m;
}

(async () => {
  const { browser, page } = await attach();

  // --- A. Happy path: validateChatReadiness should be OK as-configured ---
  const okState = await page.evaluate(async () => {
    return await window.hermesAPI.validateChatReadiness();
  });
  console.log("[A] happy path validateChatReadiness:", JSON.stringify(okState));

  // --- B. Remove DEEPSEEK_API_KEY from .env AND clear any deepseek
  //         credential-pool entries from auth.json. Both sources have
  //         to be empty for the validator to flag "missing key", since
  //         the engine accepts credentials from either location
  //         (the #367-driven extension to the validation path).
  fs.copyFileSync(ENV_FILE, ENV_BACKUP);
  const AUTH = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "hermes",
    "auth.json",
  );
  const AUTH_BACKUP = AUTH + ".probe-validation-auth-bk";
  if (fs.existsSync(AUTH)) fs.copyFileSync(AUTH, AUTH_BACKUP);
  const before = fs.readFileSync(ENV_FILE, "utf-8");
  const without = before.replace(/^DEEPSEEK_API_KEY=.*\n?/m, "");
  fs.writeFileSync(ENV_FILE, without);
  if (fs.existsSync(AUTH)) {
    const auth = JSON.parse(fs.readFileSync(AUTH, "utf-8"));
    if (auth.providers) delete auth.providers.deepseek;
    if (auth.credential_pool) delete auth.credential_pool.deepseek;
    fs.writeFileSync(AUTH, JSON.stringify(auth, null, 2));
  }
  console.log("[setup] removed DEEPSEEK_API_KEY from .env + cleared deepseek from auth.json");

  // The readEnv() in main process has a 5s TTL cache. Bust by setting and
  // unsetting some random key, OR just wait — but easier to flip it via
  // setEnv which invalidates the cache.
  await page.evaluate(async () => {
    await window.hermesAPI.setEnv("__VALIDATION_PROBE__", String(Date.now()));
  });
  // Now call validation again
  const blockedState = await page.evaluate(async () => {
    return await window.hermesAPI.validateChatReadiness();
  });
  console.log("[B] missing-key validateChatReadiness:", JSON.stringify(blockedState));

  // --- C. Config-health audit: should report MODEL_KEY_MISSING + maybe more ---
  const health = await page.evaluate(async () => {
    return await window.hermesAPI.getConfigHealth();
  });
  console.log("[C] config-health summary:", JSON.stringify(health.summary));
  console.log("[C] issue codes:", health.issues.map((i) => `${i.severity}:${i.code}`).join(", "));

  // --- Restore .env + auth.json ---
  fs.copyFileSync(ENV_BACKUP, ENV_FILE);
  fs.unlinkSync(ENV_BACKUP);
  if (fs.existsSync(AUTH_BACKUP)) {
    fs.copyFileSync(AUTH_BACKUP, AUTH);
    fs.unlinkSync(AUTH_BACKUP);
  }
  // Clean up the marker we set
  await page.evaluate(async () => {
    await window.hermesAPI.setEnv("__VALIDATION_PROBE__", "");
  });
  console.log("[teardown] .env + auth.json restored");

  // --- Verdicts ---
  console.log();
  const aOk = okState.ok === true;
  const bBlocked = blockedState.ok === false &&
    blockedState.code === "MISSING_API_KEY" &&
    blockedState.expectedEnvKey === "DEEPSEEK_API_KEY";
  const cFlagged = (health.issues || []).some(
    (i) => i.code === "MODEL_KEY_MISSING" && i.context?.expectedKey === "DEEPSEEK_API_KEY",
  );
  console.log(`[VERDICT A] ${aOk ? "✅" : "🔴"} happy path → ok:true`);
  console.log(`[VERDICT B] ${bBlocked ? "✅" : "🔴"} missing-key → blocked with MISSING_API_KEY + DEEPSEEK_API_KEY`);
  console.log(`[VERDICT C] ${cFlagged ? "✅" : "🔴"} config-health reports MODEL_KEY_MISSING for DEEPSEEK_API_KEY`);

  await browser.close();
})().catch((e) => {
  // Best-effort restore on failure
  try {
    if (fs.existsSync(ENV_BACKUP)) {
      fs.copyFileSync(ENV_BACKUP, ENV_FILE);
      fs.unlinkSync(ENV_BACKUP);
    }
  } catch {}
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
