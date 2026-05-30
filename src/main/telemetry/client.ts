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
 * without the base — e.g. `/api/gateway/status`.
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
/**
 * Optional shape validator passed by adapter callers. Returns
 * `true` if the payload carries the required fields the caller
 * cares about, or a short error string if it doesn't. Runs on
 * BOTH wrapper paths:
 *
 *  - Envelope path (`{available:true, data: …}`) — validator is
 *    called on `env.data` before forwarding. `available:false`
 *    envelopes carry no data and bypass it.
 *  - Raw-JSON fallback path — validator is called on the parsed
 *    body before it's wrapped as `{available:true, data}`.
 *
 * Validators check REQUIRED keys only — unknown fields are
 * tolerated by design (forward-compat with backend additions).
 */
export type ShapeValidator = (data: unknown) => true | string;

export async function telemetryGet<T>(
  path: string,
  opts: { timeoutMs?: number; validateShape?: ShapeValidator } = {},
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
            const json = JSON.parse(body) as unknown;
            // Path 1: backend speaks the envelope contract directly.
            //   When the envelope is `available:true` and the caller
            //   supplied a `validateShape`, we validate `env.data`
            //   before forwarding so a wrong-shape payload can't slip
            //   through into the renderer where a view could crash
            //   on undefined access.
            //
            //   `available:false` envelopes carry no `data` to
            //   validate and pass through unchanged.
            if (
              json &&
              typeof json === "object" &&
              "available" in (json as Record<string, unknown>)
            ) {
              const env = json as TelemetryEnvelope<T>;
              if (env.available && opts.validateShape) {
                const verdict = opts.validateShape(env.data);
                if (verdict !== true) {
                  // Debug-log for `npm run dev` main-process console;
                  // user-facing `detail` is left empty so the UI
                  // shows the standard upstream-error empty-state
                  // instead of debug text.
                  console.warn(
                    `[telemetry] ${path}: envelope.data shape mismatch (${verdict})`,
                  );
                  resolve(envelopeError("upstream-error"));
                  return;
                }
              }
              resolve(env);
              return;
            }
            // Path 2: raw-JSON fallback for backends that don't speak
            //   the envelope. We wrap as `available:true` ONLY if the
            //   caller-supplied `validateShape` agrees the payload
            //   carries the expected required fields. Without
            //   `validateShape` we wrap permissively (back-compat).
            //
            //   Unknown fields are tolerated by design — validators
            //   check required keys only.
            if (opts.validateShape) {
              const verdict = opts.validateShape(json);
              if (verdict !== true) {
                console.warn(
                  `[telemetry] ${path}: raw payload shape mismatch (${verdict})`,
                );
                resolve(envelopeError("upstream-error"));
                return;
              }
            }
            resolve({ available: true, data: json as T });
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
