// In-house analytics client.
//
// Events are POSTed to the Hermes analytics service:
//   POST {VITE_ANALYTICS_BASE_URL}/v1/events
//   header: x-api-key: {VITE_ANALYTICS_API_KEY}
//   body:   { anonymous_id, event, source: "desktop", properties }
//
// The base URL and API key are injected at build time (see the
// VITE_ANALYTICS_* secrets in .github/workflows/release.yml). When either is
// missing — e.g. local/unofficial builds — analytics is silently disabled.

const ANALYTICS_BASE_URL = (
  import.meta.env.VITE_ANALYTICS_BASE_URL || ""
).replace(/\/+$/, "");
const ANALYTICS_API_KEY = import.meta.env.VITE_ANALYTICS_API_KEY || "";

const EVENTS_PATH = "/v1/events";
const SOURCE = "desktop";

const ANALYTICS_CONSENT_KEY = "hermes-analytics-enabled";
const ANONYMOUS_ID_KEY = "hermes-anonymous-id";

function isConfigured(): boolean {
  // Never emit from the Vite dev server: its origin (http://localhost:5173)
  // isn't allowlisted by the analytics service's CORS, so every request is
  // blocked at preflight and only spams the console — and dev sessions
  // shouldn't pollute production metrics. Packaged builds run `vite build`
  // (import.meta.env.DEV === false) and are unaffected.
  if (import.meta.env.DEV) return false;
  return ANALYTICS_BASE_URL.length > 0 && ANALYTICS_API_KEY.length > 0;
}

function isAnalyticsEnabled(): boolean {
  // Default to true for official builds (endpoint configured), false otherwise.
  const configured = isConfigured();
  try {
    const stored = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    if (stored === null) return configured; // First run: enabled if configured
    return stored === "true";
  } catch {
    return false;
  }
}

// A stable, random per-install identifier created on first launch and reused
// thereafter. This is the analytics user id — created if absent, reused if
// present. It is stored only on this device and contains no PII.
function getOrCreateAnonymousId(): string {
  try {
    let id = localStorage.getItem(ANONYMOUS_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ANONYMOUS_ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  if (!isConfigured()) {
    // No endpoint/key configured — silently skip analytics.
    return;
  }
  if (!isAnalyticsEnabled()) {
    return;
  }

  // Ensure the per-install id exists from the very first launch.
  getOrCreateAnonymousId();
  initialized = true;

  // app_version is the Hermes app version (package.json), fetched over IPC.
  // The Electron/Node runtime versions are reported separately. getAppVersion
  // is async, so resolve it before emitting app_opened.
  void Promise.resolve()
    .then(() => window.hermesAPI?.getAppVersion?.())
    .catch(() => undefined)
    .then((appVersion) => {
      capture("app_opened", {
        app_version: appVersion || "unknown",
        electron_version:
          window.electron?.process?.versions?.electron || "unknown",
        node_version: window.electron?.process?.versions?.node || "unknown",
        platform: window.electron?.process?.platform || "unknown",
      });
    });
}

export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!isConfigured() || !isAnalyticsEnabled()) return;
  try {
    const body = JSON.stringify({
      anonymous_id: getOrCreateAnonymousId(),
      event,
      source: SOURCE,
      properties: properties ?? {},
    });

    // Fire-and-forget — analytics must never block or break the app.
    void fetch(`${ANALYTICS_BASE_URL}${EVENTS_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANALYTICS_API_KEY,
      },
      body,
      keepalive: true,
    }).catch(() => {
      // Swallow network errors.
    });
  } catch {
    // Silently fail — analytics should never break the app.
  }
}

export function captureScreenView(screen: string): void {
  capture("screen_view", { screen });
}

export function captureFeatureUsage(
  feature: string,
  details?: Record<string, unknown>,
): void {
  capture("feature_used", { feature, ...details });
}

export function getAnalyticsConsent(): boolean {
  return isAnalyticsEnabled();
}

export function setAnalyticsConsent(enabled: boolean): void {
  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, String(enabled));
  } catch {
    // ignore
  }

  if (enabled && isConfigured() && !initialized) {
    initAnalytics();
  }
  // When disabled, capture() short-circuits on the stored consent flag — no
  // running client to tear down.
}

// Rotate the per-install identifier (e.g. on explicit user reset). A fresh id
// is created lazily on the next capture().
export function resetAnalytics(): void {
  try {
    localStorage.removeItem(ANONYMOUS_ID_KEY);
  } catch {
    // ignore
  }
}
