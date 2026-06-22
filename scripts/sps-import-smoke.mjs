// sps-import-smoke.mjs — KB Phase 0 UI smoke: drive the "Import PDF" flow end to
// end through the BUILT Electron app (run `npm run build` first).
//
// The one thing Playwright can't click is the OS file-picker. We stub
// dialog.showOpenDialog in the MAIN process to return a fixture PDF path, so
// spsPickPdf resolves and the REAL renderer flow runs: spsExtractPdf (real
// pdfjs) → pageFromMarkdown → makePage → mirror → index. We then assert the
// ingested text actually rendered in the editor.
//
// Usage:  npm run build && node scripts/sps-import-smoke.mjs
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "sps-import-smoke");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-import-smoke-"));

// ── A minimal, valid single-page text PDF (byte-offset-correct xref) so the
//    extractor finds a real text layer. No system PDFs / external fixtures. ────
function makeTextPdf(lines) {
  const esc = (s) => s.replace(/([()\\])/g, "\\$1");
  const text = lines
    .map((l, i) => `${i === 0 ? "" : "0 -24 Td "}(${esc(l)}) Tj`)
    .join(" ");
  const stream = `BT /F1 16 Tf 72 720 Td ${text} ET`;
  const objs = [
    `<</Type/Catalog/Pages 2 0 R>>`,
    `<</Type/Pages/Kids[3 0 R]/Count 1>>`,
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>`,
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`,
  ];
  let pdf = `%PDF-1.4\n`;
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(
    (off) => (pdf += `${String(off).padStart(10, "0")} 00000 n \n`),
  );
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const FIXTURE = join(HOME, "France-handbook.pdf");
const SENTENCE = "The capital of France is Paris.";
writeFileSync(
  FIXTURE,
  makeTextPdf([SENTENCE, "Rest periods are twenty minutes per shift."]),
);

// ── install markers + a minimal SPS workspace so App.tsx boots into SPS. ──────
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);
writeFileSync(
  join(HOME, "desktop.json"),
  JSON.stringify(
    { onboardingCompleted: true, schedulerEnabled: false },
    null,
    2,
  ),
);
const sps = join(HOME, "sps-agent");
mkdirSync(join(sps, "vault"), { recursive: true });
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

console.log("HERMES_HOME=", HOME);
const fail = (m) => {
  console.log("SMOKE_FAIL:", m);
  process.exit(1);
};
setTimeout(() => fail("WATCHDOG_TIMEOUT"), 120000).unref();

const app = await electron.launch({
  // Own userData dir → own single-instance lock, so the smoke runs even when a
  // developer's app is open (which holds the default lock; see main).
  args: [".", `--user-data-dir=${join(HOME, "electron-userdata")}`],
  env: {
    ...process.env,
    HERMES_HOME: HOME,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});

// Stub the native file picker in the MAIN process to return our fixture.
await app.evaluate(async ({ dialog }, fixture) => {
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [fixture],
  });
}, FIXTURE);

const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
// Give the window a generous size so the (now longer) template grid fits and
// every card — including the last one, Import PDF — is within the viewport.
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 1200);
});
await win.waitForTimeout(1500);
await win.screenshot({ path: join(OUT, "01-before.png") });

// Open the "New page" template modal, then click the Import PDF card.
await win.locator(".rail-compose").first().click();
await win.waitForSelector(".tpl-card", { timeout: 10000 });
await win.screenshot({ path: join(OUT, "02-templates-modal.png") });
const importCard = win.locator(".tpl-card", { hasText: "Import PDF" });
if ((await importCard.count()) === 0) fail('no "Import PDF" card in the modal');
// The card is the last in a now-longer template grid; scroll it into view so
// the click is actionable regardless of how many templates precede it.
await importCard.first().scrollIntoViewIfNeeded();
await importCard.first().click();

// The real flow runs (stubbed picker → real extract → makePage). Assert the
// ingested PDF text rendered in the editor.
try {
  await win
    .getByText(SENTENCE, { exact: false })
    .first()
    .waitFor({ timeout: 20000 });
} catch {
  await win.screenshot({ path: join(OUT, "99-no-content.png") });
  fail(`ingested text "${SENTENCE}" never rendered`);
}
await win.waitForTimeout(500);
await win.screenshot({ path: join(OUT, "03-imported-page.png") });

// The new page should carry the PDF's base name as its title.
const titled = await win.getByText("France-handbook", { exact: false }).count();
console.log("page-title-visible:", titled > 0);

// Item 4: the ingested page must nest under a "Sources" folder. Assert from the
// persisted workspace.json (robust, no DOM-structure coupling) after autosave.
await win.waitForTimeout(2000);
const ws = JSON.parse(readFileSync(join(sps, "workspace.json"), "utf-8"));
const sourcesId = Object.keys(ws.meta).find(
  (id) => ws.meta[id]?.title === "Sources",
);
if (!sourcesId) fail("no 'Sources' folder was created for the ingested PDF");
const sourcesNode = ws.tree.find((n) => n.id === sourcesId);
const child = sourcesNode?.children?.find((c) => ws.meta[c.id]?.source);
if (!child) fail("ingested page is not nested inside the 'Sources' folder");
console.log("sources-folder-nesting: OK (ingested page under Sources)");

console.log("SMOKE_OK: import flow rendered ingested PDF content");
await app.close();
console.log("SMOKE_DONE");
