// openSettings.ts — typed deep-link contract for the Hermes admin overlay.
//
// SPS surfaces (and the App root) can't reach Layout's `goTo` directly, so they
// ask the host to open a specific admin tab by dispatching a DOM event. This
// module is the single source of truth for both the event name and the set of
// views that can be deep-linked, so callers and listeners stay in sync and
// `event.detail.view` is type-checked.

/** Every view the admin overlay (Layout) can show. Layout imports this as its
 *  `View` type so the deep-link target and the nav union never drift. */
export type AdminView =
  | "chat"
  | "sessions"
  | "agents"
  | "models"
  | "providers"
  | "skills"
  | "tools"
  | "schedules"
  | "kanban"
  | "insights"
  | "capabilityReview"
  | "gateway"
  | "spsAgent"
  | "memory"
  | "settings";

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

const KNOWN_VIEWS = new Set<AdminView>([
  "chat",
  "sessions",
  "agents",
  "models",
  "providers",
  "skills",
  "tools",
  "schedules",
  "kanban",
  "insights",
  "capabilityReview",
  "gateway",
  "spsAgent",
  "memory",
  "settings",
]);

function isAdminView(v: string | null): v is AdminView {
  return v !== null && KNOWN_VIEWS.has(v as AdminView);
}

/** Last admin tab the user viewed, or "settings" if none/invalid. */
export function readLastAdminView(): AdminView {
  try {
    const stored = window.localStorage.getItem(ADMIN_LAST_VIEW_KEY);
    if (isAdminView(stored)) return stored;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return "settings";
}

export function writeLastAdminView(view: AdminView): void {
  try {
    window.localStorage.setItem(ADMIN_LAST_VIEW_KEY, view);
  } catch {
    /* non-fatal: persistence is best-effort */
  }
}
