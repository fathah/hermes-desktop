// ocr-probe.mjs — de-risk: prove tesseract.js OCRs in the BUILT app's renderer
// using the bundled offline assets (/tesseract/*) under the production CSP and
// file:// origin. Renders known text to a canvas, OCRs it, checks the result.
//   npm run build && node scripts/ocr-probe.mjs
import { _electron as electron } from "playwright";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const HOME = mkdtempSync(join(tmpdir(), "hermes-ocr-probe-"));
const fail = (m) => {
  console.log("PROBE_FAIL:", m);
  process.exit(1);
};
setTimeout(() => fail("WATCHDOG_TIMEOUT"), 120000).unref();

const app = await electron.launch({
  args: [".", `--user-data-dir=${join(HOME, "ud")}`],
  env: { ...process.env, HERMES_HOME: HOME, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });

win.on("console", (m) => {
  if (/error|denied|refused|csp|blocked/i.test(m.text())) console.log("  [page]", m.text());
});

const out = await win.evaluate(async () => {
  const PHRASE = "INCIDENT REPORT 12345";
  const canvas = document.createElement("canvas");
  canvas.width = 760;
  canvas.height = 140;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 56px Helvetica, Arial, sans-serif";
  ctx.fillText(PHRASE, 18, 92);

  const url = (p) => new URL(p, document.baseURI).href;
  try {
    const T = await import(url("tesseract/tesseract.esm.min.js"));
    const Tess = T.default ?? T;
    const worker = await Tess.createWorker("eng", 1, {
      workerPath: url("tesseract/worker.min.js"),
      corePath: url("tesseract/tesseract-core-simd.wasm.js"),
      langPath: url("tesseract"),
      workerBlobURL: true,
    });
    const { data } = await worker.recognize(canvas);
    await worker.terminate();
    return { ok: true, text: (data.text || "").trim(), expected: PHRASE };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

console.log("PROBE_RESULT:", JSON.stringify(out));
await app.close();
if (!out.ok) fail(out.error);
const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
if (norm(out.text).includes("INCIDENT") && norm(out.text).includes("12345")) {
  console.log("PROBE_OK: tesseract read the rendered text offline in the built app");
} else {
  fail(`OCR text did not match: ${JSON.stringify(out.text)}`);
}
