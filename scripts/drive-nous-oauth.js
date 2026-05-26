/**
 * Drive the Nous Portal OAuth sign-in via the new card.
 *
 *   1. Navigate to Providers tab.
 *   2. Click the Nous Portal (OAuth) Sign-in button.
 *   3. Stream the modal's <pre> log live (1.5s polling).
 *   4. Print the verification URL + user code so the human can complete
 *      the Google auth in their own browser.
 *   5. Watch for status to flip to "success" or "error".
 *   6. Snapshot auth.json before exiting.
 */
const { attach } = require("./e2e-attach");
const fs = require("fs");
const path = require("path");
const os = require("os");

const AUTH = path.join(os.homedir(), "AppData", "Local", "hermes", "auth.json");

(async () => {
  const { browser, page } = await attach();

  // Navigate to Providers
  await page.click('text=/^Providers$/').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  // Scroll the page to bring the OAuth section into view (the card list
  // is below the LLM Providers section)
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".provider-key-card"));
    const nousOauth = cards.find((c) =>
      /Nous Portal \(OAuth\)/i.test(c.textContent || ""),
    );
    if (nousOauth) nousOauth.scrollIntoView({ behavior: "instant", block: "center" });
  });

  // Click the Sign-in button on the Nous OAuth card
  const clickResult = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".provider-key-card"));
    const nousOauth = cards.find((c) =>
      /Nous Portal \(OAuth\)/i.test(c.textContent || ""),
    );
    if (!nousOauth) return { clicked: false, reason: "no card" };
    const btn = nousOauth.querySelector(".oauth-signin-btn");
    if (!btn) return { clicked: false, reason: "no button" };
    btn.click();
    return { clicked: true };
  });
  console.log("[step 1] Sign-in click:", JSON.stringify(clickResult));

  // Wait for the modal to appear
  await page.waitForSelector(".models-modal", { timeout: 5000 });
  console.log("[step 2] OAuth modal open. Streaming log...");
  console.log("─".repeat(70));

  // Poll the log + status. Stream new content as it arrives.
  let lastLog = "";
  let status = "running";
  const startTs = Date.now();
  const MAX_WAIT_MS = 300_000; // 5 min — device code flows expire fast

  while (status === "running" && Date.now() - startTs < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, 1500));
    const snap = await page.evaluate(() => {
      const pre = document.querySelector(".settings-hermes-doctor");
      const log = pre ? pre.textContent || "" : "";
      const ok = document.querySelector(".oauth-login-result-success");
      const err = document.querySelector(".oauth-login-result-error");
      let status = "running";
      if (ok) status = "success";
      else if (err) status = "error";
      const errText = err ? (err.textContent || "").trim() : "";
      const modalOpen = document.querySelector(".models-modal") !== null;
      return { log, status, errText, modalOpen };
    });
    if (!snap.modalOpen) {
      console.log("[modal closed unexpectedly]");
      break;
    }
    if (snap.log !== lastLog) {
      const delta = snap.log.slice(lastLog.length);
      process.stdout.write(delta);
      lastLog = snap.log;
    }
    if (snap.status !== status) {
      status = snap.status;
      console.log();
      console.log("─".repeat(70));
      console.log(`[status] ${status}${snap.errText ? ": " + snap.errText : ""}`);
    }
  }

  if (status === "running") {
    console.log();
    console.log("[timeout] no status change after 5 min — leaving modal open");
  }

  // Snapshot auth.json regardless — useful for partial diagnosis
  let nousProvider = null;
  let nousPool = null;
  try {
    const auth = JSON.parse(fs.readFileSync(AUTH, "utf-8"));
    nousProvider = auth.providers?.nous || null;
    nousPool = auth.credential_pool?.nous || null;
  } catch {}
  console.log();
  console.log("─".repeat(70));
  console.log("auth.json state:");
  console.log("  providers.nous:", nousProvider ? Object.keys(nousProvider).join(", ") : "absent");
  console.log("  credential_pool.nous:", nousPool ? `${nousPool.length} entries` : "absent");
  if (nousProvider) {
    // Show non-secret fields
    const safe = {};
    for (const [k, v] of Object.entries(nousProvider)) {
      if (typeof v === "string" && v.length > 20) safe[k] = `<string, ${v.length} chars>`;
      else safe[k] = v;
    }
    console.log("  providers.nous (sanitized):", JSON.stringify(safe));
  }
  if (nousPool && nousPool[0]) {
    const safe = {};
    for (const [k, v] of Object.entries(nousPool[0])) {
      if (typeof v === "string" && v.length > 20) safe[k] = `<string, ${v.length} chars>`;
      else safe[k] = v;
    }
    console.log("  credential_pool.nous[0] (sanitized):", JSON.stringify(safe));
  }

  await browser.close();

  if (status === "success") {
    console.log();
    console.log("[VERDICT] ✅ OAuth login completed successfully.");
  } else if (status === "error") {
    console.log();
    console.log("[VERDICT] 🔴 OAuth login failed.");
    process.exit(2);
  } else {
    console.log();
    console.log("[VERDICT] ⚠️ OAuth login still running at timeout.");
    process.exit(3);
  }
})().catch((e) => {
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
