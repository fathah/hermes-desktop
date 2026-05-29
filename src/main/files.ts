import { ipcMain } from "electron";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, resolve, normalize, sep } from "path";
import { homedir } from "os";
import { safeWriteFile } from "./utils";

const ALLOWED_ROOTS = [homedir(), process.cwd()];

function isPathUnderRoot(resolvedTarget: string, root: string): boolean {
  const resolvedRoot = normalize(resolve(root));
  if (resolvedTarget === resolvedRoot) return true;
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  return resolvedTarget.startsWith(rootPrefix);
}

function isPathAllowed(target: string): boolean {
  const resolved = normalize(resolve(target));
  return ALLOWED_ROOTS.some((root) => isPathUnderRoot(resolved, root));
}

export function registerFilesHandlers(): void {
  ipcMain.handle("files-list-dir", (_event, dir: string) => {
    const target = dir || homedir();
    if (!isPathAllowed(target)) throw new Error("Path not allowed");
    if (!existsSync(target)) return [];

    return readdirSync(target).map((name) => {
      const path = join(target, name);
      const st = statSync(path);
      return { name, isDir: st.isDirectory(), path };
    }).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  });

  ipcMain.handle("files-read", (_event, path: string) => {
    if (!isPathAllowed(path)) throw new Error("Path not allowed");
    return readFileSync(path, "utf-8");
  });

  ipcMain.handle("files-write", (_event, path: string, content: string) => {
    if (!isPathAllowed(path)) throw new Error("Path not allowed");
    safeWriteFile(path, content);
    return true;
  });
}
