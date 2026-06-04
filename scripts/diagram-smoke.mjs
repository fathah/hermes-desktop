/* eslint-disable @typescript-eslint/explicit-function-return-type */
// diagram-smoke.mjs — runtime verification for the Mermaid + Excalidraw blocks.
//
// Launches the BUILT Electron app (run `npm run build` first) against a
// throwaway pre-seeded profile and proves, in the REAL renderer (which the unit
// suite can't reach):
//   • a seeded Mermaid block renders to an <svg>
//   • a seeded Excalidraw block loads its sidecar scene and renders a preview
//   • inserting a NEW Excalidraw block via the slash menu + drawing on it writes
//     the sidecar assets and records a clean image ref
//   • the on-disk page markdown stays CLEAN (```mermaid fence + .excalidraw.svg
//     image ref, NO base64 / <!-- sps: --> blob)
//
// Usage: npm run build && node scripts/diagram-smoke.mjs
import { _electron as electron } from "playwright";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OUT = process.env.SMOKE_OUT || join(tmpdir(), "diagram-smoke");
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), "hermes-dsmoke-"));

// install markers → App.tsx routes straight to the SPS main screen
mkdirSync(join(HOME, "hermes-agent", "venv", "bin"), { recursive: true });
writeFileSync(join(HOME, "hermes-agent", "venv", "bin", "python"), "");
writeFileSync(join(HOME, "hermes-agent", "hermes"), "");
writeFileSync(join(HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-0000000000\n");
writeFileSync(
  join(HOME, "config.yaml"),
  "model:\n  provider: anthropic\n  model: claude-3-5-sonnet\n",
);

const sps = join(HOME, "sps-agent");
const vault = join(sps, "vault");
mkdirSync(join(vault, "assets", "diagrams"), { recursive: true });

// pre-seed an Excalidraw sidecar (scene + preview svg) for the LOAD path
writeFileSync(
  join(vault, "assets", "diagrams", "exseed1.excalidraw"),
  JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {} }),
);
writeFileSync(
  join(vault, "assets", "diagrams", "exseed1.excalidraw.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="90">' +
    '<rect x="8" y="8" width="204" height="74" rx="8" fill="#dbeafe" stroke="#2563eb"/>' +
    '<text x="24" y="52" font-family="sans-serif" font-size="15">seeded scene</text></svg>',
);

const workspace = {
  tree: [
    { id: "diagrams", children: [] },
    { id: "draw", children: [] },
  ],
  meta: {
    diagrams: { icon: "📊", title: "Diagrams", cover: null },
    draw: { icon: "✎", title: "Draw", cover: null },
  },
  docs: {
    diagrams: [
      { id: "dh", type: "h1", text: "Diagrams" },
      { id: "mm", type: "mermaid", text: "graph TD;\n  A[Start] --> B[End]" },
      { id: "px", type: "p", text: "Below: a seeded Excalidraw drawing." },
      {
        id: "exb",
        type: "excalidraw",
        text: "",
        src: "assets/diagrams/exseed1.excalidraw.svg",
        caption: "",
      },
    ],
    draw: [{ id: "d0", type: "p", text: "" }],
  },
  comments: [],
  trash: [],
  page: "diagrams",
};
writeFileSync(join(sps, "workspace.json"), JSON.stringify(workspace, null, 2));

console.log("HERMES_HOME=", HOME);
setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(2);
}, 120000).unref();

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
};

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, HERMES_HOME: HOME, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForSelector(".app", { timeout: 30000 });
await win.waitForTimeout(2500);

// ── 1. Mermaid renders to an <svg> ─────────────────────────────────────────
const mermaidSvgs = await win.locator(".b-mermaid-preview svg").count();
check("mermaid block renders an <svg>", mermaidSvgs >= 1, `${mermaidSvgs} svg`);

// ── 2. Seeded Excalidraw loads its sidecar preview ─────────────────────────
const excPreview = await win.locator(".b-excalidraw-preview svg").count();
check("seeded excalidraw renders preview from sidecar", excPreview >= 1, `${excPreview} svg`);

await win.screenshot({ path: join(OUT, "01-diagrams.png") });

// ── 3. On-disk markdown for the seeded page is CLEAN ───────────────────────
// The store mirrors every page to markdown on hydrate; give it a moment.
await win.waitForTimeout(1500);
const diagramsMd = existsSync(join(vault, "diagrams.md"))
  ? readFileSync(join(vault, "diagrams.md"), "utf-8")
  : "";
check("vault diagrams.md was written", diagramsMd.length > 0);
check("markdown has a ```mermaid fence", diagramsMd.includes("```mermaid"));
check("markdown has the .excalidraw.svg image ref", diagramsMd.includes(".excalidraw.svg"));
check("markdown has NO base64 tier-2 blob", !diagramsMd.includes("<!-- sps:"));

// ── 4. Create path: insert a NEW excalidraw block + draw on it ─────────────
try {
  await win.getByText("Draw", { exact: true }).first().click();
  await win.waitForTimeout(600);
  // focus the (empty) first block and open the slash menu
  const body = win.locator(".editor, .doc, [contenteditable=true]").first();
  await body.click();
  await win.keyboard.type("/excalidraw");
  await win.waitForTimeout(400);
  await win.keyboard.press("Enter");
  // lazy Excalidraw chunk mounts
  await win.waitForSelector(".excalidraw, .b-excalidraw .exc-canvas", { timeout: 20000 });
  await win.waitForTimeout(1500);
  check("excalidraw canvas mounted (lazy chunk loaded)", true);

  // draw a rectangle: select the rectangle tool, drag on the canvas
  const canvas = win.locator(".excalidraw canvas").first();
  const box = await canvas.boundingBox();
  if (box) {
    await win.keyboard.press("r"); // Excalidraw: rectangle tool
    await win.mouse.move(box.x + 80, box.y + 80);
    await win.mouse.down();
    await win.mouse.move(box.x + 260, box.y + 190, { steps: 8 });
    await win.mouse.up();
    await win.keyboard.press("Escape");
  }
  await win.waitForTimeout(1200); // ExcalidrawCanvas debounce (600ms) + write
  await win.screenshot({ path: join(OUT, "02-excalidraw-canvas.png") });

  // sidecar files for the "draw" page should now exist
  const drawAssets = join(vault, "assets", "draw");
  const files = existsSync(drawAssets) ? readdirSync(drawAssets) : [];
  const hasScene = files.some((f) => f.endsWith(".excalidraw"));
  const hasSvg = files.some((f) => f.endsWith(".excalidraw.svg"));
  check("drawing wrote a .excalidraw sidecar", hasScene, files.join(", "));
  check("drawing wrote a .excalidraw.svg preview", hasSvg, files.join(", "));
} catch (e) {
  check("create+draw path", false, e.message);
}

console.log(
  "\nSUMMARY:",
  results.filter((r) => r.ok).length,
  "/",
  results.length,
  "checks passed",
);
console.log("Screenshots in", OUT);
await app.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
