import { existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";

import { discoverSubstackCardsWithBrowser } from "../substack-radar-browser";
import {
  discoverSubstackFeed,
  type SubstackDiscoveryResult,
} from "../rss-discovery";
import type { SubstackRadarVisibleSignals } from "../../shared/substack-radar";
import { profileHome, safeWriteFile } from "../utils";
import { safeHandle } from "./safe-handle";

type SubstackRadarRunStatus = "running" | "complete" | "failed";
type SubstackRadarCandidateStatus = "new" | "approved" | "rejected";

interface SubstackRadarStore {
  runs: SubstackRadarRun[];
}

interface SubstackRadarRunInput {
  categories?: string[];
  profile?: string;
}

interface SubstackRadarSetCandidateStatusInput {
  runId: string;
  candidateId: string;
  status: "approved" | "rejected";
  profile?: string;
}

interface SubstackRadarAddApprovedFeedsInput {
  runId: string;
  profile?: string;
}

type FeedDiscoverer = (
  publicationUrl: string,
) => Promise<SubstackDiscoveryResult>;

export interface SubstackRadarCandidate {
  id: string;
  publicationUrl: string;
  feedUrl?: string;
  title: string;
  description: string;
  author?: string;
  category: string;
  visibleSignals: SubstackRadarVisibleSignals;
  sourcePageUrl: string;
  discoveredAt: number;
  score: number;
  status: SubstackRadarCandidateStatus;
}

export interface SubstackRadarRun {
  id: string;
  query: string;
  categories: string[];
  status: SubstackRadarRunStatus;
  startedAt: number;
  finishedAt?: number;
  sourceUrls: string[];
  candidates: SubstackRadarCandidate[];
  error?: string;
}

export function buildSubstackRadarSourceUrl(category: string): string {
  return `https://substack.com/search/${encodeURIComponent(category)}`;
}

function substackRadarStorePath(
  profile?: string,
  homeOverride?: string,
): string {
  return join(
    homeOverride ?? profileHome(profile),
    "sps-agent",
    "substack-radar",
    "discovery-runs.json",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isCandidateStatus(
  value: unknown,
): value is SubstackRadarCandidateStatus {
  return value === "new" || value === "approved" || value === "rejected";
}

function isRunStatus(value: unknown): value is SubstackRadarRunStatus {
  return value === "running" || value === "complete" || value === "failed";
}

function isSubstackRadarCandidate(
  value: unknown,
): value is SubstackRadarCandidate {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.publicationUrl === "string" &&
    (value.feedUrl === undefined || typeof value.feedUrl === "string") &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    (value.author === undefined || typeof value.author === "string") &&
    typeof value.category === "string" &&
    isRecord(value.visibleSignals) &&
    typeof value.sourcePageUrl === "string" &&
    typeof value.discoveredAt === "number" &&
    typeof value.score === "number" &&
    isCandidateStatus(value.status)
  );
}

function isSubstackRadarRun(value: unknown): value is SubstackRadarRun {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.query === "string" &&
    Array.isArray(value.categories) &&
    value.categories.every((category) => typeof category === "string") &&
    isRunStatus(value.status) &&
    typeof value.startedAt === "number" &&
    (value.finishedAt === undefined || typeof value.finishedAt === "number") &&
    Array.isArray(value.sourceUrls) &&
    value.sourceUrls.every((sourceUrl) => typeof sourceUrl === "string") &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isSubstackRadarCandidate) &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function normalizeStore(value: unknown): SubstackRadarStore {
  if (!isRecord(value) || !Array.isArray(value.runs)) return { runs: [] };
  return { runs: value.runs.filter(isSubstackRadarRun) };
}

export function readSubstackRadarRuns(
  profile?: string,
  homeOverride?: string,
): SubstackRadarRun[] {
  const file = substackRadarStorePath(profile, homeOverride);
  if (!existsSync(file)) return [];
  try {
    return normalizeStore(JSON.parse(readFileSync(file, "utf-8"))).runs;
  } catch {
    return [];
  }
}

export function writeSubstackRadarRuns(
  runs: SubstackRadarRun[],
  profile?: string,
  homeOverride?: string,
): void {
  safeWriteFile(
    substackRadarStorePath(profile, homeOverride),
    `${JSON.stringify({ runs }, null, 2)}\n`,
  );
}

export function setSubstackRadarCandidateStatus(
  input: unknown,
  homeOverride?: string,
): { ok: true } | { ok: false; error: string } {
  if (!isRecord(input)) {
    return { ok: false, error: "Invalid candidate status input." };
  }
  if (typeof input.runId !== "string" || !input.runId) {
    return { ok: false, error: "Invalid run ID." };
  }
  if (typeof input.candidateId !== "string" || !input.candidateId) {
    return { ok: false, error: "Invalid candidate ID." };
  }
  if (input.status !== "approved" && input.status !== "rejected") {
    return { ok: false, error: "Invalid candidate status." };
  }
  if (input.profile !== undefined && typeof input.profile !== "string") {
    return { ok: false, error: "Invalid profile." };
  }

  const runs = readSubstackRadarRuns(input.profile, homeOverride);
  const run = runs.find((item) => item.id === input.runId);
  if (!run) return { ok: false, error: "Run not found." };

  const candidate = run.candidates.find(
    (item) => item.id === input.candidateId,
  );
  if (!candidate) return { ok: false, error: "Candidate not found." };

  candidate.status = input.status;
  writeSubstackRadarRuns(runs, input.profile, homeOverride);
  return { ok: true };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeCategories(categories: unknown): string[] {
  if (!Array.isArray(categories)) return [];
  return categories
    .map((category) => (typeof category === "string" ? category.trim() : ""))
    .filter(Boolean);
}

function toStoredCandidate(
  card: Awaited<ReturnType<typeof discoverSubstackCardsWithBrowser>>[number],
): SubstackRadarCandidate {
  return {
    id: card.id,
    publicationUrl: card.publicationUrl,
    title: card.title,
    description: card.description,
    author: card.author || undefined,
    category: card.category,
    visibleSignals: card.visibleSignals,
    sourcePageUrl: card.sourcePageUrl,
    discoveredAt: card.discoveredAt,
    score: card.score,
    status: "new",
  };
}

export async function runSubstackRadarDiscovery(
  input: SubstackRadarRunInput = {},
): Promise<SubstackRadarRun> {
  const categories = normalizeCategories(input.categories);
  const sourceUrls = categories.map(buildSubstackRadarSourceUrl);
  const run: SubstackRadarRun = {
    id: randomUUID(),
    query: categories.join(", "),
    categories,
    status: "running",
    startedAt: Date.now(),
    sourceUrls,
    candidates: [],
  };
  const existingRuns = readSubstackRadarRuns(input.profile);
  writeSubstackRadarRuns([run, ...existingRuns], input.profile);

  try {
    const candidates: SubstackRadarCandidate[] = [];
    for (const [index, category] of categories.entries()) {
      const cards = await discoverSubstackCardsWithBrowser(
        category,
        sourceUrls[index],
      );
      candidates.push(...cards.map(toStoredCandidate));
    }

    run.status = "complete";
    run.finishedAt = Date.now();
    run.candidates = candidates;
  } catch (err) {
    run.status = "failed";
    run.finishedAt = Date.now();
    run.error = errorMessage(err);
  }

  const runs = readSubstackRadarRuns(input.profile);
  const runIndex = runs.findIndex((item) => item.id === run.id);
  if (runIndex >= 0) {
    runs[runIndex] = run;
  } else {
    runs.unshift(run);
  }
  writeSubstackRadarRuns(runs, input.profile);
  return run;
}

export async function getApprovedSubstackRadarFeeds(
  input: SubstackRadarAddApprovedFeedsInput,
  feedDiscoverer: FeedDiscoverer = discoverSubstackFeed,
  homeOverride?: string,
): Promise<{
  added: 0;
  feeds: Array<{ candidateId: string; feed: SubstackDiscoveryResult }>;
}> {
  const runs = readSubstackRadarRuns(input.profile, homeOverride);
  const run = runs.find((item) => item.id === input.runId);
  if (!run) return { added: 0, feeds: [] };

  const feeds: Array<{ candidateId: string; feed: SubstackDiscoveryResult }> =
    [];
  for (const candidate of run.candidates) {
    if (candidate.status !== "approved") continue;
    const feed = await feedDiscoverer(candidate.publicationUrl);
    if (!feed.ok) continue;
    feeds.push({ candidateId: candidate.id, feed });
  }

  return { added: 0, feeds };
}

export function registerSubstackRadarIpc(): void {
  safeHandle("sps-substack-radar-run", async (_event, ...args) =>
    runSubstackRadarDiscovery(args[0] as SubstackRadarRunInput | undefined),
  );

  safeHandle("sps-substack-radar-list-runs", async (_event, ...args) => {
    const input = args[0] as { profile?: string } | string | undefined;
    const profile = typeof input === "string" ? input : input?.profile;
    return readSubstackRadarRuns(profile);
  });

  safeHandle(
    "sps-substack-radar-set-candidate-status",
    async (_event, ...args) =>
      setSubstackRadarCandidateStatus(
        args[0] as SubstackRadarSetCandidateStatusInput,
      ),
  );

  safeHandle("sps-substack-radar-add-approved-feeds", async (_event, ...args) =>
    getApprovedSubstackRadarFeeds(
      args[0] as SubstackRadarAddApprovedFeedsInput,
    ),
  );
}
