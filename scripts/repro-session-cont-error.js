/**
 * Reproduce the user-reported error: "Error: Session continuation requires
 * API key authentication. Configure API_SERVER_KEY to enable this feature."
 *
 * Hypothesis: gateway's `self._api_key` reads from `api_server.extra.key`
 * or `os.getenv("API_SERVER_KEY")`. The desktop's `getApiServerKey` ALSO
 * reads `api_server.token` (a nested config key). The gateway never picks
 * that up. So if the user's key is only in `api_server.token` (or any
 * source not bridged into the gateway's env), the desktop sends
 * `X-Hermes-Session-Id` (because hasAuth=true) and the gateway returns
 * 403 with the exact "Configure API_SERVER_KEY" message.
 *
 * Setup BEFORE running this script:
 *   1. config.yaml: API_SERVER_KEY moved from top-level to api_server.token (nested)
 *   2. .env: no API_SERVER_KEY entry (already true on this machine)
 *   3. Gateway killed (will be respawned by the first chat send)
 */

const { attach } = require("./e2e-attach");

(async () => {
  const { browser, page } = await attach();
  await page.click("button.chat-clear-btn");
  await new Promise((r) => setTimeout(r, 300));

  // Send a chat — desktop will respawn the gateway with the new config
  console.log("[test] sending a single chat turn after config change + gateway kill...");
  const prev = await page.evaluate(
    () => document.querySelectorAll(".chat-bubble-agent").length,
  );
  await page.fill("textarea.chat-input", "Reply with PONG");
  await page.keyboard.press("Enter");

  // Wait for SOMETHING to render (success or error)
  await page.waitForFunction(
    (p) => document.querySelectorAll(".chat-bubble-agent").length > p,
    prev,
    { timeout: 60_000, polling: 250 },
  );
  await new Promise((r) => setTimeout(r, 500));

  const result = await page.evaluate(() => {
    const bubbles = document.querySelectorAll(".chat-bubble-agent");
    const last = bubbles[bubbles.length - 1];
    return {
      bubbleCount: bubbles.length,
      lastText: last ? last.textContent.trim().slice(0, 500) : null,
    };
  });

  console.log();
  console.log("[result]:");
  console.log(`  agent bubbles: ${result.bubbleCount}`);
  console.log(`  last text:     ${result.lastText}`);
  console.log();

  if (result.lastText && result.lastText.includes("Session continuation requires API key authentication")) {
    console.log("[VERDICT] 🔴 REPRODUCED — exact error users are reporting!");
  } else if (result.lastText && result.lastText.startsWith("Error:")) {
    console.log(`[VERDICT] ⚠️  Different error: ${result.lastText.slice(0, 200)}`);
  } else {
    console.log(`[VERDICT] ✅ Chat succeeded — bug NOT reproduced with this config.`);
  }

  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
