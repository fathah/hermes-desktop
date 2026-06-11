/**
 * Import-root resolution + idempotent copy-with-hash for the External Context
 * Bridge's IMPORT flow (3.x). A user-supplied export artifact is copied to a
 * per-source staging directory under a content-hash name, then handed to the
 * SAME scan pipeline that indexes live sources.
 *
 * PURE node (fs/crypto/path only) — NO electron, NO sqlite — so it runs under
 * vitest. The HERMES_HOME location is passed in by the caller (the IPC layer
 * resolves it via getHermesHome); `HERMES_EC_IMPORT_ROOT` overrides everything
 * for tests/smoke, mirroring the `HERMES_EC_*_ROOT` overrides the adapters use.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, join } from "node:path";
import type { ExternalImportSource } from "../../shared/external-context";

/** Length of the content-hash prefix used in import filenames (sha256 hex). */
const HASH_PREFIX_LEN = 16;

/** Base directory that holds every source's import staging folder. */
export function importRootBase(hermesHome: string): string {
  const override = process.env.HERMES_EC_IMPORT_ROOT;
  if (override && override.length > 0) return override;
  return join(hermesHome, "external-imports");
}

/** The staging directory for one import source's copied export artifacts. */
export function importRootFor(
  source: ExternalImportSource,
  hermesHome: string,
): string {
  return join(importRootBase(hermesHome), source);
}

/** sha256 of a file's bytes, truncated to {@link HASH_PREFIX_LEN} hex chars. */
export function hashFileContent(absPath: string): string {
  const bytes = readFileSync(absPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  return digest.slice(0, HASH_PREFIX_LEN);
}

/** Outcome of staging one export artifact into its import root. */
export interface ImportCopyResult {
  /** Absolute path the artifact now lives at inside the import root. */
  destPath: string;
  /** Content-hash prefix that names the file (stable per byte-content). */
  hash: string;
  /** True when an identical-content file was already staged (no re-copy). */
  reused: boolean;
}

/**
 * Copy `srcPath` into `source`'s import root under a content-hash name,
 * preserving the original extension. Idempotent: re-importing the SAME bytes
 * resolves to the SAME destination and is a no-op (`reused: true`), so the scan
 * pipeline re-indexes nothing. Returns the staged path for the caller to scan.
 */
export function copyExportToImportRoot(
  source: ExternalImportSource,
  srcPath: string,
  hermesHome: string,
): ImportCopyResult {
  if (!existsSync(srcPath) || !statSync(srcPath).isFile()) {
    throw new Error(`import source is not a readable file: ${srcPath}`);
  }
  const root = importRootFor(source, hermesHome);
  mkdirSync(root, { recursive: true });

  const hash = hashFileContent(srcPath);
  const ext = extname(srcPath).toLowerCase();
  const destPath = join(root, `${hash}${ext}`);

  if (existsSync(destPath)) {
    return { destPath, hash, reused: true };
  }
  copyFileSync(srcPath, destPath);
  return { destPath, hash, reused: false };
}
