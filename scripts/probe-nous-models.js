/**
 * Query Nous Portal's /v1/models via the gateway to find free models.
 */
const { attach } = require("./e2e-attach");

(async () => {
  const { browser, page } = await attach();
  const models = await page.evaluate(async () => {
    try {
      return await window.hermesAPI.discoverProviderModels(
        "nous",
        "",
        "",
      );
    } catch (e) {
      return { error: String(e) };
    }
  });
  if (models?.error) {
    console.log("discoverModels error:", models.error);
  } else if (Array.isArray(models)) {
    console.log("Available models:", models.length);
    for (const m of models) console.log(" -", typeof m === "string" ? m : JSON.stringify(m));
  } else {
    console.log("unexpected result:", JSON.stringify(models)?.slice(0, 500));
  }
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
