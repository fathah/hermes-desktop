export type ResearchReachChannelStatus =
  | "ready"
  | "needsSetup"
  | "unavailable"
  | "error";

export interface ResearchReachChannel {
  key: string;
  label: string;
  status: ResearchReachChannelStatus;
  tier: number;
  activeBackend: string | null;
  backends: string[];
  message: string;
  needsLogin: boolean;
  zeroConfig: boolean;
}

export interface ResearchReachStatus {
  installed: boolean;
  version: string | null;
  channels: ResearchReachChannel[];
  checkedAt: number;
  error?: string;
}

export interface ResearchReachSummary {
  ready: number;
  needsSetup: number;
  unavailable: number;
  total: number;
}

export type ResearchReachIntent = "all" | "google" | "social" | "substack";

const LABELS: Record<string, string> = {
  bilibili: "Bilibili",
  exa_search: "Web search",
  github: "GitHub",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  rss: "RSS",
  twitter: "Twitter/X",
  v2ex: "V2EX",
  web: "Web pages",
  xiaohongshu: "XiaoHongShu",
  xiaoyuzhou: "Podcast transcripts",
  xueqiu: "Xueqiu",
  youtube: "YouTube",
};

const LOGIN_REQUIRED = new Set([
  "linkedin",
  "reddit",
  "twitter",
  "xiaohongshu",
  "xueqiu",
]);

type DoctorEntry = {
  status?: unknown;
  name?: unknown;
  message?: unknown;
  tier?: unknown;
  backends?: unknown;
  active_backend?: unknown;
};

function toStatus(value: unknown): ResearchReachChannelStatus {
  if (value === "ok") return "ready";
  if (value === "warn") return "needsSetup";
  if (value === "error") return "error";
  return "unavailable";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizeAgentReachDoctor(
  raw: unknown,
  version: string | null = null,
): ResearchReachStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      installed: false,
      version,
      channels: [],
      checkedAt: Date.now(),
      error: "Agent-Reach is not installed or did not return doctor JSON.",
    };
  }

  const channels = Object.entries(raw as Record<string, DoctorEntry>).map(
    ([key, value]) => {
      const tier = typeof value.tier === "number" ? value.tier : 2;
      return {
        key,
        label: LABELS[key] || asString(value.name) || key,
        status: toStatus(value.status),
        tier,
        activeBackend: asString(value.active_backend) || null,
        backends: asStringArray(value.backends),
        message: asString(value.message),
        needsLogin: LOGIN_REQUIRED.has(key) || tier > 0,
        zeroConfig: tier === 0,
      };
    },
  );

  return {
    installed: true,
    version,
    channels,
    checkedAt: Date.now(),
  };
}

export function summarizeResearchReach(
  status: ResearchReachStatus,
): ResearchReachSummary {
  return {
    ready: status.channels.filter((channel) => channel.status === "ready")
      .length,
    needsSetup: status.channels.filter(
      (channel) => channel.status === "needsSetup",
    ).length,
    unavailable: status.channels.filter(
      (channel) =>
        channel.status === "unavailable" || channel.status === "error",
    ).length,
    total: status.channels.length,
  };
}

export function buildResearchReachPromptHint(
  status: ResearchReachStatus | null | undefined,
  intent: ResearchReachIntent = "all",
): string {
  if (!status?.installed || status.channels.length === 0) return "";

  const ready = status.channels
    .filter((channel) => channel.status === "ready")
    .map((channel) =>
      channel.activeBackend
        ? `${channel.label} via ${channel.activeBackend}`
        : channel.label,
    );
  const notReady = status.channels
    .filter(
      (channel) =>
        ["github", "reddit", "twitter", "youtube"].includes(channel.key) &&
        channel.status !== "ready",
    )
    .map(
      (channel) =>
        `${channel.label} is not currently ready; do not claim ${channel.label} coverage unless a tool call succeeds.`,
    );

  const focus =
    intent === "social"
      ? " Prioritize discussion sources when tools are ready."
      : intent === "substack"
        ? " Prioritize Substack publication pages, author archives, and /feed RSS feeds through ready RSS and web-page channels. Do not use Twitter/X or Reddit as substitutes for Substack coverage."
        : "";
  const readyText = ready.length
    ? `Research Reach available channels: ${ready.join(", ")}.${focus}`
    : "Research Reach is installed, but no channels are currently ready.";

  return [readyText, ...notReady].join("\n");
}
