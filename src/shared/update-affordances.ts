export type ReleaseSurfaceTarget =
  | "doc"
  | "dashboard"
  | "chats"
  | "ask"
  | "work"
  | "journal"
  | "personal-health"
  | "rss-reader"
  | "contentStudio"
  | "deckStudio"
  | "cockpit"
  | "insights"
  | "memory"
  | "you"
  | "learning"
  | "activeWork"
  | "inbox"
  | "review"
  | "health"
  | "graph"
  | "equity"
  | "obsidian-note";

export type ReleasePlatform = "darwin" | "linux" | "win32";

export type ReleaseAffordanceAction =
  | { kind: "surface"; surface: ReleaseSurfaceTarget }
  | {
      kind: "settings";
      view:
        | "overview"
        | "providers"
        | "settings"
        | "gateway"
        | "connectedApps";
    }
  | {
      kind: "modal";
      modal: "research" | "scheduled" | "templates" | "palette" | "tweaks";
    };

export interface ReleaseAffordance {
  id: string;
  introducedIn: string;
  title: string;
  body: string;
  cta: string;
  action: ReleaseAffordanceAction;
  platforms?: ReleasePlatform[];
  requiresApi?: string;
}

export const RELEASE_AFFORDANCES: ReleaseAffordance[] = [
  {
    id: "control-center-ai-readiness",
    introducedIn: "0.5.4",
    title: "Control Center AI readiness",
    body: "See the active model, setup status, missing key or model guidance, and remote connection path from one Control Center.",
    cta: "Open Control Center",
    action: { kind: "settings", view: "overview" },
  },
  {
    id: "sps-narrow-workspace",
    introducedIn: "0.5.4",
    title: "Intentional narrow workspace",
    body: "Narrow SPS windows now collapse the side panel on entry, expose a real close button, and keep assistant and sidebar shortcuts separate.",
    cta: "Open Workspace",
    action: { kind: "surface", surface: "doc" },
  },
  {
    id: "sps-dark-theme-legibility",
    introducedIn: "0.5.4",
    title: "Readable SPS dark theme",
    body: "Dark theme surfaces and accent-filled controls now use theme-aware foregrounds so workspace text stays legible.",
    cta: "Open Appearance",
    action: { kind: "modal", modal: "tweaks" },
  },
];

function versionParts(version: string): number[] {
  return version.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

export function compareAppVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function releaseAffordancesSince(
  lastSeenVersion: string | null,
  currentVersion: string,
  affordances = RELEASE_AFFORDANCES,
): ReleaseAffordance[] {
  if (!lastSeenVersion) return [];
  return affordances.filter(
    (item) =>
      compareAppVersions(item.introducedIn, lastSeenVersion) > 0 &&
      compareAppVersions(item.introducedIn, currentVersion) <= 0,
  );
}
