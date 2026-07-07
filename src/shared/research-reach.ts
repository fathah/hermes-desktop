export type ResearchReachChannelStatus =
  | "ready"
  | "needsSetup"
  | "unavailable"
  | "error";

export type ResearchReachChannelCategory =
  | "web"
  | "code"
  | "video"
  | "feed"
  | "social"
  | "career"
  | "regional"
  | "search";

export type ResearchReachChannelRisk =
  | "none"
  | "login"
  | "cookie"
  | "thirdPartyMcp"
  | "fragile";

export type ResearchReachActionKind =
  | "none"
  | "installAgentReach"
  | "authenticateGh"
  | "configureChannel"
  | "installOptionalBackend";

export interface ResearchReachChannel {
  key: string;
  label: string;
  status: ResearchReachChannelStatus;
  category: ResearchReachChannelCategory;
  risk: ResearchReachChannelRisk;
  actionKind: ResearchReachActionKind;
  canUseNow: boolean;
  tier: number;
  activeBackend: string | null;
  backends: string[];
  message: string;
  needsLogin: boolean;
  zeroConfig: boolean;
  userFacingSetup: string;
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

export interface ResearchReachIntentDescription {
  readyLabels: string[];
  blockedLabels: string[];
  message: string;
  tone: "ready" | "warn" | "idle";
}

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

const CATEGORIES: Record<string, ResearchReachChannelCategory> = {
  bilibili: "video",
  crawl4ai: "web",
  exa_search: "search",
  github: "code",
  linkedin: "career",
  reddit: "social",
  rss: "feed",
  twitter: "social",
  v2ex: "regional",
  web: "web",
  xiaohongshu: "regional",
  xiaoyuzhou: "video",
  xueqiu: "regional",
  youtube: "video",
};

const SETUP_COPY: Record<string, string> = {
  exa_search:
    "Connect Exa through mcporter outside Hermes before relying on semantic search coverage.",
  github:
    "Sign in with gh auth login for private repositories and higher rate limits.",
  reddit:
    "Connect a login-backed Reddit reader outside Hermes before relying on Reddit coverage.",
  twitter:
    "Configure a Twitter/X backend outside Hermes before relying on Twitter/X coverage.",
  web: "No setup required.",
};

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

function channelRisk(key: string): ResearchReachChannelRisk {
  if (key === "exa_search" || key === "linkedin") return "thirdPartyMcp";
  if (key === "bilibili" || key === "youtube" || key === "v2ex") {
    return "fragile";
  }
  if (LOGIN_REQUIRED.has(key)) return "login";
  return "none";
}

function channelActionKind(
  key: string,
  status: ResearchReachChannelStatus,
): ResearchReachActionKind {
  if (key === "github") return "authenticateGh";
  if (key === "exa_search" || key === "crawl4ai") {
    return "installOptionalBackend";
  }
  if (LOGIN_REQUIRED.has(key)) return "configureChannel";
  return status === "ready" ? "none" : "installOptionalBackend";
}

function userFacingSetup(
  key: string,
  status: ResearchReachChannelStatus,
): string {
  if (SETUP_COPY[key]) return SETUP_COPY[key];
  if (status === "ready") return "No setup required.";
  if (LOGIN_REQUIRED.has(key)) {
    return `Configure ${LABELS[key] || key} login outside Hermes before relying on this source.`;
  }
  return "Install or configure the listed backend outside Hermes, then check status again.";
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
      const status = toStatus(value.status);
      return {
        key,
        label: LABELS[key] || asString(value.name) || key,
        status,
        category: CATEGORIES[key] || "web",
        risk: channelRisk(key),
        actionKind: channelActionKind(key, status),
        canUseNow: status === "ready",
        tier,
        activeBackend: asString(value.active_backend) || null,
        backends: asStringArray(value.backends),
        message: asString(value.message),
        needsLogin: LOGIN_REQUIRED.has(key) || tier > 0,
        zeroConfig: tier === 0,
        userFacingSetup: userFacingSetup(key, status),
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
    .filter((channel) => channel.canUseNow ?? channel.status === "ready")
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

function intentKeys(intent: ResearchReachIntent): Set<string> | null {
  if (intent === "social") return new Set(["reddit", "twitter"]);
  if (intent === "substack") return new Set(["rss", "web", "crawl4ai"]);
  if (intent === "google") return new Set(["exa_search", "web"]);
  return null;
}

export function describeResearchReachIntent(
  status: ResearchReachStatus | null | undefined,
  intent: ResearchReachIntent = "all",
): ResearchReachIntentDescription {
  if (!status?.installed || status.channels.length === 0) {
    return {
      readyLabels: [],
      blockedLabels: [],
      message: "",
      tone: "idle",
    };
  }

  const keys = intentKeys(intent);
  const channels = keys
    ? status.channels.filter((channel) => keys.has(channel.key))
    : status.channels;
  const readyLabels = channels
    .filter((channel) => channel.canUseNow ?? channel.status === "ready")
    .map((channel) => channel.label);
  const blockedLabels = channels
    .filter(
      (channel) =>
        !(channel.canUseNow ?? channel.status === "ready") &&
        channel.status !== "error",
    )
    .map((channel) => channel.label);

  if (intent === "social" && blockedLabels.length > 0) {
    return {
      readyLabels,
      blockedLabels,
      message: `Social sources need setup: ${blockedLabels.join(", ")}.`,
      tone: "warn",
    };
  }

  if (readyLabels.length > 0) {
    return {
      readyLabels,
      blockedLabels: [],
      message: `Ready sources: ${readyLabels.slice(0, 4).join(", ")}.`,
      tone: "ready",
    };
  }

  if (blockedLabels.length > 0) {
    return {
      readyLabels: [],
      blockedLabels,
      message: `Selected sources need setup: ${blockedLabels.join(", ")}.`,
      tone: "warn",
    };
  }

  return {
    readyLabels: [],
    blockedLabels: [],
    message: "",
    tone: "idle",
  };
}
