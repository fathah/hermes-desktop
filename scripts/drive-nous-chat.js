/**
 * Drive a Nous Portal end-to-end chat round-trip via the dev electron.
 *
 *   1. Backup config.yaml + remember active model.
 *   2. Switch model.provider → "nous", model.default → "Hermes-4-405B"
 *      (or the smallest available Nous model name; the engine resolves
 *      it). Clear base_url so the engine uses portal's inference URL
 *      from auth.json.
 *   3. Send a one-liner chat.
 *   4. Wait for chat-done; capture the agent's reply.
 *   5. Restore the original model selection.
 */
const { attach } = require("./e2e-attach");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "hermes",
  "config.yaml",
);
const CONFIG_BAK = CONFIG + ".nous-chat-bk";

const NOUS_MODEL = process.env.NOUS_MODEL || "Hermes-4-405B";
const PROMPT =
  process.env.PROMPT ||
  "Reply with exactly two words: 'NOUS WORKS'. Nothing else.";

(async () => {
  fs.copyFileSync(CONFIG, CONFIG_BAK);

  try {
    // Mutate config: provider = nous, default = NOUS_MODEL, blank base_url
    const cfg = fs.readFileSync(CONFIG, "utf-8");
    const cfgNew = cfg
      .replace(/^(model:\s*\n(?:.*\n)*?\s*provider:\s+).*$/m, `$1"nous"`)
      .replace(
        /^(model:\s*\n(?:.*\n)*?\s*default:\s+).*$/m,
        `$1"${NOUS_MODEL}"`,
      )
      .replace(/^(model:\s*\n(?:.*\n)*?\s*base_url:\s+).*$/m, `$1""`);
    fs.writeFileSync(CONFIG, cfgNew);
    console.log("[setup] active model switched to nous /", NOUS_MODEL);

    const { browser, page } = await attach();

    // Make sure we're on the Chat tab (drive-nous-oauth left us on
    // Providers).
    await page.click('text=/^Chat$/').catch(() => {});
    await new Promise((r) => setTimeout(r, 500));

    // Kill any in-flight chat + clear chat — new conversation
    await page.click("button.chat-clear-btn").catch(() => {});
    await new Promise((r) => setTimeout(r, 400));

    // Bust the main-process model-config cache by writing it through IPC
    await page.evaluate(async (model) => {
      await window.hermesAPI.setModelConfig("nous", model, "");
    }, NOUS_MODEL);
    await new Promise((r) => setTimeout(r, 400));

    // Snapshot agent bubble count before send
    const beforeCount = await page.evaluate(
      () => document.querySelectorAll(".chat-bubble-agent").length,
    );
    console.log("[setup] agent bubbles before send:", beforeCount);

    // Type + send
    await page.fill("textarea.chat-input", PROMPT);
    await page.keyboard.press("Enter");
    console.log("[step 1] sent:", PROMPT);

    // Wait for streaming to finish — stop button disappears AND at
    // least one agent bubble exists. Time-bound to 90s.
    await page.waitForFunction(
      (prev) => {
        const stop = document.querySelector(".chat-stop-btn");
        const agents = document.querySelectorAll(".chat-bubble-agent").length;
        return !stop && agents > prev;
      },
      beforeCount,
      { timeout: 90_000, polling: 250 },
    );
    await new Promise((r) => setTimeout(r, 800));

    // Capture the latest agent bubble text
    const result = await page.evaluate(() => {
      const bubbles = document.querySelectorAll(".chat-bubble-agent");
      const last = bubbles[bubbles.length - 1];
      return {
        bubbleCount: bubbles.length,
        text: last ? (last.textContent || "").trim() : null,
        anyError: Array.from(bubbles).some((b) =>
          /^Error:|Internal server error|Hermes is not logged into/i.test(
            (b.textContent || "").trim(),
          ),
        ),
      };
    });
    console.log("[step 2] agent bubbles after:", result.bubbleCount);
    console.log("[step 2] last bubble text:");
    console.log("  " + (result.text || "<empty>").replace(/\n/g, "\n  "));

    await browser.close();

    console.log();
    if (result.anyError) {
      console.log("[VERDICT] 🔴 Chat returned an error.");
      process.exit(2);
    } else if (result.bubbleCount > beforeCount && result.text) {
      console.log("[VERDICT] ✅ Nous Portal chat round-trip succeeded.");
    } else {
      console.log("[VERDICT] ⚠️ No agent reply observed.");
      process.exit(3);
    }
  } finally {
    fs.copyFileSync(CONFIG_BAK, CONFIG);
    fs.unlinkSync(CONFIG_BAK);
    console.log("[teardown] config.yaml restored");
  }
})().catch((e) => {
  try {
    if (fs.existsSync(CONFIG_BAK)) {
      fs.copyFileSync(CONFIG_BAK, CONFIG);
      fs.unlinkSync(CONFIG_BAK);
    }
  } catch {}
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
