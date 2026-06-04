import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";
import { normalizeProfileName } from "./utils";
import { getConfigValue, setConfigValue } from "./config";

// The default profile keeps the historical port so existing installs and
// docs (curl examples, etc.) keep working. Named profiles each get a
// distinct port from the range below so their gateways can run at the same
// time — the Python gateway refuses to bind a port already in use, so two
// profiles sharing 8642 would mean only one gateway could ever be up.
export const DEFAULT_API_SERVER_PORT = 8642;
const PORT_RANGE_START = 8643;
const PORT_RANGE_END = 8742;
const API_SERVER_PORT_PATH = "platforms.api_server.extra.port";

function listNamedProfiles(): string[] {
  const dir = join(HERMES_HOME, "profiles");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function readConfiguredPort(profile: string | undefined): number | null {
  const raw = getConfigValue(API_SERVER_PORT_PATH, profile);
  if (raw && /^\d+$/.test(raw.trim())) {
    const n = parseInt(raw.trim(), 10);
    if (n > 0 && n < 65536) return n;
  }
  return null;
}

/**
 * Ports already claimed by the default profile and every named profile other
 * than `except`. The default's 8642 is always treated as taken so named
 * profiles never collide with it even when its config omits the port.
 */
function portsInUse(except: string | undefined): Set<number> {
  const used = new Set<number>([DEFAULT_API_SERVER_PORT]);
  const def = readConfiguredPort(undefined);
  if (def) used.add(def);
  for (const name of listNamedProfiles()) {
    if (name === except) continue;
    const p = readConfiguredPort(name);
    if (p) used.add(p);
  }
  return used;
}

function allocateFreePort(profile: string): number {
  const used = portsInUse(profile);
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (!used.has(port)) return port;
  }
  // Range exhausted (≥100 named profiles) — fall back to the default and let
  // the Python side surface a clear "port already in use" error rather than
  // guessing a port outside the reserved band.
  return DEFAULT_API_SERVER_PORT;
}

/**
 * Resolve the api_server port the desktop should bind `profile`'s gateway to.
 *
 * config.yaml is the single source of truth:
 *  - default profile → pinned to {@link DEFAULT_API_SERVER_PORT}.
 *  - named profile with no configured port → allocate a free port and persist
 *    it (the api_server block is written by ensureApiServerConfig).
 *  - named profile whose configured port collides with the default or another
 *    profile (a profile cloned from default inherits 8642) → reassign to a
 *    free port and rewrite config.yaml in place.
 *
 * Idempotent: once a non-colliding port is persisted, later calls return it
 * without touching the file.
 */
export function getProfilePort(profile?: string): number {
  const name = normalizeProfileName(profile); // undefined => default
  if (!name) return DEFAULT_API_SERVER_PORT;

  const configured = readConfiguredPort(name);
  if (configured !== null) {
    const collides =
      configured === DEFAULT_API_SERVER_PORT ||
      portsInUse(name).has(configured);
    if (!collides) return configured;
    const port = allocateFreePort(name);
    // setConfigValue replaces the existing nested value in place — the common
    // case here is a profile cloned from default that carries port 8642.
    setConfigValue(API_SERVER_PORT_PATH, String(port), name);
    return port;
  }

  // No port (and possibly no api_server block) yet. ensureApiServerConfig
  // writes the block using this same value; the spawn also passes it via
  // API_SERVER_PORT, which the gateway honours when config omits the port.
  return allocateFreePort(name);
}
