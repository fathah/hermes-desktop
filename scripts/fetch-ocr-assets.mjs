// fetch-ocr-assets.mjs — populate resources/tesseract/ with the OFFLINE OCR
// assets so the app never fetches anything at runtime (privacy: the user's
// documents are OCR'd locally; only this generic public language model is
// downloaded once, here, at build/setup time — never a user document).
//
// Copies the tesseract.js worker + SIMD core from node_modules and downloads
// the English trained data. Bundled into the app via electron-builder
// extraResources; gitignored (not committed — ~11 MB).
//
// Run: node scripts/fetch-ocr-assets.mjs   (wired into predev/prebuild)
import { mkdirSync, copyFileSync, existsSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Served same-origin from the renderer at /tesseract/ (Vite copies public/ to
// the build output). Gitignored — fetched here at build/setup time.
const OUT = join(ROOT, "src", "renderer", "public", "tesseract");
const NM = join(ROOT, "node_modules");

const COPIES = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  // ESM bundle — only used by scripts/ocr-probe to verify in isolation; the app
  // imports tesseract.js from node_modules via the bundler.
  ["tesseract.js/dist/tesseract.esm.min.js", "tesseract.esm.min.js"],
  // SIMD core only (every CPU from the last decade has WASM SIMD); corePath is
  // pointed at the .wasm.js explicitly so no runtime feature-probe/fallback.
  ["tesseract.js-core/tesseract-core-simd.wasm", "tesseract-core-simd.wasm"],
  [
    "tesseract.js-core/tesseract-core-simd.wasm.js",
    "tesseract-core-simd.wasm.js",
  ],
];

const LANG = "eng";
const LANG_URL = `https://tessdata.projectnaptha.com/4.0.0/${LANG}.traineddata.gz`;
const LANG_OUT = join(OUT, `${LANG}.traineddata.gz`);

async function main() {
  mkdirSync(OUT, { recursive: true });

  for (const [src, dst] of COPIES) {
    const from = join(NM, src);
    if (!existsSync(from)) {
      console.error(`  MISSING ${src} — is tesseract.js installed?`);
      process.exit(1);
    }
    copyFileSync(from, join(OUT, dst));
    console.log(`  copied  ${dst}`);
  }

  if (existsSync(LANG_OUT)) {
    console.log(`  have    ${LANG}.traineddata.gz (cached)`);
  } else {
    console.log(`  fetch   ${LANG_URL}`);
    const res = await fetch(LANG_URL);
    if (!res.ok) {
      console.error(`  FAILED ${res.status} fetching ${LANG} model`);
      process.exit(1);
    }
    await pipeline(res.body, createWriteStream(LANG_OUT));
    console.log(`  saved   ${LANG}.traineddata.gz`);
  }

  console.log(`OCR assets ready in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
