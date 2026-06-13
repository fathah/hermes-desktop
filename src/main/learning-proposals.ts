import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { addMemoryEntry, readMemory, removeMemoryEntry } from "./memory";
import { createSkill, setSkillEnabled } from "./skills";
import { profileHome, safeWriteFile } from "./utils";
import type {
  CreateLearningProposalInput,
  LearningProposal,
  LearningProposalResult,
} from "../shared/learning";

function proposalsPath(profile?: string): string {
  return join(profileHome(profile), "sps-agent", "learning-proposals.json");
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function newId(): string {
  return `lp_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function readStore(profile?: string): LearningProposal[] {
  const file = proposalsPath(profile);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLearningProposal);
  } catch {
    return [];
  }
}

function writeStore(proposals: LearningProposal[], profile?: string): void {
  safeWriteFile(
    proposalsPath(profile),
    `${JSON.stringify(proposals, null, 2)}\n`,
  );
}

function isLearningProposal(value: unknown): value is LearningProposal {
  if (!value || typeof value !== "object") return false;
  const p = value as { id?: unknown; kind?: unknown; status?: unknown };
  return (
    typeof p.id === "string" &&
    (p.kind === "memory" || p.kind === "skill") &&
    typeof p.status === "string"
  );
}

function replaceProposal(
  proposals: LearningProposal[],
  next: LearningProposal,
): LearningProposal[] {
  return proposals.map((p) => (p.id === next.id ? next : p));
}

export function listLearningProposals(profile?: string): LearningProposal[] {
  return readStore(profile);
}

export function createLearningProposal(
  input: CreateLearningProposalInput,
  profile?: string,
): LearningProposalResult {
  const ts = now();
  let proposal: LearningProposal;
  if (input.kind === "memory") {
    const body = input.body.trim();
    if (!body) return { ok: false, error: "Memory proposal is empty." };
    proposal = {
      id: newId(),
      kind: "memory",
      status: "pending",
      createdAt: ts,
      updatedAt: ts,
      body,
      reason: input.reason?.trim() || undefined,
      source: input.source,
    };
  } else {
    const name = input.draft.name.trim();
    const body = input.draft.body.trim();
    if (!name) return { ok: false, error: "Skill name is required." };
    if (!body) return { ok: false, error: "Skill body is required." };
    proposal = {
      id: newId(),
      kind: "skill",
      status: "pending",
      createdAt: ts,
      updatedAt: ts,
      draft: {
        name,
        description: input.draft.description.trim(),
        category: input.draft.category?.trim() || "custom",
        body,
      },
      source: input.source,
    };
  }
  const proposals = readStore(profile);
  writeStore([proposal, ...proposals], profile);
  return { ok: true, proposal };
}

export function dismissLearningProposal(
  id: string,
  profile?: string,
): LearningProposalResult {
  const proposals = readStore(profile);
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status !== "pending")
    return { ok: false, error: "Only pending proposals can be dismissed." };
  const next = { ...proposal, status: "dismissed" as const, updatedAt: now() };
  writeStore(replaceProposal(proposals, next), profile);
  return { ok: true, proposal: next };
}

export function acceptLearningProposal(
  id: string,
  profile?: string,
): LearningProposalResult {
  const proposals = readStore(profile);
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status !== "pending")
    return { ok: false, error: "Only pending proposals can be accepted." };

  if (proposal.kind === "memory") {
    const before = readMemory(profile).memory.entries;
    const res = addMemoryEntry(proposal.body, profile);
    if (!res.success) return { ok: false, error: res.error };
    const next: LearningProposal = {
      ...proposal,
      status: "accepted",
      updatedAt: now(),
      appliedRef: {
        type: "memory",
        index: before.length,
        content: proposal.body,
      },
    };
    writeStore(replaceProposal(proposals, next), profile);
    return { ok: true, proposal: next };
  }

  const created = createSkill({
    name: proposal.draft.name,
    description: proposal.draft.description,
    category: proposal.draft.category,
    body: proposal.draft.body,
    profile,
  });
  if (!created.success || !created.path)
    return { ok: false, error: created.error || "Could not create skill." };
  const next: LearningProposal = {
    ...proposal,
    status: "accepted",
    updatedAt: now(),
    appliedRef: { type: "skill", path: created.path },
  };
  writeStore(replaceProposal(proposals, next), profile);
  return { ok: true, proposal: next };
}

export function rollbackLearningProposal(
  id: string,
  profile?: string,
): LearningProposalResult {
  const proposals = readStore(profile);
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status !== "accepted" || !proposal.appliedRef)
    return { ok: false, error: "Only accepted proposals can be rolled back." };

  if (proposal.appliedRef.type === "memory") {
    const entry = readMemory(profile).memory.entries[proposal.appliedRef.index];
    if (entry?.content !== proposal.appliedRef.content) {
      return {
        ok: false,
        error: "Memory changed since it was accepted; refusing rollback.",
      };
    }
    const removed = removeMemoryEntry(proposal.appliedRef.index, profile);
    if (!removed) return { ok: false, error: "Memory entry not found." };
  } else {
    const disabled = setSkillEnabled(proposal.appliedRef.path, false, profile);
    if (!disabled.success) return { ok: false, error: disabled.error };
  }

  const next = {
    ...proposal,
    status: "rolled_back" as const,
    updatedAt: now(),
  };
  writeStore(replaceProposal(proposals, next), profile);
  return { ok: true, proposal: next };
}
