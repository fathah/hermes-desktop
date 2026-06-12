export type LearningProposalStatus =
  | "pending"
  | "accepted"
  | "dismissed"
  | "rolled_back";

export type LearningProposalSource =
  | { type: "session"; id?: string; title?: string }
  | { type: "inbox"; id?: string; title?: string }
  | { type: "repo"; path?: string; title?: string }
  | { type: "manual"; id?: string; title?: string }
  | { type: "unknown"; id?: string; title?: string };

export interface MemoryLearningProposal {
  id: string;
  kind: "memory";
  status: LearningProposalStatus;
  createdAt: number;
  updatedAt: number;
  body: string;
  reason?: string;
  source?: LearningProposalSource;
  appliedRef?: { type: "memory"; index: number; content: string };
}

export interface SkillLearningProposal {
  id: string;
  kind: "skill";
  status: LearningProposalStatus;
  createdAt: number;
  updatedAt: number;
  draft: {
    name: string;
    description: string;
    category: string;
    body: string;
  };
  source?: LearningProposalSource;
  appliedRef?: { type: "skill"; path: string };
}

export type LearningProposal =
  | MemoryLearningProposal
  | SkillLearningProposal;

export type CreateLearningProposalInput =
  | {
      kind: "memory";
      body: string;
      reason?: string;
      source?: LearningProposalSource;
    }
  | {
      kind: "skill";
      draft: {
        name: string;
        description: string;
        category?: string;
        body: string;
      };
      source?: LearningProposalSource;
    };

export interface LearningProposalResult {
  ok: boolean;
  proposal?: LearningProposal;
  error?: string;
}

export interface SkillUsageEntry {
  name: string;
  path: string;
  loadCount: number;
  injectedCount: number;
  lastLoadedAt?: number;
  lastUsedAt?: number;
}
