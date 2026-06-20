import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { HERMES_HOME } from "./installer/paths";
import { safeWriteFile } from "./utils";

interface GrantStore {
  files: string[];
  dirs: string[];
}

const EMPTY_STORE: GrantStore = { files: [], dirs: [] };

function grantsPath(): string {
  return join(HERMES_HOME, "file-access-grants.json");
}

function readStore(): GrantStore {
  try {
    const file = grantsPath();
    if (!existsSync(file)) return { ...EMPTY_STORE };
    const parsed = JSON.parse(
      readFileSync(file, "utf-8"),
    ) as Partial<GrantStore>;
    return {
      files: Array.isArray(parsed.files)
        ? parsed.files.filter((p): p is string => typeof p === "string")
        : [],
      dirs: Array.isArray(parsed.dirs)
        ? parsed.dirs.filter((p): p is string => typeof p === "string")
        : [],
    };
  } catch {
    return { ...EMPTY_STORE };
  }
}

function writeStore(store: GrantStore): void {
  safeWriteFile(grantsPath(), `${JSON.stringify(store, null, 2)}\n`);
}

function addUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function normalizeExistingPath(path: string): string {
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("Missing file path");
  }
  const absolute = resolve(path);
  return realpathSync(absolute);
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function assertGranted(normalized: string, allowExactFiles: boolean): void {
  const store = readStore();
  if (allowExactFiles && store.files.includes(normalized)) return;
  if (store.dirs.some((dir) => isWithin(dir, normalized))) return;
  throw new Error("Path was not granted by the user");
}

export function grantFilePath(path: string): string {
  const normalized = normalizeExistingPath(path);
  if (!statSync(normalized).isFile()) {
    throw new Error("Granted path is not a file");
  }
  const store = readStore();
  writeStore({ ...store, files: addUnique(store.files, normalized) });
  return normalized;
}

export function grantDirectoryPath(path: string): string {
  const normalized = normalizeExistingPath(path);
  if (!statSync(normalized).isDirectory()) {
    throw new Error("Granted path is not a directory");
  }
  const store = readStore();
  writeStore({ ...store, dirs: addUnique(store.dirs, normalized) });
  return normalized;
}

export function assertGrantedFilePath(path: string): string {
  const normalized = normalizeExistingPath(path);
  if (!statSync(normalized).isFile()) {
    throw new Error("Path is not a file");
  }
  assertGranted(normalized, true);
  return normalized;
}

export function assertGrantedDirectoryPath(path: string): string {
  const normalized = normalizeExistingPath(path);
  if (!statSync(normalized).isDirectory()) {
    throw new Error("Path is not a directory");
  }
  assertGranted(normalized, false);
  return normalized;
}
