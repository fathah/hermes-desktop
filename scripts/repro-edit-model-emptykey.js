/**
 * Reproduce "Arc Codex" user's Bug A: the Edit Model dialog's API key
 * field is empty when reopened, even though a key was saved.
 *
 * Steps:
 *   1. Open Models tab.
 *   2. Click "Add Model" — fill in custom provider, base URL, API key, save.
 *   3. Read .env to verify the key was written (and under WHICH env var).
 *   4. Open the same model's Edit dialog.
 *   5. Inspect the API key form field — is it populated, or empty?
 *
 * Expected (if no bug): field shows the saved key (or a placeholder)
 * Symptom: field is empty
 */

const { attach } = require("./e2e-attach");
const { execFileSync } = require("child_process");
const path = require("path");
const os = require("os");

const ENV_FILE = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "hermes",
  ".env",
);

const TEST_BASE_URL = "https://www.arccodex.com/api/codex/v1";
const TEST_KEY = "sk-test-arc-codex-AAAA-BBBB-CCCC";
const TEST_MODEL_NAME = "test-arc-codex-bug-A";
const TEST_MODEL_ID = "gpt-5.5";

function envEntries(file) {
  try {
    const content = require("fs").readFileSync(file, "utf-8");
    const matches = {};
    for (const line of content.split("\n")) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m) matches[m[1]] = m[2];
    }
    return matches;
  } catch {
    return {};
  }
}

async function clickByTitle(page, title) {
  // Helper: click a button by its title attribute
  await page.click(`button[title="${title}"]`);
}

async function dumpModalState(page) {
  return await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll(".models-modal input, .models-modal select, .models-modal textarea"));
    return inputs.map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      id: el.id,
      name: el.getAttribute("name"),
      placeholder: el.getAttribute("placeholder"),
      value: el.value,
    }));
  });
}

(async () => {
  const { browser, page } = await attach();

  // Snapshot .env before
  const beforeEnv = envEntries(ENV_FILE);
  console.log("[setup] .env keys before:", Object.keys(beforeEnv).filter(k => k.endsWith("_API_KEY") || k === "CUSTOM_API_KEY"));

  // Navigate to Models tab
  await page.click('text=/^Models$/');
  await new Promise((r) => setTimeout(r, 400));
  console.log("[step 1] On Models tab");

  // Click "Add Model" button (top right)
  await page.evaluate(() => {
    // The button has the addModel translation key as title or text
    const btns = Array.from(document.querySelectorAll("button"));
    const addBtn = btns.find((b) => /add model/i.test(b.textContent || ""));
    if (addBtn) addBtn.click();
  });
  await page.waitForSelector(".models-modal", { timeout: 5000 });
  console.log("[step 2] Add Model dialog open");

  // Fill form: select OpenAI Compatible / Local provider, fill name, model, base URL, api key
  // First, the provider dropdown — must be "custom"
  await page.selectOption('select#model-form-provider', 'custom');
  // Wait for any reactive updates
  await new Promise((r) => setTimeout(r, 200));

  // Find the various inputs by their visible structure
  const inputs = await dumpModalState(page);
  console.log("[step 2] Modal inputs:");
  for (const i of inputs) console.log(`           ${i.tag}[${i.type || ''}] id=${i.id||''} placeholder=${i.placeholder||''} value=${i.value||''}`);

  // Fill the form — there are 4 text inputs we need:
  // displayName, modelId, baseUrl, apiKey
  // We'll fill by labels
  await page.evaluate(({ name, model, url, key }) => {
    const all = Array.from(document.querySelectorAll(".models-modal input[type='text'], .models-modal input[type='password']"));
    // models.displayName is the first text input typically
    // models.modelId is second; baseUrl third; apiKey fourth/last
    const setVal = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    if (all[0]) setVal(all[0], name);
    if (all[1]) setVal(all[1], model);
    if (all[2]) setVal(all[2], url);
    if (all[3]) setVal(all[3], key);
  }, { name: TEST_MODEL_NAME, model: TEST_MODEL_ID, url: TEST_BASE_URL, key: TEST_KEY });
  await new Promise((r) => setTimeout(r, 200));

  console.log("[step 3] Form filled, clicking Add Model");
  // Click the "Add Model" / Update button in the modal
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".models-modal button"));
    const submitBtn = btns.find((b) => /add model|update/i.test(b.textContent || ""));
    if (submitBtn) submitBtn.click();
  });
  await page.waitForSelector(".models-modal", { state: "hidden", timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  console.log("[step 3] Saved.");

  // Check .env
  const afterEnv = envEntries(ENV_FILE);
  const newKeys = Object.keys(afterEnv).filter((k) => !(k in beforeEnv));
  const changedKeys = Object.keys(afterEnv).filter((k) => k in beforeEnv && afterEnv[k] !== beforeEnv[k]);
  console.log("[step 4] .env changes:");
  for (const k of newKeys) {
    console.log(`           NEW: ${k}=${afterEnv[k].slice(0, 12)}…  (matches test key prefix? ${afterEnv[k] === TEST_KEY})`);
  }
  for (const k of changedKeys) {
    console.log(`           CHANGED: ${k}`);
  }
  if (newKeys.length === 0 && changedKeys.length === 0) {
    console.log("           (no changes — key was not written?)");
  }

  // Now find the saved model in the list and click the card itself (entire
  // card is the Edit trigger — Models.tsx line 293)
  console.log("[step 5] Clicking the model card to open Edit dialog...");
  await page.evaluate((name) => {
    const cards = Array.from(document.querySelectorAll(".models-card"));
    for (const card of cards) {
      if ((card.textContent || "").includes(name)) {
        card.click();
        return;
      }
    }
  }, TEST_MODEL_NAME);
  await page.waitForSelector(".models-modal", { timeout: 5000 });

  const reopenInputs = await dumpModalState(page);
  console.log("[step 6] Edit-dialog inputs after reopen:");
  for (const i of reopenInputs) {
    const v = (i.value || "").slice(0, 25);
    console.log(`           ${i.tag}[${i.type || ''}] placeholder=${(i.placeholder||'').slice(0,30)} value=${v}`);
  }

  // The 4th text/password input is the apiKey field per Models.tsx
  const apiKeyInput = reopenInputs.find((i) => (i.placeholder || "").toLowerCase().includes("sk-") || (i.placeholder || "").toLowerCase().includes("key"));
  console.log();
  if (apiKeyInput) {
    if (apiKeyInput.value && apiKeyInput.value.includes("sk-test")) {
      console.log(`[VERDICT] ✅ API key persisted in the form: ${apiKeyInput.value.slice(0, 20)}…`);
    } else if (!apiKeyInput.value) {
      console.log(`[VERDICT] 🔴 REPRODUCED — API key field is empty after reopen, even though .env has the value.`);
    } else {
      console.log(`[VERDICT] ⚠️  Field has unexpected value: ${apiKeyInput.value}`);
    }
  } else {
    console.log(`[VERDICT] ⚠️  Couldn't identify the API key field`);
  }

  // Cleanup: close the modal
  await page.evaluate(() => {
    const cancelBtn = Array.from(document.querySelectorAll(".models-modal button")).find((b) => /cancel|close/i.test(b.textContent || ""));
    if (cancelBtn) cancelBtn.click();
  });

  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
