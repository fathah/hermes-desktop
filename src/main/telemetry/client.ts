/**
 * HTTP client for the read-only telemetry endpoints.
 *
 * Reuses the existing connection-mode plumbing in `../hermes`:
 *  - getApiUrl()           — picks local / remote / ssh-tunnel base URL
 *  - getRemoteAuthHeader() — adds Bearer token in remote / ssh modes
 *
 * Translates every transport- and HTTP-level error into a
 * TelemetryEnvelope so callers (IPC handlers) never have to deal
 * with exceptions.
 */

import http from "http";
import https from "https";
import { URL } from "url";

import { getApiUrl, getRemoteAuthHeader } from "../hermes";
import type {
  TelemetryEnvelope,
  TelemetryUnavailableReason,
} from "../../shared/telemetry-types";

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Build a full URL for a telemetry path. Caller passes the path
 * without the base — e.g. `/api/v1/telemetry/gateway-status`.
 *
 * Throws if no API base can be resolved (rare; e.g. SSH tunnel
 * configured but not started). Callers catch and map to an
 * `upstream-error` envelope.
 */
function buildUrl(path: string): string {
  const base = getApiUrl();
  if (!path.startsWith("/")) path = "/" + path;
  return base.replace(/\/+$/, "") + path;
}

function envelopeError<T>(
  reason: TelemetryUnavailableReason,
  detail?: string,
): TelemetryEnvelope<T> {
  return { available: false, reason, ...(detail ? { detail } : {}) };
}

/**
 * Perform a GET request and parse the body as JSON. Returns the
 * parsed envelope on 2xx, maps non-2xx and transport errors to
 * `available:false` envelopes.
 *
 * Note: the backend itself is expected to ALSO respond with an
 * envelope (200 + `{available:false,reason:'…'}`) when a subsystem
 * is missing. The 404/5xx mappings below are pure drift-protection
 * for old backends that don't speak the envelope yet.
 */
export async function telemetryGet<T>(
  path: string,
  opts: { timeoutMs?: number } = {},
): Promise<TelemetryEnvelope<T>> {
  let url: string;
  try {
    url = buildUrl(path);
  } catch (err) {
    return envelopeError("upstream-error", (err as Error).message);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return envelopeError("upstream-error", `Invalid URL: ${url}`);
  }

  const lib = parsed.protocol === "https:" ? https : http;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<TelemetryEnvelope<T>>((resolve) => {
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {
          Accept: "application/json",
          ...getRemoteAuthHeader(),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 0;

          // Drift fallback: old backends without telemetry support.
          if (status === 404) {
            resolve(envelopeError("not-implemented"));
            return;
          }
          if (status === 401 || status === 403) {
            resolve(envelopeError("upstream-error", `auth (${status})`));
            return;
          }
          if (status >= 500) {
            resolve(envelopeError("upstream-error", `backend ${status}`));
            return;
          }
          if (status < 200 || status >= 300) {
            resolve(
              envelopeError("upstream-error", `unexpected status ${status}`),
            );
            return;
          }

          try {
            const json = JSON.parse(body) as TelemetryEnvelope<T>;
            // Defensive: be tolerant if backend forgot the envelope.
            if (json && typeof json === "object" && "available" in json) {
              resolve(json);
              return;
            }
            // Treat as raw data — wrap it ourselves.
            resolve({ available: true, data: json as unknown as T });
          } catch (err) {
            resolve(
              envelopeError(
                "upstream-error",
                `parse error: ${(err as Error).message}`,
              ),
            );
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve(envelopeError("upstream-error", err.message));
    });
    req.end();
  });
}
