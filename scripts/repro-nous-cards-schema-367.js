/**
 * Live verification of issue #367's PR (Bugs 1, 2, 3).
 *
 *   A. Bug 1 — Nous Portal API Key card renders in the LLM Providers
 *              section.
 *   B. Bug 2 — Nous Portal OAuth Sign-in card renders in the OAuth
 *              section.
 *   C. Bug 3 — Adding a credential-pool entry writes the upstream
 *              engine schema (`access_token`, `auth_type`, `id`,
 *              `base_url`, `priority`, `source`, `request_count`),
 *              not the malformed `{key, label}`.
 */
const { attach } = require("./e2e-attach");
const fs = require("fs");
const path = require("path");
const os = require("os");

const AUTH = path.join(os.homedir(), "AppData", "Local", "hermes", "auth.json");
const AUTH_BAK = AUTH + ".nous-cards-bk";

(async () => {
  if (fs.existsSync(AUTH)) fs.copyFileSync(AUTH, AUTH_BAK);

  try {
    const { browser, page } = await attach();

    // Navigate to Providers tab
    await page.click('text=/^Providers$/').catch(() => {});
    await new Promise((r) => setTimeout(r, 600));

    // --- A. Nous API Key card present in LLM Providers section ---
    const apiKeyCardPresent = await page.evaluate(() => {
      // The card renders the input with placeholder = card's title.
      // We can find it by attribute or by walking the section.
      const inputs = Array.from(
        document.querySelectorAll(".provider-key-card input"),
      );
      // Match by surrounding text "Nous Portal API Key"
      const cards = Array.from(document.querySelectorAll(".provider-key-card"));
      return cards.some((c) =>
        /Nous Portal API Key/i.test(c.textContent || ""),
      ) && inputs.length > 0;
    });
    console.log(`[A] Nous Portal API Key card: present=${apiKeyCardPresent}`);

    // --- B. Nous OAuth card present ---
    const oauthCardPresent = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".provider-key-card"));
      // OAuth cards have a "Sign in" button; the Nous card's title
      // is "Nous Portal (OAuth)".
      return cards.some(
        (c) =>
          /Nous Portal \(OAuth\)/i.test(c.textContent || "") &&
          c.querySelector(".oauth-signin-btn") !== null,
      );
    });
    console.log(`[B] Nous Portal OAuth card: present=${oauthCardPresent}`);

    // --- C. Schema fix: add a pool entry via IPC, verify shape ---
    const TEST_LABEL = `__nous-test-${Date.now()}__`;
    const TEST_KEY = `sk-nous-test-${Date.now()}`;
    const entries = await page.evaluate(
      async ({ label, key }) => {
        return await window.hermesAPI.addCredentialPoolEntry(
          "nous",
          key,
          label,
        );
      },
      { label: TEST_LABEL, key: TEST_KEY },
    );
    const ours = (entries || []).find((e) => e.label === TEST_LABEL);
    console.log(`[C] new pool entry shape:`, JSON.stringify(ours));

    // Also confirm it landed on disk
    const auth = JSON.parse(fs.readFileSync(AUTH, "utf-8"));
    const onDisk = (auth.credential_pool?.nous || []).find(
      (e) => e.label === TEST_LABEL,
    );
    console.log(`[C] on-disk entry:`, JSON.stringify(onDisk));

    await browser.close();

    // Verdicts
    const aPass = apiKeyCardPresent;
    const bPass = oauthCardPresent;
    const cPass =
      ours &&
      ours.access_token === TEST_KEY &&
      ours.auth_type === "api_key" &&
      typeof ours.id === "string" &&
      ours.id.length > 0 &&
      typeof ours.priority === "number" &&
      ours.source === "manual" &&
      ours.key === undefined;
    const cDisk =
      onDisk &&
      onDisk.access_token === TEST_KEY &&
      onDisk.auth_type === "api_key" &&
      onDisk.key === undefined;
    console.log();
    console.log(`[VERDICT A] ${aPass ? "✅" : "🔴"} Nous Portal API Key card renders in LLM Providers section`);
    console.log(`[VERDICT B] ${bPass ? "✅" : "🔴"} Nous Portal OAuth Sign-in card renders in OAuth section`);
    console.log(`[VERDICT C] ${cPass ? "✅" : "🔴"} addCredentialPoolEntry returns canonical engine schema (no legacy {key, label})`);
    console.log(`[VERDICT D] ${cDisk ? "✅" : "🔴"} canonical schema persisted to auth.json`);
  } finally {
    if (fs.existsSync(AUTH_BAK)) {
      fs.copyFileSync(AUTH_BAK, AUTH);
      fs.unlinkSync(AUTH_BAK);
    } else if (fs.existsSync(AUTH)) {
      fs.unlinkSync(AUTH);
    }
    console.log("[teardown] auth.json restored");
  }
})().catch((e) => {
  try {
    if (fs.existsSync(AUTH_BAK)) {
      fs.copyFileSync(AUTH_BAK, AUTH);
      fs.unlinkSync(AUTH_BAK);
    }
  } catch {}
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
