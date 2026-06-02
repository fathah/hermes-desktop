import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getHermesHome } from "./config";

export interface WorkspaceOptions {
  profile?: string;
  root?: string;
}

export interface WorkspaceSyncedBlockReference {
  path: string;
  blockId: string;
}

export interface WorkspaceSyncedBlock {
  id: string;
  sourcePath: string;
  sourceBlockId: string;
  content: string;
  references: WorkspaceSyncedBlockReference[];
  updatedAt: number;
}

export interface CreateWorkspaceSyncedBlockInput {
  sourcePath: string;
  sourceBlockId: string;
  content: string;
  references?: WorkspaceSyncedBlockReference[];
}

const SYNCED_BLOCKS_FILE = ".workspace-synced-blocks.json";

function workspaceBase(options: WorkspaceOptions = {}): string {
  return join(options.root ?? getHermesHome(options.profile), "workspace");
}

function storePath(root: string): string {
  return join(root, SYNCED_BLOCKS_FILE);
}

async function ensureWorkspace(
  options: WorkspaceOptions = {},
): Promise<string> {
  const root = workspaceBase(options);
  await mkdir(root, { recursive: true });
  return root;
}

async function readSyncedBlocks(root: string): Promise<WorkspaceSyncedBlock[]> {
  if (!existsSync(storePath(root))) return [];
  try {
    const parsed = JSON.parse(await readFile(storePath(root), "utf-8"));
    return Array.isArray(parsed) ? (parsed as WorkspaceSyncedBlock[]) : [];
  } catch {
    return [];
  }
}

async function writeSyncedBlocks(
  root: string,
  blocks: WorkspaceSyncedBlock[],
): Promise<void> {
  await writeFile(storePath(root), JSON.stringify(blocks, null, 2));
}

export async function listWorkspaceSyncedBlocks(
  options: WorkspaceOptions = {},
): Promise<WorkspaceSyncedBlock[]> {
  const root = await ensureWorkspace(options);
  return readSyncedBlocks(root);
}

export async function createWorkspaceSyncedBlock(
  input: CreateWorkspaceSyncedBlockInput,
  options: WorkspaceOptions = {},
): Promise<WorkspaceSyncedBlock> {
  const root = await ensureWorkspace(options);
  const block: WorkspaceSyncedBlock = {
    id: `synced-${Date.now()}`,
    sourcePath: input.sourcePath,
    sourceBlockId: input.sourceBlockId,
    content: input.content,
    references: input.references ?? [],
    updatedAt: Date.now(),
  };
  const blocks = await readSyncedBlocks(root);
  blocks.push(block);
  await writeSyncedBlocks(root, blocks);
  return block;
}

export async function updateWorkspaceSyncedBlockContent(
  id: string,
  content: string,
  options: WorkspaceOptions = {},
): Promise<WorkspaceSyncedBlock> {
  const root = await ensureWorkspace(options);
  const blocks = await readSyncedBlocks(root);
  const block = blocks.find((candidate) => candidate.id === id);
  if (!block) throw new Error("Workspace synced block not found");
  block.content = content;
  block.updatedAt = Date.now();
  await writeSyncedBlocks(root, blocks);
  return block;
}

export async function removeWorkspaceSyncedBlockReference(
  id: string,
  path: string,
  blockId: string,
  options: WorkspaceOptions = {},
): Promise<WorkspaceSyncedBlock> {
  const root = await ensureWorkspace(options);
  const blocks = await readSyncedBlocks(root);
  const block = blocks.find((candidate) => candidate.id === id);
  if (!block) throw new Error("Workspace synced block not found");
  block.references = block.references.filter(
    (reference) => reference.path !== path || reference.blockId !== blockId,
  );
  block.updatedAt = Date.now();
  await writeSyncedBlocks(root, blocks);
  return block;
}
