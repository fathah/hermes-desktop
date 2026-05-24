import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || "";
const POSTHOG_HOST =
  import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com";

const ANALYTICS_CONSENT_KEY = "hermes-analytics-enabled";

function isAnalyticsEnabled(): boolean {
  // Default to true for official builds (key present), false otherwise
  const hasKey = POSTHOG_KEY.length > 0;
  try {
    const stored = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    if (stored === null) return hasKey; // First run: enabled if key exists
    return stored === "true";
  } catch {
    return false;
  }
}

function getOrCreateAnonymousId(): string {
  const key = "hermes-anonymous-id";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  if (!POSTHOG_KEY) {
    // No key configured — silently skip analytics
    initialized = true;
    return;
  }
  if (!isAnalyticsEnabled()) {
    initialized = true;
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false, // We handle manually for SPA
    capture_pageleave: false,
    disable_session_recording: true, // Privacy-first: no session recording
    persistence: "localStorage",
    loaded: () => {
      posthog.identify(getOrCreateAnonymousId(), {
        app_version: window.electron?.process?.versions?.electron || "unknown",
        platform: window.electron?.process?.platform || "unknown",
        node_version: window.electron?.process?.versions?.node || "unknown",
      });
    },
  });

  initialized = true;
}

export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialized || !isAnalyticsEnabled()) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Silently fail — analytics should never break the app
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

  if (enabled && POSTHOG_KEY && !initialized) {
    initAnalytics();
  } else if (!enabled && initialized) {
    try {
      posthog.opt_out_capturing();
    } catch {
      // ignore
    }
  }
}

export function resetAnalytics(): void {
  try {
    posthog.reset();
  } catch {
    // ignore
  }
}
