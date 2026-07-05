import { isAbsolute, join, relative, resolve, win32 } from "path";
import { normalizeProfileName } from "../utils";

export function assertIpcString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  if (value.includes("\0")) {
    throw new Error(`${label} contains a null byte.`);
  }
  return value;
}

export function normalizeIpcProfile(profile?: unknown): string | undefined {
  if (profile === undefined) return undefined;
  return normalizeProfileName(assertIpcString(profile, "profile"));
}

export function assertPathInside(
  root: string,
  relativePath: unknown,
  label: string,
): string {
  const rootPath = assertIpcString(root, "root path");
  const rawPath = assertIpcString(relativePath, label);
  const portablePath = rawPath.replace(/\\/g, "/");
  if (!portablePath) {
    throw new Error(`${label} must not be empty.`);
  }
  if (isAbsolute(rawPath) || win32.isAbsolute(rawPath)) {
    throw new Error(`${label} must be relative.`);
  }

  const parts = portablePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must stay inside the allowed directory.`);
  }

  const resolvedRoot = resolve(rootPath);
  const resolvedPath = resolve(join(resolvedRoot, ...parts));
  const rel = relative(resolvedRoot, resolvedPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the allowed directory.`);
  }
  return resolvedPath;
}
