// openSettings.ts — typed deep-link contract for the Hermes admin overlay.
//
// SPS surfaces (and the App root) can't reach Layout's `goTo` directly, so they
// ask the host to open a specific admin tab by dispatching a DOM event. This
// module is the single source of truth for both the event name and the set of
// views that can be deep-linked, so callers and listeners stay in sync and
// `event.detail.view` is type-checked.

/** Every view the admin overlay can be asked to show. Legacy aliases remain
 * accepted so old callers keep working while Layout renders task-based views. */
export type AdminView =
  | "overview"
  | "aiSetup"
  | "models"
  | "council"
  | "personalization"
  | "preferences"
  | "dataPrivacy"
  | "connectedApps"
  | "troubleshooting"
  | "advanced"
  // Legacy deep-link aliases.
  | "providers"
  | "gateway"
  | "spsAgent"
  | "settings";

export type NormalizedAdminView = Exclude<
  AdminView,
  "providers" | "gateway" | "spsAgent" | "settings"
>;

export const OPEN_SETTINGS_EVENT = "hermes:open-settings";

export interface OpenSettingsDetail {
  /** Tab to open. Omitted → host decides (no-API-key → Providers, else last tab). */
  view?: AdminView;
}

// Make `window.addEventListener("hermes:open-settings", …)` and the dispatched
// event's `detail` strongly typed everywhere.
declare global {
  interface WindowEventMap {
    [OPEN_SETTINGS_EVENT]: CustomEvent<OpenSettingsDetail>;
  }
}

/** Open the Hermes admin overlay, optionally on a specific tab. */
export function openSettings(view?: AdminView): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS_EVENT, { detail: view ? { view } : {} }),
  );
}

// The admin overlay reopens on the tab the user last used (unless a deep-link or
// the no-API-key rule overrides it). Persisted here so App (writes the default)
// and Layout (writes on every tab switch) share one key + one validator.
export const ADMIN_LAST_VIEW_KEY = "hermes.admin.lastView";

const VIEW_ALIASES: Record<string, NormalizedAdminView> = {
  overview: "overview",
  aiSetup: "aiSetup",
  providers: "aiSetup",
  models: "models",
  council: "council",
  personalization: "personalization",
  preferences: "preferences",
  dataPrivacy: "dataPrivacy",
  connectedApps: "connectedApps",
  gateway: "connectedApps",
  troubleshooting: "troubleshooting",
  advanced: "advanced",
  spsAgent: "overview",
  settings: "overview",
};

export function normalizeAdminView(
  view?: AdminView | string,
): NormalizedAdminView {
  if (!view) return "overview";
  return VIEW_ALIASES[view] ?? "overview";
}

/** Last normalized admin view the user viewed, or "overview" if none/invalid. */
export function readLastAdminView(): NormalizedAdminView {
  try {
    const stored = window.localStorage.getItem(ADMIN_LAST_VIEW_KEY);
    return normalizeAdminView(stored ?? undefined);
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return "overview";
}

export function writeLastAdminView(view: AdminView): void {
  try {
    window.localStorage.setItem(ADMIN_LAST_VIEW_KEY, normalizeAdminView(view));
  } catch {
    /* non-fatal: persistence is best-effort */
  }
}
