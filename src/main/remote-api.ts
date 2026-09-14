import type { ConnectionConfig } from "./config";
import {
  probeRemoteAuthMode,
  RemoteOAuthError,
  requestRemoteOAuthJson,
  type RemoteOAuthRequestOptions,
} from "./remote-oauth";
import {
  dashboardApiUrl,
  remoteRequestJson,
  type RemoteSessionConfig,
} from "./remote-sessions";

export type RemoteDashboardRequestOptions = RemoteOAuthRequestOptions;

export class RemoteDashboardApiError extends Error {
  readonly unsupported: boolean;

  constructor(
    message: string,
    readonly statusCode?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RemoteDashboardApiError";
    this.unsupported = statusCode === 404;
  }
}

function statusCodeFromError(error: unknown): number | undefined {
  if (error instanceof RemoteOAuthError) return error.statusCode;
  if (!(error instanceof Error)) return undefined;
  const match = /^\s*(\d{3})(?::|\b)/.exec(error.message);
  return match ? Number(match[1]) : undefined;
}

function normalizeRemoteDashboardError(error: unknown): Error {
  if (error instanceof RemoteOAuthError && error.needsOAuthLogin) return error;
  const cause = error instanceof Error ? error : undefined;
  const message = cause?.message ?? String(error);
  return new RemoteDashboardApiError(message, statusCodeFromError(error), {
    cause,
  });
}

/**
 * Authenticated direct-Remote dashboard request boundary.
 *
 * OAuth requests stay in Electron's persistent cookie partition. Token
 * requests keep the existing X-Hermes-Session-Token transport. Callers must
 * select this only for direct Remote mode; local and SSH have separate paths.
 */
export async function remoteDashboardRequestJson<T>(
  connection: ConnectionConfig,
  path: string,
  options: RemoteDashboardRequestOptions = {},
  profile?: string,
): Promise<T> {
  if (connection.mode !== "remote") {
    return Promise.reject(
      new Error(
        "Remote dashboard API is available only in direct Remote mode.",
      ),
    );
  }

  const config: RemoteSessionConfig = {
    remoteUrl: connection.remoteUrl,
    apiKey: connection.apiKey,
    profile,
  };

  try {
    const authMode =
      connection.remoteAuthMode === "auto"
        ? (await probeRemoteAuthMode(connection.remoteUrl)).authMode
        : connection.remoteAuthMode;

    if (authMode === "oauth") {
      return (await requestRemoteOAuthJson(
        dashboardApiUrl(config, path),
        options,
      )) as T;
    }

    return await remoteRequestJson<T>(config, path, options);
  } catch (error) {
    throw normalizeRemoteDashboardError(error);
  }
}
