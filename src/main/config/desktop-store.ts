import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "../installer";
import { getActiveProfileNameSync } from "../utils";
import { encryptSecret, decryptSecret } from "./secrets";

// `desktop.json` — app-level, desktop-owned config (connection mode, encrypted
// remote/api-server keys, and the desktop-enforced UX toggles below).
// `desktopConfigFile` stays a function (not a module-level const) so HERMES_HOME
// is read at call time: config ↔ installer is a benign cycle, and reading the
// path lazily avoids depending on installer being fully evaluated at load time.
function desktopConfigFile(): string {
  return join(HERMES_HOME, "desktop.json");
}

export function readDesktopConfig(): Record<string, unknown> {
  try {
    const f = desktopConfigFile();
    if (!existsSync(f)) return {};
    const data = JSON.parse(readFileSync(f, "utf-8"));
    if (data && typeof data === "object") {
      if (typeof data.remoteApiKey === "string") {
        data.remoteApiKey = decryptSecret(data.remoteApiKey);
      }
      if (typeof data.apiServerKey === "string") {
        data.apiServerKey = decryptSecret(data.apiServerKey);
      }
    }
    return data;
  } catch {
    return {};
  }
}

export function writeDesktopConfig(data: Record<string, unknown>): void {
  if (!existsSync(HERMES_HOME)) {
    mkdirSync(HERMES_HOME, { recursive: true });
  }
  const clone = JSON.parse(JSON.stringify(data));
  if (clone && typeof clone === "object") {
    if (typeof clone.remoteApiKey === "string") {
      clone.remoteApiKey = encryptSecret(clone.remoteApiKey);
    }
    if (typeof clone.apiServerKey === "string") {
      clone.apiServerKey = encryptSecret(clone.apiServerKey);
    }
  }
  writeFileSync(desktopConfigFile(), JSON.stringify(clone, null, 2), "utf-8");
}

// ── Desktop automation prefs (M2) ────────────────────────────────────────────
// App-level, desktop-owned policy/UX toggles stored in desktop.json. They live
// here (not config.yaml) because they are enforced by the desktop main process,
// not the gateway, and because setConfigValue silently drops new nested YAML keys.

/** Scoped auto-approve: let the desktop auto-resolve provably-safe, read-only
 *  command approvals (see autonomy.ts). PER-PROFILE (different profiles carry
 *  different risk), keyed by the resolved profile name in desktop.json. Default
 *  OFF — opt-in only. Resolving undefined → active profile keeps the key stable
 *  between the Settings UI (passes a name) and the chat path (often passes none). */
function autoApproveKey(profile?: string): string {
  return profile || getActiveProfileNameSync();
}
export function getAutoApprove(profile?: string): boolean {
  const map = readDesktopConfig().autoApproveByProfile;
  if (!map || typeof map !== "object") return false;
  return (map as Record<string, unknown>)[autoApproveKey(profile)] === true;
}
export function setAutoApprove(enabled: boolean, profile?: string): void {
  const data = readDesktopConfig();
  const existing = data.autoApproveByProfile;
  const map: Record<string, boolean> =
    existing && typeof existing === "object"
      ? (existing as Record<string, boolean>)
      : {};
  map[autoApproveKey(profile)] = enabled;
  data.autoApproveByProfile = map;
  writeDesktopConfig(data);
}

/** Play a system chime when an agent run completes (handy with parallel runs). */
export function getCompletionSound(): boolean {
  return readDesktopConfig().completionSound === true;
}
export function setCompletionSound(enabled: boolean): void {
  const data = readDesktopConfig();
  data.completionSound = enabled;
  writeDesktopConfig(data);
}
