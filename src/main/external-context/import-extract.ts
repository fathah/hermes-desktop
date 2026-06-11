/**
 * Resolve a user-supplied export artifact down to the single JSON/JSONL payload
 * the matching adapter parses. ChatGPT / Claude.ai / Gemini-Takeout exports are
 * ZIPs (conversations.json / MyActivity.json buried inside); a Grok session is a
 * bare .jsonl. PURE node (fs + adm-zip, no electron/sqlite) so it runs under
 * vitest. The caller then content-hash-copies the payload into the import root.
 */
import AdmZip from "adm-zip";
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import type { ExternalImportSource } from "../../shared/external-context";

/** The export entry each source's archive is expected to contain. */
const PAYLOAD_PATTERN: Record<ExternalImportSource, RegExp> = {
  chatgpt: /(^|\/)conversations\.json$/i,
  "claude-ai": /(^|\/)conversations\.json$/i,
  "gemini-takeout": /(^|\/)MyActivity\.json$/i,
  "grok-export": /\.jsonl?$/i,
};

/** Any conversation-shaped entry, used as a fallback when the named one is absent. */
const ANY_JSON = /\.jsonl?$/i;

/** Sniff the ZIP local-file-header magic (PK\x03\x04) without reading the body. */
function looksLikeZip(filePath: string): boolean {
  if (extname(filePath).toLowerCase() === ".zip") return true;
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    readSync(fd, buf, 0, 4, 0);
    return (
      buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
    );
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export interface ExtractResult {
  /** Absolute path to the JSON/JSONL payload to stage + scan. */
  payloadPath: string;
  /** True when the payload was unpacked from a ZIP into `tmpDir`. */
  extracted: boolean;
}

/**
 * Resolve `filePath` to the payload the `source` adapter parses. A bare
 * JSON/JSONL is returned as-is; a ZIP is searched for the source's expected
 * entry (then any JSON/JSONL entry) and that one is written into `tmpDir`.
 * Throws a clear error when the archive contains nothing usable.
 */
export function extractImportPayload(
  source: ExternalImportSource,
  filePath: string,
  tmpDir: string,
): ExtractResult {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`import file not found: ${filePath}`);
  }
  if (!looksLikeZip(filePath)) {
    return { payloadPath: filePath, extracted: false };
  }

  const zip = new AdmZip(filePath);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const pattern = PAYLOAD_PATTERN[source];
  const entry =
    entries.find((e) => pattern.test(e.entryName)) ??
    entries.find((e) => ANY_JSON.test(e.entryName));
  if (!entry) {
    throw new Error(
      `no conversation export (.json/.jsonl) found in archive ${basename(filePath)}`,
    );
  }

  const out = join(tmpDir, basename(entry.entryName));
  writeFileSync(out, entry.getData());
  return { payloadPath: out, extracted: true };
}
