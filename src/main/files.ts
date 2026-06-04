import { ipcMain } from "electron";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { HERMES_HOME } from "./installer";
import { safeWriteFile } from "./utils";
import { isRemoteOnlyMode } from "./hermes";

const ROOT_FILE = join(HERMES_HOME, "desktop", "files-workspace-root.txt");
const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

interface FileEntry {
  name: string;
  isDir: boolean;
  path: string;
  error?: string;
}

type FilesFailure = {
  success: false;
  error: string;
  unsupportedMode?: boolean;
};

type FilesSuccess<T = void> = {
  success: true;
  data?: T;
};

type FilesResult<T = void> = FilesSuccess<T> | FilesFailure;

function isFilesFailure<T>(
  result: { realRoot: string; realTarget: string } | { realRoot: string; target: string } | FilesResult<T>,
): result is FilesResult<T> {
  return "success" in result && result.success === false;
}

interface ListResult {
  root: string | null;
  cwd: string | null;
  entries: FileEntry[];
}

function unsupported(): FilesFailure {
  return {
    success: false,
    unsupportedMode: true,
    error: "Files is only available in local or SSH tunnel modes.",
  };
}

function fail(error: string): FilesFailure {
  return { success: false, error };
}

function readWorkspaceRoot(): string | null {
  try {
    if (!existsSync(ROOT_FILE)) return null;
    const raw = readFileSync(ROOT_FILE, "utf-8").trim();
    if (!raw) return null;
    return realpathSync(raw);
  } catch {
    return null;
  }
}

function writeWorkspaceRoot(root: string): void {
  safeWriteFile(ROOT_FILE, root);
}

export function isPathUnderRoot(realTarget: string, realRoot: string): boolean {
  const rel = relative(realRoot, realTarget);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function realpathParentOrThrow(parent: string): string {
  try {
    if (!existsSync(parent)) throw new Error("Path not allowed");
    return realpathSync(parent);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Path not allowed");
    }
    throw err;
  }
}

/** Resolve a path and ensure it (or its parent for new files) stays under workspace roots. */
export function assertPathAllowed(target: string, workspaceRoots: string[]): string {
  if (workspaceRoots.length === 0) {
    throw new Error("Path not allowed");
  }

  let resolved: string;
  try {
    resolved = existsSync(target) ? realpathSync(target) : resolve(target);
  } catch {
    throw new Error("Path not allowed");
  }

  const parentReal = realpathParentOrThrow(dirname(resolved));
  const allowed = workspaceRoots.some((root) => {
    try {
      const realRoot = realpathSync(root);
      if (isPathUnderRoot(parentReal, realRoot)) return true;
      if (existsSync(resolved)) {
        return isPathUnderRoot(realpathSync(target), realRoot);
      }
      return false;
    } catch {
      return false;
    }
  });

  if (!allowed) throw new Error("Path not allowed");
  return resolved;
}

function validateRoot(): string | FilesFailure {
  const root = readWorkspaceRoot();
  if (!root) return fail("Choose a workspace folder first.");
  return root;
}

function validateExistingTarget(
  path: unknown,
): { realRoot: string; realTarget: string } | FilesFailure {
  if (typeof path !== "string") return fail("Invalid path.");
  const realRoot = validateRoot();
  if (typeof realRoot !== "string") return realRoot;
  try {
    const realTarget = assertPathAllowed(path || realRoot, [realRoot]);
    return { realRoot, realTarget };
  } catch (err) {
    if (err instanceof Error && err.message === "Path not allowed") {
      return fail("Path is outside the workspace.");
    }
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function validateWriteTarget(path: unknown): { realRoot: string; target: string } | FilesFailure {
  if (typeof path !== "string" || !path.trim()) return fail("Invalid path.");
  const realRoot = validateRoot();
  if (typeof realRoot !== "string") return realRoot;
  const target = resolve(path);
  try {
    assertPathAllowed(target, [realRoot]);
    if (existsSync(target)) {
      const realTarget = realpathSync(target);
      if (statSync(realTarget).isDirectory()) return fail("Cannot write to a directory.");
    }
    return { realRoot, target };
  } catch (err) {
    if (err instanceof Error && err.message === "Path not allowed") {
      return fail("Write target is outside the workspace.");
    }
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function listEntry(parent: string, name: string, realRoot: string): FileEntry {
  const path = join(parent, name);
  try {
    const lst = lstatSync(path);
    if (lst.isSymbolicLink()) {
      const real = realpathSync(path);
      if (!isPathUnderRoot(real, realRoot)) {
        return { name, isDir: false, path, error: "Outside workspace" };
      }
      return { name, isDir: statSync(real).isDirectory(), path };
    }
    return { name, isDir: lst.isDirectory(), path };
  } catch (err) {
    return {
      name,
      isDir: false,
      path,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function containsBinaryBytes(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export function registerFilesHandlers(): void {
  ipcMain.handle("files-get-workspace-root", (): FilesResult<{ root: string | null }> => {
    if (isRemoteOnlyMode()) return unsupported();
    return { success: true, data: { root: readWorkspaceRoot() } };
  });

  ipcMain.handle("files-set-workspace-root", (_event, dir: string): FilesResult<{ root: string }> => {
    if (isRemoteOnlyMode()) return unsupported();
    if (typeof dir !== "string" || !dir.trim()) return fail("Invalid workspace folder.");
    try {
      const realRoot = realpathSync(dir);
      if (!statSync(realRoot).isDirectory()) return fail("Workspace root must be a directory.");
      writeWorkspaceRoot(realRoot);
      return { success: true, data: { root: realRoot } };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle("files-list-dir", (_event, dir: string): FilesResult<ListResult> => {
    if (isRemoteOnlyMode()) return unsupported();
    const target = validateExistingTarget(dir);
    if (isFilesFailure(target)) return target;
    if (!statSync(target.realTarget).isDirectory()) return fail("Path is not a directory.");

    const entries = readdirSync(target.realTarget)
      .map((name) => listEntry(target.realTarget, name, target.realRoot))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return {
      success: true,
      data: { root: target.realRoot, cwd: target.realTarget, entries },
    };
  });

  ipcMain.handle("files-read", (_event, path: string): FilesResult<{ text: string }> => {
    if (isRemoteOnlyMode()) return unsupported();
    const target = validateExistingTarget(path);
    if (isFilesFailure(target)) return target;
    const st = statSync(target.realTarget);
    if (!st.isFile()) return fail("Path is not a file.");
    if (st.size > MAX_READ_BYTES) return fail("File is too large to open.");
    const raw = readFileSync(target.realTarget);
    if (containsBinaryBytes(raw)) return fail("Binary files are not supported.");
    return { success: true, data: { text: raw.toString("utf-8") } };
  });

  ipcMain.handle("files-write", (_event, path: string, content: string): FilesResult => {
    if (isRemoteOnlyMode()) return unsupported();
    if (typeof content !== "string") return fail("File content must be text.");
    if (Buffer.byteLength(content, "utf-8") > MAX_WRITE_BYTES) {
      return fail("File is too large to save.");
    }
    const target = validateWriteTarget(path);
    if (isFilesFailure(target)) return target;
    safeWriteFile(target.target, content);
    return { success: true };
  });
}
