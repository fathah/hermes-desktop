/**
 * Live verify Nous model discovery (#367 follow-up):
 *   1. Calls discoverProviderModels("nous") through the renderer.
 *   2. Checks status === "ok" and models.length > 0.
 *   3. Checks freeModels contains the known free entries (Nous Portal
 *      free tier currently exposes deepseek/deepseek-v4-flash:free and
 *      openrouter/owl-alpha).
 */
const { attach } = require("./e2e-attach");

(async () => {
  const { browser, page } = await attach();
  const result = await page.evaluate(async () => {
    return await window.hermesAPI.discoverProviderModels(
      "nous",
      undefined,
      undefined,
      undefined,
    );
  });
  await browser.close();

  console.log("status:", result.status);
  console.log("cached:", result.cached);
  console.log("models.length:", (result.models || []).length);
  console.log("freeModels:", JSON.stringify(result.freeModels));
  console.log("sample (first 6):");
  for (const m of (result.models || []).slice(0, 6)) console.log(" -", m);

  const okStatus = result.status === "ok";
  const hasModels = (result.models || []).length > 50; // expect many
  const hasFree = (result.freeModels || []).length > 0;
  const knownFreeIds = ["deepseek/deepseek-v4-flash:free", "openrouter/owl-alpha"];
  const matchesKnown = knownFreeIds.every((id) =>
    (result.freeModels || []).includes(id),
  );

  console.log();
  console.log(`[VERDICT A] ${okStatus ? "✅" : "🔴"} discovery status === "ok"`);
  console.log(`[VERDICT B] ${hasModels ? "✅" : "🔴"} returned >50 models (got ${(result.models || []).length})`);
  console.log(`[VERDICT C] ${hasFree ? "✅" : "🔴"} freeModels populated (${(result.freeModels || []).length} entries)`);
  console.log(`[VERDICT D] ${matchesKnown ? "✅" : "🔴"} freeModels contains known Nous free tier (deepseek/deepseek-v4-flash:free + openrouter/owl-alpha)`);

  if (!okStatus || !hasModels || !hasFree || !matchesKnown) process.exit(2);
})().catch((e) => {
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
