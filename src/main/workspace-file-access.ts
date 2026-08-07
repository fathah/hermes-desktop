import { createHash, randomUUID } from "crypto";
import { open, realpath, rename, stat, unlink } from "fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "path";

export const DEFAULT_WORKSPACE_FILE_READ_BYTES = 100 * 1024;
export const MAX_WORKSPACE_FILE_READ_BYTES = 1024 * 1024;
export const MAX_WORKSPACE_FILE_EDIT_BYTES = 1024 * 1024;

export interface WorkspaceFileReadResult {
  content: string;
  truncated: boolean;
  editToken?: string;
}

export type WorkspaceFileSaveError =
  | "invalid-token"
  | "stale"
  | "too-large"
  | "write-failed";

export type WorkspaceFileSaveResult =
  | { success: true }
  | { success: false; error: WorkspaceFileSaveError };

interface EditTokenRecord {
  ownerId: number;
  requestedPath: string;
  workspaceRootPath: string;
  canonicalPath: string;
  canonicalRoot: string;
  contentHash: string;
}

interface BoundedFileRead {
  buffer: Buffer;
  truncated: boolean;
  mode: number;
}

interface CanonicalWorkspacePath {
  requestedPath: string;
  workspaceRootPath: string;
  canonicalPath: string;
  canonicalRoot: string;
}

function normalizeReadLimit(maxBytes: number | undefined): number {
  if (maxBytes === undefined || !Number.isFinite(maxBytes)) {
    return DEFAULT_WORKSPACE_FILE_READ_BYTES;
  }
  return Math.min(
    MAX_WORKSPACE_FILE_READ_BYTES,
    Math.max(0, Math.floor(maxBytes)),
  );
}

function contentHash(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function isWithinDirectory(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

async function canonicalWorkspacePath(
  filePath: string,
  workspaceRoot: string,
): Promise<CanonicalWorkspacePath | null> {
  if (!filePath.trim() || !workspaceRoot.trim()) return null;

  try {
    const workspaceRootPath = resolve(workspaceRoot);
    const requestedPath = isAbsolute(filePath)
      ? resolve(filePath)
      : resolve(workspaceRootPath, filePath);
    const [canonicalRoot, canonicalPath] = await Promise.all([
      realpath(workspaceRootPath),
      realpath(requestedPath),
    ]);
    const rootInfo = await stat(canonicalRoot);
    if (
      !rootInfo.isDirectory() ||
      !isWithinDirectory(canonicalRoot, canonicalPath)
    ) {
      return null;
    }
    return {
      requestedPath,
      workspaceRootPath,
      canonicalPath,
      canonicalRoot,
    };
  } catch {
    return null;
  }
}

async function boundedFileRead(
  canonicalPath: string,
  maxBytes: number,
): Promise<BoundedFileRead | null> {
  let handle;
  try {
    handle = await open(canonicalPath, "r");
    const info = await handle.stat();
    if (!info.isFile()) return null;

    // Read one extra byte so truncation is detected without ever loading the
    // complete file into memory.
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    return {
      buffer: buffer.subarray(0, Math.min(offset, maxBytes)),
      truncated: offset > maxBytes,
      mode: info.mode,
    };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function atomicWrite(
  targetPath: string,
  content: Buffer,
  mode: number,
): Promise<void> {
  const tempPath = resolve(
    dirname(targetPath),
    `.${basename(targetPath)}.hermes-edit-${randomUUID()}.tmp`,
  );
  let handle;
  let tempExists = false;
  try {
    handle = await open(tempPath, "wx", mode & 0o777);
    tempExists = true;
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, targetPath);
    tempExists = false;
  } finally {
    await handle?.close().catch(() => undefined);
    if (tempExists) await unlink(tempPath).catch(() => undefined);
  }
}

/**
 * Owns renderer-bound edit capabilities. A token never contains a path and can
 * only be reused by the WebContents owner that received it.
 */
// @lat: [[code-editor#Project code workspace#Capability-bound saves]]
export class WorkspaceFileAccess {
  private readonly editTokens = new Map<string, EditTokenRecord>();

  async read(
    ownerId: number,
    filePath: string,
    maxBytes?: number,
    workspaceRoot?: string,
  ): Promise<WorkspaceFileReadResult | null> {
    if (typeof filePath !== "string" || !filePath.trim()) return null;
    const limit = normalizeReadLimit(maxBytes);

    if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
      try {
        const canonicalPath = await realpath(resolve(filePath));
        const result = await boundedFileRead(canonicalPath, limit);
        if (!result) return null;
        return {
          content: result.buffer.toString("utf-8"),
          truncated: result.truncated,
        };
      } catch {
        return null;
      }
    }

    const resolved = await canonicalWorkspacePath(filePath, workspaceRoot);
    if (!resolved) return null;
    const result = await boundedFileRead(resolved.canonicalPath, limit);
    if (!result) return null;

    const response: WorkspaceFileReadResult = {
      content: result.buffer.toString("utf-8"),
      truncated: result.truncated,
    };
    if (!result.truncated) {
      const editToken = randomUUID();
      this.editTokens.set(editToken, {
        ownerId,
        ...resolved,
        contentHash: contentHash(result.buffer),
      });
      response.editToken = editToken;
    }
    return response;
  }

  async save(
    ownerId: number,
    editToken: string,
    content: string,
  ): Promise<WorkspaceFileSaveResult> {
    if (typeof editToken !== "string" || !editToken) {
      return { success: false, error: "invalid-token" };
    }
    const record = this.editTokens.get(editToken);
    if (!record || record.ownerId !== ownerId) {
      return { success: false, error: "invalid-token" };
    }
    if (typeof content !== "string") {
      return { success: false, error: "write-failed" };
    }

    const nextContent = Buffer.from(content, "utf-8");
    if (nextContent.byteLength > MAX_WORKSPACE_FILE_EDIT_BYTES) {
      return { success: false, error: "too-large" };
    }

    const currentPath = await canonicalWorkspacePath(
      record.requestedPath,
      record.workspaceRootPath,
    );
    if (
      !currentPath ||
      currentPath.canonicalRoot !== record.canonicalRoot ||
      currentPath.canonicalPath !== record.canonicalPath
    ) {
      return { success: false, error: "stale" };
    }

    const current = await boundedFileRead(
      currentPath.canonicalPath,
      MAX_WORKSPACE_FILE_EDIT_BYTES,
    );
    if (
      !current ||
      current.truncated ||
      contentHash(current.buffer) !== record.contentHash
    ) {
      return { success: false, error: "stale" };
    }

    try {
      await atomicWrite(currentPath.canonicalPath, nextContent, current.mode);
      record.contentHash = contentHash(nextContent);
      return { success: true };
    } catch {
      return { success: false, error: "write-failed" };
    }
  }

  releaseOwner(ownerId: number): void {
    for (const [token, record] of this.editTokens) {
      if (record.ownerId === ownerId) this.editTokens.delete(token);
    }
  }
}
