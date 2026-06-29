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
      view: "providers" | "settings" | "gateway" | "connectedApps";
    }
  | {
      kind: "modal";
      modal: "research" | "scheduled" | "templates" | "palette";
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
    id: "capture-pdf",
    introducedIn: "0.5.5",
    title: "PDFs in Capture",
    body: "Import PDFs into Capture and route extracted notes through review.",
    cta: "Open Capture",
    action: { kind: "surface", surface: "inbox" },
  },
  {
    id: "work-review",
    introducedIn: "0.5.5",
    title: "Work review queue",
    body: "Review tasks, delegated goals, scheduled rules, and pending changes from one surface.",
    cta: "Open Work",
    action: { kind: "surface", surface: "work" },
  },
  {
    id: "desktop-updates",
    introducedIn: "0.5.5",
    title: "Nightly update checks",
    body: "Hermes can check for Desktop and Agent updates every night while the app is open.",
    cta: "Open Settings",
    action: { kind: "settings", view: "settings" },
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
