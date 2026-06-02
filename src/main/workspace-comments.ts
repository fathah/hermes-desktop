import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { getHermesHome } from "./config";

export interface WorkspaceOptions {
  profile?: string;
  root?: string;
}

export interface WorkspaceCommentInput {
  path: string;
  blockId?: string;
  body: string;
  reminderAt?: number;
}

export interface WorkspaceComment extends WorkspaceCommentInput {
  id: string;
  status: "open" | "resolved";
  createdAt: number;
  resolvedAt?: number;
}

const COMMENTS_FILE = ".workspace-comments.json";

function workspaceBase(options: WorkspaceOptions = {}): string {
  return join(options.root ?? getHermesHome(options.profile), "workspace");
}

function commentsPath(root: string): string {
  return join(root, COMMENTS_FILE);
}

async function ensureWorkspace(
  options: WorkspaceOptions = {},
): Promise<string> {
  const root = workspaceBase(options);
  await mkdir(root, { recursive: true });
  return root;
}

async function readComments(root: string): Promise<WorkspaceComment[]> {
  if (!existsSync(commentsPath(root))) return [];
  try {
    const parsed = JSON.parse(await readFile(commentsPath(root), "utf-8"));
    return Array.isArray(parsed) ? (parsed as WorkspaceComment[]) : [];
  } catch {
    return [];
  }
}

async function writeComments(
  root: string,
  comments: WorkspaceComment[],
): Promise<void> {
  await writeFile(commentsPath(root), JSON.stringify(comments, null, 2));
}

export async function listWorkspaceComments(
  path?: string,
  options: WorkspaceOptions = {},
): Promise<WorkspaceComment[]> {
  const root = await ensureWorkspace(options);
  const comments = await readComments(root);
  return path ? comments.filter((comment) => comment.path === path) : comments;
}

export async function createWorkspaceComment(
  input: WorkspaceCommentInput,
  options: WorkspaceOptions = {},
): Promise<WorkspaceComment> {
  const root = await ensureWorkspace(options);
  const comment: WorkspaceComment = {
    ...input,
    id: randomUUID(),
    body: input.body.trim(),
    status: "open",
    createdAt: Date.now(),
  };
  const comments = await readComments(root);
  comments.push(comment);
  await writeComments(root, comments);
  return comment;
}

export async function resolveWorkspaceComment(
  id: string,
  options: WorkspaceOptions = {},
): Promise<WorkspaceComment> {
  const root = await ensureWorkspace(options);
  const comments = await readComments(root);
  const comment = comments.find((candidate) => candidate.id === id);
  if (!comment) throw new Error("Workspace comment not found");
  comment.status = "resolved";
  comment.resolvedAt = Date.now();
  await writeComments(root, comments);
  return comment;
}
