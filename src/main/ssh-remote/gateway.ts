import type { SshConfig } from "../ssh-tunnel";
import { sshExec } from "./core";
import { sshReadEnv } from "./config";
import { buildRemoteHermesCmd } from "./platforms";

// ── Gateway ───────────────────────────────────────────────────────────────────
//
// In SSH mode the remote gateway may be owned by a systemd `hermes.service`
// unit — the standard VPS installer sets this up. Starting our own detached
// `nohup` gateway then strands that unit in a restart crash-loop (issue
// #285). Each operation below therefore asks the remote, in a single shell
// `if`, whether such a unit is installed and routes the request through
// systemd when it is — one SSH round-trip, atomic decision. The command
// strings are built by the exported helpers below so they can be unit
// tested without a live host.

/**
 * Shell test that succeeds when a systemd `hermes.service` unit file is
 * installed on the remote. Safe on hosts without systemd: a missing
 * `systemctl` yields empty output, so the test simply fails and callers
 * fall back to the plain (`nohup` / pidfile) path.
 */
const SYSTEMD_HERMES_UNIT_TEST =
  "systemctl list-unit-files hermes.service 2>/dev/null | " +
  "grep -q '^hermes\\.service'";

/**
 * Command to start the remote gateway (issue #285). When a systemd
 * `hermes.service` exists it owns the lifecycle, so the request is handed
 * to systemd — `hermes.service` is a system unit, so `sudo` is tried first,
 * then a direct call for when the SSH user is root. If neither works the
 * command does nothing on purpose: an unmanaged `nohup` orphan that
 * crash-loops the systemd unit is worse than a gateway that simply did not
 * start (the status check will then report it as down). The detached
 * `nohup` start is used only when there is no unit to collide with.
 */
export function buildGatewayStartCommand(): string {
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `sudo -n systemctl start hermes.service 2>/dev/null || ` +
    `systemctl start hermes.service 2>/dev/null || true; ` +
    `else ` +
    `(nohup hermes gateway start > $HOME/.hermes/gateway.log 2>&1 &); ` +
    `fi`
  );
}

/**
 * Command to stop the remote gateway (issue #285). Routed through systemd
 * when a `hermes.service` unit exists, so the unit is left cleanly inactive
 * rather than the desktop killing a process systemd would just restart;
 * otherwise it falls back to `hermes gateway stop` and, last resort, the
 * recorded pid.
 */
export function buildGatewayStopCommand(): string {
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `sudo -n systemctl stop hermes.service 2>/dev/null || ` +
    `systemctl stop hermes.service 2>/dev/null || true; ` +
    `else ` +
    `hermes gateway stop 2>/dev/null || ` +
    `(if [ -f $HOME/.hermes/gateway.pid ]; then ` +
    `pid=$(python3 -c "import json; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d['pid'] if isinstance(d,dict) else d)" 2>/dev/null); ` +
    `[ -n "$pid" ] && kill $pid 2>/dev/null; fi); true; ` +
    `fi`
  );
}

/**
 * Command to report remote gateway state (issue #285). For a systemd-managed
 * gateway this is the unit's `is-active` state (`active` when up); otherwise
 * it is a liveness check on the recorded pid. Prints `active` or `running`
 * when up, anything else when not.
 */
export function buildGatewayStatusCommand(): string {
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `systemctl is-active hermes.service 2>/dev/null || true; ` +
    `else ` +
    `if [ -f $HOME/.hermes/gateway.pid ]; then ` +
    `pid=$(python3 -c "import json,sys; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d.get('pid',d) if isinstance(d,dict) else d)" 2>/dev/null || cat $HOME/.hermes/gateway.pid); ` +
    `kill -0 $pid 2>/dev/null && echo "running" || echo "stopped"; ` +
    `else echo "stopped"; fi; ` +
    `fi`
  );
}

export async function sshGatewayStatus(config: SshConfig): Promise<boolean> {
  try {
    const out = await sshExec(config, buildGatewayStatusCommand());
    const state = out.trim();
    return state === "running" || state === "active";
  } catch {
    return false;
  }
}

export async function sshStartGateway(config: SshConfig): Promise<void> {
  try {
    await sshExec(config, buildGatewayStartCommand());
  } catch {
    // best effort
  }
}

export async function sshStopGateway(config: SshConfig): Promise<void> {
  try {
    await sshExec(config, buildGatewayStopCommand());
  } catch {
    // best effort
  }
}

// ── Remote API key (for chat auth through SSH tunnel) ─────────────────────────

export async function sshReadRemoteApiKey(config: SshConfig): Promise<string> {
  try {
    const env = await sshReadEnv(config);
    return env["API_SERVER_KEY"] || "";
  } catch {
    return "";
  }
}

// ── Versions ──────────────────────────────────────────────────────────────────

export async function sshGetHermesVersion(
  config: SshConfig,
): Promise<string | null> {
  try {
    // Use the venv-probe path so the version string is the real multi-line
    // output (Engine / Released / Python / OpenAI SDK) the Settings UI
    // parses, not an empty string when the /usr/local/bin/hermes wrapper
    // refuses to run as the hermes user. See buildRemoteHermesCmd notes.
    const out = await sshExec(
      config,
      buildRemoteHermesCmd(["--version"], " 2>/dev/null"),
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}
