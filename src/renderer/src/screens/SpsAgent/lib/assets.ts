// assets.ts — renderer-side helpers for the SPS vault asset store.
//
// Binaries are written to vault/_assets/<sha256>.<ext> by the main process
// (window.hermesAPI.spsAssetWrite) and streamed back for display through the
// sps-asset:// protocol. Blocks store the bare asset filename in `assetPath`;
// the markdown serializer writes the portable relative link `../_assets/<name>`.
import type { Block } from "../types";

/** Relative link prefix written into markdown (portable / Obsidian-friendly). */
export const ASSET_REL_PREFIX = "../_assets/";

/** A displayable URL for an asset filename, streamed by the custom protocol. */
export function assetUrl(name: string): string {
  return `sps-asset://asset/${encodeURIComponent(name)}`;
}

/** The relative markdown link for an asset filename. */
export function assetRel(name: string): string {
  return `${ASSET_REL_PREFIX}${name}`;
}

/** Extract the bare asset filename from a relative link, or null if it isn't
 *  one. Accepts `../_assets/x`, `_assets/x`, and `./_assets/x`. */
export function assetNameFromRel(link: string): string | null {
  const m = /(?:^|\/)_assets\/([^/?#]+)$/.exec(link.trim());
  return m ? decodeURIComponent(m[1]) : null;
}

/** Pick a file extension for an uploaded file from its name, else its mime. */
export function extForFile(file: { name?: string; type?: string }): string {
  const fromName = file.name?.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1)
    : "";
  if (fromName) return fromName;
  const fromMime = file.type?.includes("/") ? file.type.split("/")[1] : "";
  return fromMime || "bin";
}

export interface WrittenAsset {
  assetPath: string;
  mime: string;
  name: string;
  size: number;
}

/** Write a File/Blob's bytes into the vault asset store. Returns the stored
 *  filename + metadata, or null when the main bridge is unavailable. */
export async function writeAssetFromBlob(
  blob: Blob,
  fileName: string,
): Promise<WrittenAsset | null> {
  const api = window.hermesAPI;
  if (!api?.spsAssetWrite) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  const ext = extForFile({ name: fileName, type: blob.type });
  const assetPath = await api.spsAssetWrite(buf, ext);
  return {
    assetPath,
    mime: blob.type || "application/octet-stream",
    name: fileName,
    size: blob.size,
  };
}

/** Every asset filename referenced by a block list (for GC). */
export function referencedAssets(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.assetPath) out.push(b.assetPath);
  }
  return out;
}

/** Human-readable byte size, e.g. "2.4 MB". */
export function prettySize(bytes?: number): string {
  if (!bytes || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n >= 10 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}
