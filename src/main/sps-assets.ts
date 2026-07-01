// sps-assets.ts — content-addressed binary store for SPS journal/editor media.
//
// Photos, voice notes, video and arbitrary file uploads are NOT inlined as
// base64 in the markdown (that bloats the .md, breaks search/diff, and can't
// carry video). Instead each binary is written once to
// `<profile>/sps-agent/vault/_assets/<sha256>.<ext>` and referenced from a
// block by its filename. The markdown stores a portable relative link
// (`../_assets/<sha>.<ext>`); the renderer streams the bytes for display via
// the `sps-asset://` protocol (see index.ts). This keeps the STORAGE.md
// invariant intact: markdown on disk is the source of truth, assets are just
// more files beside it.
//
// Pure fs/path/crypto only (no Electron) so it is unit-testable; index.ts
// supplies the per-profile vault directory.
import { promises as fs, existsSync, realpathSync } from "fs";
import { isAbsolute, join, relative } from "path";
import { createHash } from "crypto";

export const ASSETS_DIR = "_assets";

// A stored asset name is a sha256 hex digest + a short extension. Validating
// against this shape is what makes the protocol handler traversal-proof: a
// crafted name can never contain a separator or `..`.
const ASSET_NAME_RE = /^[a-f0-9]{64}\.[a-z0-9]{1,8}$/;

export function isValidAssetName(name: string): boolean {
  return ASSET_NAME_RE.test(name);
}

/** Normalize a caller-supplied extension to a safe `.ext` (lowercase, alnum). */
export function sanitizeExt(ext: string): string {
  const cleaned = (ext || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return cleaned ? `.${cleaned}` : ".bin";
}

/**
 * Write bytes to the vault's `_assets/` dir under a content-addressed name and
 * return that bare filename (`<sha256>.<ext>`). Identical content de-dupes to
 * the same file, so re-pasting the same photo costs nothing.
 */
export async function writeAsset(
  vaultDir: string,
  bytes: Buffer,
  ext: string,
): Promise<string> {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const name = `${sha}${sanitizeExt(ext)}`;
  const dir = join(vaultDir, ASSETS_DIR);
  await fs.mkdir(dir, { recursive: true });
  const target = join(dir, name);
  if (!existsSync(target)) await fs.writeFile(target, bytes);
  return name;
}

/** True only when `name` is a valid asset name and the file exists. */
export function assetExists(vaultDir: string, name: string): boolean {
  return resolveAssetPath(vaultDir, name) !== null;
}

/**
 * Resolve a validated asset name to its absolute path, or null when the name
 * is malformed. Existence is the caller's concern. Traversal-safe by virtue of
 * the strict name check.
 */
export function resolveAssetPath(
  vaultDir: string,
  name: string,
): string | null {
  if (!isValidAssetName(name)) return null;
  const dir = join(vaultDir, ASSETS_DIR);
  const target = join(dir, name);
  if (!existsSync(target)) return null;
  try {
    const root = realpathSync(dir);
    const resolved = realpathSync(target);
    const rel = relative(root, resolved);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Delete every asset in `_assets/` that is NOT in `referenced`. Files that do
 * not match the asset-name shape are left untouched (never delete something we
 * didn't create). Returns the number of files removed. Best-effort.
 */
export async function gcAssets(
  vaultDir: string,
  referenced: string[],
): Promise<number> {
  const dir = join(vaultDir, ASSETS_DIR);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  const keep = new Set(referenced.filter(isValidAssetName));
  let removed = 0;
  for (const name of names) {
    if (!isValidAssetName(name)) continue;
    if (keep.has(name)) continue;
    try {
      await fs.rm(join(dir, name));
      removed += 1;
    } catch {
      /* locked / already gone — best-effort */
    }
  }
  return removed;
}
