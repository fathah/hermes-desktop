/**
 * Live verify the SIBLING_HERMES_HOME_DRIFT check.
 *
 * Prerequisites set up by the harness operator before running:
 *   1. WSL has a ~/.hermes/ with at least one drifting field vs the
 *      Windows-side. (E.g. CUSTOM_API_KEY in WSL .env, absent on
 *      Windows side; or model.api_key in WSL config.yaml, absent on
 *      Windows side.)
 *   2. Dev electron started with ENABLE_CDP=1 on this branch (the
 *      one that has wsl-detection.ts + config-health.ts with the
 *      new check).
 *
 * The probe:
 *   1. Calls getConfigHealth() via IPC.
 *   2. Filters for SIBLING_HERMES_HOME_DRIFT issues.
 *   3. Prints each one's field + direction + autoFixable.
 *   4. Picks an autoFixable one and calls autofixConfigIssue() on it.
 *   5. Re-runs the audit; asserts that the same issue is no longer
 *      flagged (i.e. the auto-fix actually copied the value across).
 */
const { attach } = require("./e2e-attach");
const fs = require("fs");
const path = require("path");
const os = require("os");

const WIN_ENV = path.join(os.homedir(), "AppData", "Local", "hermes", ".env");
const WIN_ENV_BAK = WIN_ENV + ".wsl-drift-test-bk";

(async () => {
  // Backup Windows .env so we can restore after the auto-fix test
  if (fs.existsSync(WIN_ENV)) fs.copyFileSync(WIN_ENV, WIN_ENV_BAK);

  try {
    const { browser, page } = await attach();

    // ── A. Run audit, look for drift issues ─────────────────────
    const report = await page.evaluate(async () => {
      return await window.hermesAPI.getConfigHealth();
    });
    const drifts = (report.issues || []).filter(
      (i) => i.code === "SIBLING_HERMES_HOME_DRIFT",
    );
    console.log(
      `[A] config-health report — ${report.issues.length} total issues, ${drifts.length} drift issues`,
    );
    for (const d of drifts) {
      console.log(
        `    - field=${d.context?.field} direction=${d.context?.direction} severity=${d.severity} autoFixable=${d.autoFixable}`,
      );
    }

    if (drifts.length === 0) {
      console.log();
      console.log(
        "[VERDICT] 🔴 No drift detected. Either the WSL ~/.hermes/ doesn't exist, doesn't differ from Windows, OR the check isn't running.",
      );
      await browser.close();
      process.exit(2);
    }

    // ── B. Auto-fix the first autoFixable drift ────────────────
    const target = drifts.find((d) => d.autoFixable);
    if (!target) {
      console.log();
      console.log(
        "[VERDICT] ⚠️ Drift detected but none are autoFixable. Check the contexts above.",
      );
      await browser.close();
      process.exit(3);
    }

    console.log();
    console.log(`[B] applying auto-fix for ${target.context?.field}...`);
    const fixResult = await page.evaluate(
      async (issue) => {
        return await window.hermesAPI.autofixConfigIssue(
          issue.code,
          undefined,
          issue.context,
        );
      },
      { code: target.code, context: target.context },
    );
    console.log(`[B] auto-fix result:`, JSON.stringify(fixResult));

    // ── C. Confirm Windows-side .env now has the value ──────────
    const winEnvAfter = fs.readFileSync(WIN_ENV, "utf-8");
    const fieldName = target.context?.field;
    const valueInEnv = new RegExp(
      `^${fieldName}=(.+)$`,
      "m",
    ).exec(winEnvAfter);
    console.log(
      `[C] Windows-side .env now has ${fieldName}: ${valueInEnv ? "✓ value present" : "✗ still missing"}`,
    );

    // ── D. Re-run audit — the same drift should be gone ────────
    const reportAfter = await page.evaluate(async () => {
      return await window.hermesAPI.rerunConfigHealth();
    });
    const sameDriftStillPresent = (reportAfter.issues || []).some(
      (i) =>
        i.code === "SIBLING_HERMES_HOME_DRIFT" &&
        i.context?.field === fieldName &&
        i.context?.direction === "wsl-to-windows",
    );
    console.log(
      `[D] re-run audit: same drift still present? ${sameDriftStillPresent ? "YES (BAD)" : "no (good)"}`,
    );

    await browser.close();

    console.log();
    const aOk = drifts.length > 0;
    const bOk = fixResult.ok === true;
    const cOk = !!valueInEnv;
    const dOk = !sameDriftStillPresent;
    console.log(`[VERDICT A] ${aOk ? "✅" : "🔴"} drift issues surfaced (${drifts.length})`);
    console.log(`[VERDICT B] ${bOk ? "✅" : "🔴"} auto-fix returned ok:true`);
    console.log(`[VERDICT C] ${cOk ? "✅" : "🔴"} field landed in Windows-side .env`);
    console.log(`[VERDICT D] ${dOk ? "✅" : "🔴"} drift cleared from next audit`);
  } finally {
    // Restore .env so the live test doesn't pollute the user's setup
    if (fs.existsSync(WIN_ENV_BAK)) {
      fs.copyFileSync(WIN_ENV_BAK, WIN_ENV);
      fs.unlinkSync(WIN_ENV_BAK);
    }
    console.log("[teardown] Windows-side .env restored");
  }
})().catch((e) => {
  try {
    if (fs.existsSync(WIN_ENV_BAK)) {
      fs.copyFileSync(WIN_ENV_BAK, WIN_ENV);
      fs.unlinkSync(WIN_ENV_BAK);
    }
  } catch {}
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
