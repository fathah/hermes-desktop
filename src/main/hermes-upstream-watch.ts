import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import { publicFetch } from "./security/network-policy";
import { getInstalledEngineSha } from "./installer";
import { ENGINE_CONTRACT } from "../shared/engine-contract";
import {
  ENGINE_AVAILABLE_UPDATE_ACTION,
  type EngineAvailableUpdate,
  type EngineUpdateAffordance,
} from "../shared/update-affordances";
import { extractJson, gatewayChat } from "./gateway-chat";

export type HermesUpstreamWatchCategory =
  | "contract-risk"
  | "runtime-required"
  | "api-contract"
  | "desktop-parity"
  | "security"
  | "cron-automation"
  | "provider-model"
  | "docs-only"
  | "ignore";

export interface HermesUpstreamWatchState {
  lastRunAt: string | null;
  lastSeenCommit: string | null;
  lastSeenRelease: string | null;
  latestReportPath: string | null;
  classifiedCounts: Partial<Record<HermesUpstreamWatchCategory, number>>;
  anchorSha?: string | null;
  pendingCommitCount?: number;
  contractRiskCount?: number;
  availableUpdate?: EngineAvailableUpdate;
  lastError?: string;
}

export interface HermesUpstreamWatchOptions {
  now?: Date;
  fetchImpl?: FetchLike;
  installedSha?: string | null;
  summarizeAvailableUpdate?: EngineUpdateSummarizer;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<FetchLikeResponse>;

interface GitHubCommit {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { date?: string };
  };
}

interface NormalizedCommit {
  sha: string;
  message: string;
  date: string | null;
  url: string | null;
  path: string;
  category: HermesUpstreamWatchCategory;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
}

interface GitHubCompareResponse {
  ahead_by?: number;
  commits?: GitHubCommit[];
  files?: Array<{ filename?: string }>;
}

interface EngineUpdateSummaryInput {
  range: string;
  anchorSha: string;
  headSha: string;
  pendingCommitCount: number;
  returnedCommitCount: number;
  returnedFileCount: number;
  contractRiskFileCount: number;
  contractRiskFiles: string[];
  commits: Array<{
    sha: string;
    message: string;
    date: string | null;
    url: string | null;
  }>;
}

interface EngineUpdateCardDraft {
  title?: unknown;
  body?: unknown;
  cta?: unknown;
}

type EngineUpdateSummarizer = (
  input: EngineUpdateSummaryInput,
  profile?: string,
) => Promise<EngineUpdateCardDraft[]>;

const OWNER = "NousResearch";
const REPO = "hermes-agent";
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
const REPORT_DIR = "upstream-watch";
const MAX_SUMMARY_COMMITS = 25;
const MAX_SUMMARY_RISK_FILES = 20;

export const HERMES_UPSTREAM_WATCH_PATHS = [
  "apps/desktop",
  "cron",
  "gateway",
  "hermes_cli",
  "tools",
  "plugins",
  "providers",
  "memory",
  "web",
  "pyproject.toml",
] as const;

const CATEGORY_ORDER: HermesUpstreamWatchCategory[] = [
  "contract-risk",
  "security",
  "runtime-required",
  "api-contract",
  "desktop-parity",
  "cron-automation",
  "provider-model",
  "docs-only",
  "ignore",
];

function watchDir(profile?: string): string {
  return join(profileHome(profile), REPORT_DIR);
}

function statePath(profile?: string): string {
  return join(watchDir(profile), "state.json");
}

function ensureWatchDir(profile?: string): string {
  const dir = watchDir(profile);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function emptyState(): HermesUpstreamWatchState {
  return {
    lastRunAt: null,
    lastSeenCommit: null,
    lastSeenRelease: null,
    latestReportPath: null,
    classifiedCounts: {},
  };
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function apiFetch(): FetchLike {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available for upstream watch.");
  }
  return (url, init) => publicFetch(url, init);
}

async function fetchJson<T>(
  fetchImpl: FetchLike,
  endpoint: string,
): Promise<T> {
  const response = await fetchImpl(`${API_BASE}${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "hermes-desktop-upstream-watch",
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub request failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

function commitPathEndpoint(pathName: string): string {
  const params = new URLSearchParams({
    sha: "main",
    path: pathName,
    per_page: "20",
  });
  return `/commits?${params.toString()}`;
}

function compareEndpoint(anchorSha: string): string {
  return `/compare/${encodeURIComponent(anchorSha)}...main`;
}

export function getHermesUpstreamWatchState(
  profile?: string,
): HermesUpstreamWatchState {
  const file = statePath(profile);
  if (!existsSync(file)) return emptyState();
  try {
    return {
      ...emptyState(),
      ...(JSON.parse(readFileSync(file, "utf-8")) as HermesUpstreamWatchState),
    };
  } catch {
    return emptyState();
  }
}

function writeState(
  state: HermesUpstreamWatchState,
  profile?: string,
): HermesUpstreamWatchState {
  ensureWatchDir(profile);
  safeWriteFile(statePath(profile), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function isHermesUpstreamWatchDue(
  state: Pick<HermesUpstreamWatchState, "lastRunAt">,
  now = new Date(),
): boolean {
  if (!state.lastRunAt) return true;
  const last = new Date(state.lastRunAt);
  if (Number.isNaN(last.getTime())) return true;
  return localDateKey(last) !== localDateKey(now);
}

export function classifyUpstreamWatchItem(input: {
  path?: string;
  message?: string;
  contractAware?: boolean;
}): HermesUpstreamWatchCategory {
  const pathName = (input.path || "").toLowerCase();
  const message = (input.message || "").toLowerCase();
  const text = `${pathName} ${message}`;

  if (input.contractAware && isContractRiskPath(input.path || "")) {
    return "contract-risk";
  }
  if (pathName.startsWith("apps/desktop")) return "desktop-parity";
  if (
    pathName.startsWith("cron") ||
    /\b(cron|scheduler|chronos)\b/.test(text)
  ) {
    return "cron-automation";
  }
  if (
    /\b(security|cve|vulnerability|secret|credential|redact|sanitize|ssrf)\b/.test(
      text,
    )
  ) {
    return "security";
  }
  if (
    pathName.startsWith("docs/") ||
    pathName.endsWith(".md") ||
    /\bdocs?\b/.test(message)
  ) {
    return "docs-only";
  }
  if (
    pathName.startsWith("gateway") ||
    pathName.startsWith("web") ||
    /\b(api|dashboard|sse|stream|contract)\b/.test(text)
  ) {
    return "api-contract";
  }
  if (
    pathName.startsWith("providers") ||
    pathName === "hermes_cli/models.py" ||
    /\b(provider|model|oauth)\b/.test(text)
  ) {
    return "provider-model";
  }
  if (
    pathName === "pyproject.toml" ||
    pathName.startsWith("tools") ||
    pathName.startsWith("plugins") ||
    pathName.startsWith("memory") ||
    /\b(mcp|tool|plugin|memory|install|update)\b/.test(text)
  ) {
    return "runtime-required";
  }
  if (pathName.startsWith(".github") || /\b(ci|test)\b/.test(message)) {
    return "ignore";
  }
  return "ignore";
}

function isContractRiskPath(pathName: string): boolean {
  const normalized = pathName.replaceAll("\\", "/");
  if (!normalized) return false;
  return ENGINE_CONTRACT.some((entry) =>
    entry.upstreamPaths.some((upstreamPath) => {
      const upstream = upstreamPath.replaceAll("\\", "/");
      return upstream.endsWith("/")
        ? normalized.startsWith(upstream)
        : normalized === upstream || normalized.startsWith(`${upstream}/`);
    }),
  );
}

function normalizeCommit(
  raw: GitHubCommit,
  pathName: string,
): NormalizedCommit {
  const message = raw.commit?.message || "";
  return {
    sha: raw.sha || "unknown",
    message,
    date: raw.commit?.author?.date || null,
    url: raw.html_url || null,
    path: pathName,
    category: classifyUpstreamWatchItem({ path: pathName, message }),
  };
}

function countCategories(
  items: NormalizedCommit[],
): Partial<Record<HermesUpstreamWatchCategory, number>> {
  const counts: Partial<Record<HermesUpstreamWatchCategory, number>> = {};
  for (const item of items) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  return counts;
}

function normalizeCompareItems(raw: GitHubCompareResponse): NormalizedCommit[] {
  return (raw.files || [])
    .map((file) => file.filename || "")
    .filter(Boolean)
    .map((pathName) => ({
      sha: "",
      message: "",
      date: null,
      url: null,
      path: pathName,
      category: classifyUpstreamWatchItem({
        path: pathName,
        message: "",
        contractAware: true,
      }),
    }));
}

function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function normalizeEngineCards(
  drafts: EngineUpdateCardDraft[],
  range: string,
  anchorSha: string,
  headSha: string,
): EngineUpdateAffordance[] {
  return drafts
    .map((draft, index): EngineUpdateAffordance | null => {
      const title = boundedText(draft.title, 80);
      const body = boundedText(draft.body, 240);
      if (!title || !body) return null;
      return {
        id: `engine-${shortSha(anchorSha)}-${shortSha(headSha)}-${index}`,
        source: "engine",
        range,
        title,
        body,
        cta: boundedText(draft.cta, 40) || "Review update",
        action: ENGINE_AVAILABLE_UPDATE_ACTION,
      };
    })
    .filter((card): card is EngineUpdateAffordance => card !== null)
    .slice(0, 3);
}

function fallbackEngineCards(
  input: EngineUpdateSummaryInput,
  contractRiskCount: number,
): EngineUpdateAffordance[] {
  const commits =
    input.pendingCommitCount === 1
      ? "1 commit"
      : `${input.pendingCommitCount} commits`;
  const risk =
    contractRiskCount > 0
      ? ` It touches ${contractRiskCount} file${contractRiskCount === 1 ? "" : "s"} mapped to desktop engine contracts.`
      : "";
  return normalizeEngineCards(
    [
      {
        title: "Hermes Agent update available",
        body: `Upstream main is ${commits} ahead of the installed Hermes Agent checkout.${risk} Review the generated upstream-watch report before updating.`,
        cta: "Review update",
      },
    ],
    input.range,
    input.anchorSha,
    input.headSha,
  );
}

async function summarizeAvailableUpdateWithGateway(
  input: EngineUpdateSummaryInput,
  profile?: string,
): Promise<EngineUpdateCardDraft[]> {
  const omittedCommitCount = Math.max(
    0,
    input.returnedCommitCount - input.commits.length,
  );
  const omittedRiskFileCount = Math.max(
    0,
    input.contractRiskFileCount - input.contractRiskFiles.length,
  );
  const commitSubjects = input.commits
    .map(
      (commit) => `- ${shortSha(commit.sha)} ${commit.message.split("\n")[0]}`,
    )
    .join("\n");
  const riskFiles =
    input.contractRiskFiles.length > 0
      ? input.contractRiskFiles.map((file) => `- ${file}`).join("\n")
      : "- none";
  const text = await gatewayChat(
    [
      {
        role: "system",
        content:
          "Summarize pending Hermes Agent updates for a desktop app what's-new panel. Return strict JSON only. Do not invent exact metrics, benchmarks, or installed desktop features.",
      },
      {
        role: "user",
        content: [
          `Commit range: ${input.range}`,
          `Pending commits: ${input.pendingCommitCount}`,
          `GitHub compare returned commits: ${input.returnedCommitCount}`,
          `GitHub compare returned files: ${input.returnedFileCount}`,
          `Commit subject sample (${input.commits.length} shown${omittedCommitCount ? `, ${omittedCommitCount} omitted` : ""}):`,
          commitSubjects || "- none",
          `Contract-risk file sample (${input.contractRiskFiles.length} shown of ${input.contractRiskFileCount}${omittedRiskFileCount ? `, ${omittedRiskFileCount} omitted` : ""}):`,
          riskFiles,
          "",
          'Return {"cards":[{"title":"...","body":"...","cta":"Review update"}]} with 0 to 3 cards.',
          "Cards must describe an available Hermes Agent update, not installed desktop features.",
          "Use broad capability themes when the compare response is sampled or capped.",
        ].join("\n"),
      },
    ],
    500,
    profile,
  );
  const parsed = extractJson(text);
  if (Array.isArray(parsed)) return parsed as EngineUpdateCardDraft[];
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { cards?: unknown }).cards)
  ) {
    return (parsed as { cards: EngineUpdateCardDraft[] }).cards;
  }
  return [];
}

async function buildAvailableUpdate(
  input: EngineUpdateSummaryInput,
  generatedAt: string,
  contractRiskCount: number,
  summarize: EngineUpdateSummarizer,
  profile?: string,
): Promise<EngineAvailableUpdate | undefined> {
  if (
    !input.anchorSha ||
    !input.headSha ||
    input.anchorSha === input.headSha ||
    input.pendingCommitCount <= 0
  ) {
    return undefined;
  }
  let cards: EngineUpdateAffordance[] = [];
  try {
    cards = normalizeEngineCards(
      await summarize(input, profile),
      input.range,
      input.anchorSha,
      input.headSha,
    );
  } catch {
    cards = [];
  }
  if (cards.length === 0) {
    cards = fallbackEngineCards(input, contractRiskCount);
  }
  return {
    range: input.range,
    anchorSha: input.anchorSha,
    headSha: input.headSha,
    generatedAt,
    pendingCommitCount: input.pendingCommitCount,
    contractRiskCount,
    cards,
  };
}

function writeReport(params: {
  profile?: string;
  now: Date;
  head: GitHubCommit;
  release: GitHubRelease;
  items: NormalizedCommit[];
  counts: Partial<Record<HermesUpstreamWatchCategory, number>>;
  anchorSha?: string | null;
  pendingCommitCount?: number;
  contractRiskCount?: number;
  returnedCommitCount?: number;
  returnedFileCount?: number;
}): string {
  const dir = ensureWatchDir(params.profile);
  const reportPath = join(dir, `${isoDateKey(params.now)}.md`);
  const headSha = params.head.sha || null;
  const releaseTag = params.release.tag_name || null;
  const lines = [
    `# Hermes Agent Upstream Watch - ${isoDateKey(params.now)}`,
    "",
    `Generated: ${params.now.toISOString()}`,
    `Repository: https://github.com/${OWNER}/${REPO}`,
    "Mode: report-only. No SPS source files were changed.",
    "",
    "## Latest",
    "",
    ...(params.anchorSha
      ? [
          `- Anchor: ${shortSha(params.anchorSha)}`,
          `- Pending commits: ${params.pendingCommitCount ?? 0}`,
          `- Contract-risk files: ${params.contractRiskCount ?? 0}`,
          ...(typeof params.returnedCommitCount === "number" &&
          typeof params.pendingCommitCount === "number" &&
          (params.pendingCommitCount > params.returnedCommitCount ||
            (params.returnedFileCount ?? 0) >= 300)
            ? [
                `- Note: GitHub compare returned ${params.returnedCommitCount} of ${params.pendingCommitCount} commits and ${params.returnedFileCount ?? 0} files. Path-filtered changes below are a compare response sample, not a complete per-commit changelog.`,
              ]
            : []),
        ]
      : []),
    `- Main: ${shortSha(headSha)}${params.head.html_url ? ` (${params.head.html_url})` : ""}`,
    `- Release: ${releaseTag || "unknown"}${params.release.html_url ? ` (${params.release.html_url})` : ""}`,
    "",
    "## Classified Counts",
    "",
    ...CATEGORY_ORDER.map(
      (category) => `- ${category}: ${params.counts[category] || 0}`,
    ),
    "",
    "## Path-Filtered Changes",
    "",
  ];

  for (const category of CATEGORY_ORDER) {
    const items = params.items.filter((item) => item.category === category);
    if (items.length === 0) continue;
    lines.push(`### ${category}`, "");
    for (const item of items) {
      const subject = item.message.split("\n")[0];
      if (!subject) {
        lines.push(`- ${item.path}`);
      } else {
        lines.push(
          `- ${shortSha(item.sha)} ${item.path}: ${subject}${item.url ? ` (${item.url})` : ""}`,
        );
      }
    }
    lines.push("");
  }

  safeWriteFile(reportPath, `${lines.join("\n").trim()}\n`);
  return reportPath;
}

export async function runHermesUpstreamWatch(
  profile?: string,
  options: HermesUpstreamWatchOptions = {},
): Promise<HermesUpstreamWatchState> {
  const now = options.now || new Date();
  const fetchImpl = options.fetchImpl || apiFetch();

  try {
    const installedSha =
      options.installedSha !== undefined
        ? options.installedSha
        : await getInstalledEngineSha();
    const release = await fetchJson<GitHubRelease>(
      fetchImpl,
      "/releases/latest",
    );
    let head: GitHubCommit;
    let items: NormalizedCommit[];
    let anchorSha: string | null = null;
    let pendingCommitCount = 0;
    let contractRiskCount = 0;
    let returnedCommitCount: number | undefined;
    let returnedFileCount: number | undefined;
    let availableUpdate: EngineAvailableUpdate | undefined;

    if (installedSha) {
      const compare = await fetchJson<GitHubCompareResponse>(
        fetchImpl,
        compareEndpoint(installedSha),
      );
      const commits = compare.commits || [];
      const files = compare.files || [];
      head = commits[commits.length - 1] || { sha: installedSha };
      items = normalizeCompareItems(compare);
      anchorSha = installedSha;
      pendingCommitCount = compare.ahead_by ?? commits.length;
      returnedCommitCount = commits.length;
      returnedFileCount = files.length;
      contractRiskCount = items.filter(
        (item) => item.category === "contract-risk",
      ).length;
      const headSha = head.sha || null;
      if (headSha) {
        const contractRiskFiles = files
          .map((file) => file.filename || "")
          .filter((file) => file && isContractRiskPath(file));
        const commitSample = commits.slice(-MAX_SUMMARY_COMMITS);
        availableUpdate = await buildAvailableUpdate(
          {
            range: `${anchorSha}..${headSha}`,
            anchorSha,
            headSha,
            pendingCommitCount,
            returnedCommitCount,
            returnedFileCount,
            contractRiskFileCount: contractRiskFiles.length,
            contractRiskFiles: contractRiskFiles.slice(
              0,
              MAX_SUMMARY_RISK_FILES,
            ),
            commits: commitSample.map((commit) => ({
              sha: commit.sha || "unknown",
              message: commit.commit?.message || "",
              date: commit.commit?.author?.date || null,
              url: commit.html_url || null,
            })),
          },
          now.toISOString(),
          contractRiskCount,
          options.summarizeAvailableUpdate ||
            summarizeAvailableUpdateWithGateway,
          profile,
        );
      }
    } else {
      const [latestHead, pathCommits] = await Promise.all([
        fetchJson<GitHubCommit>(fetchImpl, "/commits/main"),
        Promise.all(
          HERMES_UPSTREAM_WATCH_PATHS.map(async (pathName) => ({
            pathName,
            commits: await fetchJson<GitHubCommit[]>(
              fetchImpl,
              commitPathEndpoint(pathName),
            ),
          })),
        ),
      ]);
      head = latestHead;
      items = pathCommits.flatMap(({ pathName, commits }) =>
        commits.map((commit) => normalizeCommit(commit, pathName)),
      );
    }
    const counts = countCategories(items);
    const latestReportPath = writeReport({
      profile,
      now,
      head,
      release,
      items,
      counts,
      anchorSha,
      pendingCommitCount,
      contractRiskCount,
      returnedCommitCount,
      returnedFileCount,
    });
    return writeState(
      {
        lastRunAt: now.toISOString(),
        lastSeenCommit: head.sha || null,
        lastSeenRelease: release.tag_name || null,
        latestReportPath,
        classifiedCounts: counts,
        anchorSha,
        pendingCommitCount,
        contractRiskCount,
        availableUpdate,
      },
      profile,
    );
  } catch (err) {
    const previous = getHermesUpstreamWatchState(profile);
    const next = {
      ...previous,
      lastRunAt: now.toISOString(),
      lastError: err instanceof Error ? err.message : String(err),
    };
    return writeState(next, profile);
  }
}

export async function maybeRunHermesUpstreamWatchRoutine(
  now = new Date(),
  profile?: string,
  options: Omit<HermesUpstreamWatchOptions, "now"> = {},
): Promise<HermesUpstreamWatchState | null> {
  const state = getHermesUpstreamWatchState(profile);
  if (!isHermesUpstreamWatchDue(state, now)) return null;
  return runHermesUpstreamWatch(profile, { ...options, now });
}
