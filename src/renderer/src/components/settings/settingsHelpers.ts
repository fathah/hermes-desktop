import type { AppLocale } from "../../../../shared/i18n";

/** Community + support links shown in the Community pane. */
export const DISCORD_COMMUNITY_URL = "https://discord.gg/vMwcnNPHc";
export const HERMES_WEBSITE_URL = "https://www.hermesone.org";
export const HERMES_X_URL = "https://x.com/HermesOneAPp";
export const HERMES_TELEGRAM_URL = "https://t.me/hermes_agent_desktop";
export const KOFI_SUPPORT_URL = "https://ko-fi.com/fathah";

export type RemoteChatTransport = "auto" | "dashboard" | "legacy";
export const CHAT_TRANSPORT_OPTIONS: RemoteChatTransport[] = [
  "auto",
  "dashboard",
  "legacy",
];

export type TransportProbe = {
  detail: string;
  kind: "muted" | "ok" | "warn";
  label: string;
  loading: boolean;
};

export const LANGUAGE_NATIVE_NAMES: Record<AppLocale, string> = {
  en: "English",
  ar: "العربية",
  es: "Español",
  he: "עברית",
  id: "Bahasa Indonesia",
  ja: "日本語",
  pl: "Polski",
  "pt-BR": "Português (BR)",
  "pt-PT": "Português (PT)",
  tr: "Türkçe",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文（台灣）",
};

// Build a mask string the same width as the stored API key so the
// "saved" state of the input looks like a key, not a constant blob.
// Length is exposed by the main process via PublicConnectionConfig.
// 0 falls back to 8 dots so the user gets a visible "set" indicator
// even if main didn't report a length yet. Capped to keep absurdly
// long keys from blowing up the field.
export function makeApiKeyMask(length: number): string {
  const n = Math.min(Math.max(length, 8), 128);
  return "*".repeat(n);
}

export type PublicConnectionSnapshot = {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  ssh?: {
    host: string;
    keyPath: string;
    localPort: number;
    port: number;
    remotePort: number;
    username: string;
  };
};

export function versionCacheKey(
  conn: PublicConnectionSnapshot,
  profile?: string,
): string {
  const profileKey = profile || "default";
  if (conn.mode === "remote") {
    return `remote:${conn.remoteUrl.trim() || "unset"}:${profileKey}`;
  }
  if (conn.mode === "ssh") {
    const ssh = conn.ssh;
    return [
      "ssh",
      ssh?.username || "",
      ssh?.host || "",
      ssh?.port || "",
      ssh?.remotePort || "",
      ssh?.localPort || "",
      profileKey,
    ].join(":");
  }
  return `local:${profileKey}`;
}

function versionCacheStorageKey(cacheKey: string): string {
  return `hermes-version-cache:${cacheKey}`;
}

export function getCachedVersion(cacheKey: string): string | null {
  try {
    return localStorage.getItem(versionCacheStorageKey(cacheKey));
  } catch {
    return null;
  }
}

export function setCachedVersion(cacheKey: string, version: string): void {
  try {
    localStorage.setItem(versionCacheStorageKey(cacheKey), version);
  } catch {
    /* ignore */
  }
}

export function getCachedOpenClaw(): {
  found: boolean;
  path: string | null;
} | null {
  try {
    const raw = localStorage.getItem("hermes-openclaw-cache");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
