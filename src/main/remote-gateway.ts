import { getConnectionConfig, type ConnectionConfig } from "./config";
import { normaliseRemoteUrl } from "./hermes";
import { remoteDashboardRequestJson } from "./remote-api";
import type {
  RemoteGatewayAction,
  RemoteGatewayActionResult,
  RemoteGatewayCommandStatus,
} from "../shared/gateway";

type GatewayAction = RemoteGatewayAction;
type GatewayActionResult = RemoteGatewayActionResult;
type GatewayStatus = { gateway_running: boolean; gateway_pid?: number | null };
type ActionStatus = {
  pid: number | null;
  running: boolean;
  exit_code: number | null;
};

// Shutdown can drain active work for ~180 seconds. Timeout reports unconfirmed
// completion; it does not cancel an accepted server command.
const COMPLETION_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 1000;
const pendingActions = new Set<string>();
const admissionRevisions = new Map<string, number>();
type PendingOperation = {
  connection: ConnectionConfig;
  profile?: string;
  action: GatewayAction;
  pid?: number;
  before?: GatewayStatus;
  observedStopped: boolean;
};
const unconfirmedOperations = new Map<string, PendingOperation>();
class GatewayCommandFailedError extends Error {}

function targetKey(connection: ConnectionConfig): string {
  return normaliseRemoteUrl(connection.remoteUrl);
}

function profileQuery(path: string, profile?: string): string {
  return `${path}?profile=${encodeURIComponent(profile || "default")}`;
}

async function gatewayJson<T>(
  connection: ConnectionConfig,
  path: string,
  method: "GET" | "POST" = "GET",
  timeoutMs = 15_000,
): Promise<T> {
  const anonymousRequest = async (): Promise<T> => {
    const response = await fetch(
      `${normaliseRemoteUrl(connection.remoteUrl)}${path}`,
      {
        method,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) {
      // Refusal headers prove rejection even when a proxy returns an empty or
      // HTML body. Parsing failures must not erase that admission evidence.
      const data = await response.json().catch(() => undefined);
      throw Object.assign(
        new Error(data?.error || data?.detail || `HTTP ${response.status}`),
        { statusCode: response.status },
      );
    }
    return (await response.json()) as T;
  };
  if (connection.remoteAuthMode === "token" && !connection.apiKey?.trim()) {
    return anonymousRequest();
  }
  try {
    return await remoteDashboardRequestJson<T>(connection, path, {
      method,
      timeoutMs,
    });
  } catch (error) {
    // Only a resolved keyless token boundary permits anonymous compatibility.
    // OAuth login/probe errors must never become anonymous mutations.
    if (
      !connection.apiKey?.trim() &&
      connection.remoteAuthMode !== "oauth" &&
      error instanceof Error &&
      error.message === "Remote Hermes dashboard token is not configured."
    ) {
      return anonymousRequest();
    }
    throw error;
  }
}

async function readGatewayStatus(
  connection: ConnectionConfig,
  profile?: string,
  timeoutMs?: number,
): Promise<GatewayStatus> {
  const status = await gatewayJson<GatewayStatus>(
    connection,
    profileQuery("/api/status", profile),
    "GET",
    timeoutMs,
  );
  if (typeof status?.gateway_running !== "boolean") {
    throw new Error("Remote gateway status did not include gateway_running.");
  }
  return status;
}

export async function remoteGatewayStatus(profile?: string): Promise<boolean> {
  try {
    return (await readGatewayStatus({ ...getConnectionConfig() }, profile))
      .gateway_running;
  } catch {
    return false;
  }
}

async function operationComplete(
  operation: PendingOperation,
  timeoutMs = 15_000,
): Promise<boolean> {
  const { connection, profile, action, pid, before } = operation;
  if (pid === undefined)
    throw new Error(
      `Remote gateway ${action} admission could not be confirmed. Lifecycle controls remain blocked because the accepted action PID is unknown.`,
    );
  const command = await gatewayJson<ActionStatus>(
    connection,
    profileQuery(`/api/actions/gateway-${action}/status`, profile),
    "GET",
    timeoutMs,
  );
  if (command?.pid !== pid) {
    throw new Error(
      `Remote gateway ${action} action was replaced; completion cannot be confirmed.`,
    );
  }
  if (
    typeof command.running !== "boolean" ||
    (!command.running && !Number.isInteger(command.exit_code))
  ) {
    throw new Error(
      `Remote gateway ${action} did not return a completed action result.`,
    );
  }
  if (!command.running && command.exit_code !== 0) {
    throw new GatewayCommandFailedError(
      `Remote gateway ${action} failed (exit ${command.exit_code}).`,
    );
  }
  const status = await readGatewayStatus(connection, profile, timeoutMs);
  if (!status.gateway_running) operation.observedStopped = true;
  const expectedState =
    action === "stop" ? !status.gateway_running : status.gateway_running;
  const restarted =
    action !== "restart" ||
    operation.observedStopped ||
    (typeof before?.gateway_pid === "number" &&
      typeof status.gateway_pid === "number" &&
      before.gateway_pid !== status.gateway_pid);
  return !command.running && expectedState && restarted;
}

async function commandStatus(
  connection: ConnectionConfig,
  profile?: string,
): Promise<RemoteGatewayCommandStatus> {
  const key = targetKey(connection);
  const revision = admissionRevisions.get(key);
  const result = (
    pending: boolean,
    failure?: { error: string },
  ): RemoteGatewayCommandStatus => {
    // A refresh begun before a newer admission cannot publish old failure or
    // idle evidence, even if that newer command has already finished.
    if (admissionRevisions.get(key) !== revision) return { pending: true };
    return { pending, ...(failure ? { failure } : {}) };
  };
  if (pendingActions.has(key)) return result(true);
  const operation = unconfirmedOperations.get(key);
  let failure: { error: string } | undefined;
  if (operation) {
    try {
      if (!(await operationComplete(operation))) return result(true);
      if (unconfirmedOperations.get(key) === operation)
        unconfirmedOperations.delete(key);
    } catch (error) {
      // Only a matching terminal failure proves the admitted command stopped.
      // Timeout, auth failures or replaced records retain the operation lock.
      if (!(error instanceof GatewayCommandFailedError)) throw error;
      if (unconfirmedOperations.get(key) === operation) {
        unconfirmedOperations.delete(key);
        failure = { error: error.message };
      }
    }
  }
  if (pendingActions.has(key) || unconfirmedOperations.has(key))
    return result(true, failure);
  // The server action registry is global by name. Conservatively block any
  // in-flight gateway command, including commands submitted by other clients.
  try {
    for (const action of ["start", "stop", "restart"] as const) {
      const status = await gatewayJson<ActionStatus>(
        connection,
        profileQuery(`/api/actions/gateway-${action}/status`, profile),
      );
      if (serverCommandPending(status)) return result(true, failure);
    }
  } catch (error) {
    // A failed global preflight keeps controls restricted, but must not erase
    // the matching terminal result already observed for this view.
    if (failure) return result(true, failure);
    throw error;
  }
  return result(
    pendingActions.has(key) || unconfirmedOperations.has(key),
    failure,
  );
}

function serverCommandPending(status: ActionStatus): boolean {
  if (typeof status?.running !== "boolean")
    throw new Error("Remote gateway action status did not include running.");
  if (status.running) return true;
  if (status.pid === null && status.exit_code === null) return false;
  if (
    typeof status.pid !== "number" ||
    !Number.isInteger(status.pid) ||
    status.pid <= 0
  )
    throw new Error(
      "Remote gateway action status did not include a valid PID.",
    );
  return !Number.isInteger(status.exit_code);
}

export async function remoteGatewayCommandPending(
  profile?: string,
): Promise<boolean> {
  return (await remoteGatewayCommandStatus(profile)).pending;
}

export async function remoteGatewayCommandStatus(
  profile?: string,
): Promise<RemoteGatewayCommandStatus> {
  return commandStatus({ ...getConnectionConfig() }, profile);
}

// @lat: [[main-process#Main Process#Remote Gateway management]]
async function spawnGatewayAction(
  action: GatewayAction,
  profile?: string,
): Promise<GatewayActionResult> {
  const connection = { ...getConnectionConfig() };
  const key = targetKey(connection);
  if (pendingActions.has(key))
    return {
      success: false,
      error: "A gateway command is already pending for this remote profile.",
      failureKind: "unconfirmed",
    };
  // Reserve before the asynchronous preflight so concurrent desktop requests
  // cannot both pass it and submit overlapping commands.
  pendingActions.add(key);
  admissionRevisions.set(key, (admissionRevisions.get(key) ?? 0) + 1);
  try {
    const operation = unconfirmedOperations.get(key);
    if (operation) {
      if (!(await operationComplete(operation)))
        throw new Error(
          "A gateway command is still awaiting completion for this remote profile.",
        );
      unconfirmedOperations.delete(key);
    }
    for (const actionName of ["start", "stop", "restart"] as const) {
      const status = await gatewayJson<ActionStatus>(
        connection,
        profileQuery(`/api/actions/gateway-${actionName}/status`, profile),
      );
      if (serverCommandPending(status))
        throw new Error(
          "A server gateway command is already pending. Refresh status after it completes.",
        );
    }
    const before = await readGatewayStatus(connection, profile);
    const name = `gateway-${action}`;
    const accepted: PendingOperation = {
      connection,
      profile,
      action,
      before,
      observedStopped: before.gateway_running === false,
    };
    // Dispatch can succeed on the server even when its HTTP response is lost.
    // Reserve uncertainty before POST; missing admission PID cannot release it.
    unconfirmedOperations.set(key, accepted);
    let result: { ok?: boolean; pid?: number; name?: string };
    try {
      result = await gatewayJson<{
        ok?: boolean;
        pid?: number;
        name?: string;
      }>(connection, profileQuery(`/api/gateway/${action}`, profile), "POST");
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? error.statusCode
          : undefined;
      // Explicit refusal statuses prove rejection even with a non-JSON body.
      // Network errors, 5xx and malformed success responses remain uncertain.
      if (
        typeof statusCode === "number" &&
        [400, 401, 403, 404, 405, 409, 422, 429].includes(statusCode)
      ) {
        if (unconfirmedOperations.get(key) === accepted)
          unconfirmedOperations.delete(key);
      }
      throw error;
    }
    if (
      result?.ok !== true ||
      result.name !== name ||
      !Number.isInteger(result.pid) ||
      (result.pid ?? 0) <= 0
    )
      throw new Error(
        `Remote gateway ${action} did not return a trackable action.`,
      );
    accepted.pid = result.pid;
    const deadline = Date.now() + COMPLETION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (
        await operationComplete(
          accepted,
          Math.min(15_000, deadline - Date.now()),
        )
      ) {
        unconfirmedOperations.delete(key);
        return { success: true };
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())),
        ),
      );
    }
    throw new Error(
      `Remote gateway ${action} completion could not be confirmed. The server may still be processing the command. Refresh status to check completion.`,
    );
  } catch (err) {
    if (err instanceof GatewayCommandFailedError)
      unconfirmedOperations.delete(key);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      // Retained admission, rather than error wording, determines uncertainty.
      failureKind: unconfirmedOperations.has(key) ? "unconfirmed" : "failed",
    };
  } finally {
    pendingActions.delete(key);
  }
}

export const remoteGatewayAction = (
  action: RemoteGatewayAction,
  profile?: string,
): Promise<RemoteGatewayActionResult> => spawnGatewayAction(action, profile);

export const remoteStartGateway = (
  profile?: string,
): Promise<GatewayActionResult> => spawnGatewayAction("start", profile);
export const remoteStopGateway = (
  profile?: string,
): Promise<GatewayActionResult> => spawnGatewayAction("stop", profile);
export const remoteRestartGateway = (
  profile?: string,
): Promise<GatewayActionResult> => spawnGatewayAction("restart", profile);
