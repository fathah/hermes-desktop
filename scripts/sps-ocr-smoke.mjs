// sps-ocr-smoke.mjs — end-to-end proof of the scanned-PDF OCR path (item 2).
// Generates an IMAGE-ONLY PDF (canvas → JPEG → 1-page PDF, no text layer) inside
// the renderer, stubs the file picker to return it, drives Import PDF, and
// asserts the OCR'd text lands in a page under "Sources".
//   npm run build && node scripts/sps-ocr-smoke.mjs
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const HOME = mkdtempSync(join(tmpdir(), "hermes-ocr-smoke-"));
const PHRASE = "INCIDENT REPORT ALPHA 2026";
const fail = (m) => {
  console.log("SMOKE_FAIL:", m);
  process.exit(1);
};

// Fake an installed Hermes so the app boots straight to the workspace.
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
const sps = join(HOME, "sps-agent");
mkdirSync(join(sps, "vault"), { recursive: true });
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);
writeFileSync(
  join(sps, "workspace.json"),
  JSON.stringify({
    tree: [{ id: "home", children: [] }],
    meta: { home: { icon: "🏠", title: "Home", cover: null } },
    docs: { home: [{ id: "h1", type: "h1", text: "Home" }] },
    comments: [],
    trash: [],
    page: "home",
  }),
);
writeFileSync(
  join(sps, "vault", "home.md"),
  `---\ntitle: "Home"\n---\n\n# Home\n`,
);
const FIXTURE = join(HOME, "scanned-report.pdf");

console.log("HERMES_HOME=", HOME);
setTimeout(() => fail("WATCHDOG_TIMEOUT"), 180000).unref();

const app = await electron.launch({
  args: [".", `--user-data-dir=${join(HOME, "ud")}`],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 1200);
});
await win.waitForTimeout(1500);
await win.waitForSelector(".rail-compose", { timeout: 15000 });

// Build an image-only PDF in the renderer (has canvas), return as base64.
const pdfB64 = await win.evaluate(async (phrase) => {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 60px Helvetica, Arial, sans-serif";
  ctx.fillText(phrase, 20, 100);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
  const jpeg = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) =>
    c.charCodeAt(0),
  );

  const enc = new TextEncoder();
  const parts = [];
  const push = (s) => parts.push(typeof s === "string" ? enc.encode(s) : s);
  const W = canvas.width;
  const H = canvas.height;
  push(`%PDF-1.4\n`);
  push(`1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n`);
  push(`2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n`);
  push(
    `3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>\nendobj\n`,
  );
  push(
    `4 0 obj\n<</Type/XObject/Subtype/Image/Width ${W}/Height ${H}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>\nstream\n`,
  );
  push(jpeg);
  push(`\nendstream\nendobj\n`);
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  push(
    `5 0 obj\n<</Length ${content.length}>>\nstream\n${content}\nendstream\nendobj\n`,
  );
  push(`trailer\n<</Root 1 0 R/Size 6>>\n%%EOF`);
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  let bin = "";
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return btoa(bin);
}, PHRASE);

writeFileSync(FIXTURE, Buffer.from(pdfB64, "base64"));
console.log("fixture bytes:", readFileSync(FIXTURE).length);

await app.evaluate(async ({ dialog }, fixture) => {
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [fixture],
  });
}, FIXTURE);

// Drive Import PDF.
await win.locator(".rail-compose").first().click();
await win.waitForSelector(".tpl-card", { timeout: 10000 });
const importCard = win.locator(".tpl-card", { hasText: "Import PDF" });
await importCard.first().scrollIntoViewIfNeeded();
await importCard.first().click();

// OCR runs in the background (seconds). Wait for the completion toast.
try {
  await win
    .getByText("OCR complete", { exact: false })
    .first()
    .waitFor({ timeout: 120000 });
} catch {
  await win.screenshot({ path: join(HOME, "ocr-timeout.png") });
  fail("OCR did not complete within 120s");
}
await win.waitForTimeout(2500); // let autosave flush

// Assert: a page nested under "Sources" carries the OCR'd phrase.
const ws = JSON.parse(readFileSync(join(sps, "workspace.json"), "utf-8"));
const sourcesId = Object.keys(ws.meta).find(
  (id) => ws.meta[id]?.title === "Sources",
);
if (!sourcesId) fail("no 'Sources' folder for the OCR'd PDF");
const sourcesNode = ws.tree.find((n) => n.id === sourcesId);
const child = sourcesNode?.children?.find((c) => ws.meta[c.id]?.source);
if (!child) fail("OCR'd page not nested under 'Sources'");
const text = JSON.stringify(ws.docs[child.id] || []).toUpperCase();
const norm = (s) => s.replace(/[^A-Z0-9]+/g, " ");
if (norm(text).includes("INCIDENT") && norm(text).includes("ALPHA")) {
  console.log("SMOKE_OK: scanned PDF OCR'd and filed under Sources");
} else {
  fail(`OCR'd page missing expected text; got: ${text.slice(0, 300)}`);
}
await app.close();
console.log("SMOKE_DONE");
