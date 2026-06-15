import { existsSync, mkdirSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import type {
  VaultOperation,
  VaultOperationStatus,
  VaultProposal,
  VaultProposalInput,
  VaultProposalStatus,
} from "../shared/sps-types";
import { profileHome, safeWriteFile } from "./utils";

const STORE_FILE = "vault-review-queue.json";

function storePathFromRoot(profileRoot: string): string {
  return join(profileRoot, "sps-agent", STORE_FILE);
}

function storePath(profile?: string): string {
  return storePathFromRoot(profileHome(profile));
}

function proposalId(): string {
  return `vp_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function opStatus(status: VaultOperationStatus | undefined): VaultOperationStatus {
  return status ?? "pending";
}

function normalizeOperation(op: VaultOperation, index: number): VaultOperation {
  return {
    ...op,
    id: op.id || `op_${index + 1}`,
    operationStatus: opStatus(op.operationStatus),
  } as VaultOperation;
}

function normalizeProposal(
  input: VaultProposalInput,
  now = Date.now(),
): VaultProposal {
  return {
    id: proposalId(),
    source: input.source,
    title: input.title.trim() || "Vault proposal",
    summary: input.summary.trim(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    operations: input.operations.map(normalizeOperation),
  };
}

function readStore(path: string): VaultProposal[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(parsed) ? (parsed as VaultProposal[]) : [];
  } catch {
    return [];
  }
}

async function writeStore(path: string, proposals: VaultProposal[]): Promise<void> {
  await writeFile(path, JSON.stringify(proposals, null, 2), "utf-8");
}

export async function listVaultProposalsIn(
  profileRoot: string,
): Promise<VaultProposal[]> {
  return readStore(storePathFromRoot(profileRoot));
}

export async function createVaultProposalIn(
  profileRoot: string,
  input: VaultProposalInput,
): Promise<VaultProposal> {
  const path = storePathFromRoot(profileRoot);
  mkdirSync(dirname(path), { recursive: true });
  const proposals = readStore(path);
  const proposal = normalizeProposal(input);
  proposals.push(proposal);
  await writeStore(path, proposals);
  return proposal;
}

export async function dismissVaultProposalIn(
  profileRoot: string,
  id: string,
): Promise<VaultProposal | null> {
  return updateProposalStatusIn(profileRoot, id, "dismissed");
}

export async function updateProposalStatusIn(
  profileRoot: string,
  id: string,
  status: VaultProposalStatus,
  operationIds?: string[],
): Promise<VaultProposal | null> {
  const path = storePathFromRoot(profileRoot);
  const proposals = readStore(path);
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) return null;
  const selected = operationIds ? new Set(operationIds) : null;
  proposal.status = status;
  proposal.updatedAt = Date.now();
  if (status === "committed") {
    proposal.operations = proposal.operations.map((op) =>
      selected && !selected.has(op.id)
        ? ({ ...op, operationStatus: "skipped" } as VaultOperation)
        : ({ ...op, operationStatus: "committed" } as VaultOperation),
    );
  }
  await writeStore(path, proposals);
  return proposal;
}

export async function listVaultProposals(
  profile?: string,
): Promise<VaultProposal[]> {
  return readStore(storePath(profile));
}

export async function createVaultProposal(
  input: VaultProposalInput,
  profile?: string,
): Promise<VaultProposal> {
  return createVaultProposalIn(profileHome(profile), input);
}

export async function dismissVaultProposal(
  id: string,
  profile?: string,
): Promise<VaultProposal | null> {
  return dismissVaultProposalIn(profileHome(profile), id);
}

export async function markVaultProposalCommitted(
  id: string,
  operationIds?: string[],
  profile?: string,
): Promise<VaultProposal | null> {
  return updateProposalStatusIn(profileHome(profile), id, "committed", operationIds);
}

export function writeVaultProposalStoreSync(
  profileRoot: string,
  proposals: VaultProposal[],
): void {
  const path = storePathFromRoot(profileRoot);
  mkdirSync(dirname(path), { recursive: true });
  safeWriteFile(path, JSON.stringify(proposals, null, 2));
}
