import { readFileSync, realpathSync } from "fs";
import { join } from "path";

/** Match the default home's managed gateway, not a reused PID or a named profile's missing API port. */
export function isMultiplexGatewayRunning(
  home: string,
  profile: string,
  isGatewayPidAlive: (pid: number) => boolean,
): boolean {
  // Named profiles in a multiplexer have no dedicated Local API listener yet.
  if (profile !== "default" || process.platform !== "linux") return false;
  try {
    const state = JSON.parse(
      readFileSync(join(home, "gateway_state.json"), "utf-8"),
    ) as {
      kind?: unknown;
      hermes_home?: unknown;
      gateway_state?: unknown;
      pid?: unknown;
      start_time?: unknown;
      served_profiles?: unknown;
    };
    if (
      state.kind !== "hermes-gateway" ||
      typeof state.hermes_home !== "string" ||
      realpathSync(state.hermes_home) !== realpathSync(home) ||
      state.gateway_state !== "running" ||
      typeof state.pid !== "number" ||
      !Number.isSafeInteger(state.pid) ||
      state.pid <= 0 ||
      typeof state.start_time !== "number" ||
      !Number.isSafeInteger(state.start_time) ||
      !Array.isArray(state.served_profiles) ||
      !state.served_profiles.includes("default")
    ) {
      return false;
    }
    // Hermes Agent records Linux /proc field 22 (ticks since boot). Match
    // that fingerprint so a dead gateway's PID reused by another process
    // cannot make a stale state record appear online.
    const stat = readFileSync(`/proc/${state.pid}/stat`, "utf-8");
    const closingParen = stat.lastIndexOf(")");
    if (closingParen < 0) return false;
    const startTime = Number(
      stat
        .slice(closingParen + 2)
        .trim()
        .split(/\s+/)[19],
    );
    return startTime === state.start_time && isGatewayPidAlive(state.pid);
  } catch {
    return false;
  }
}
