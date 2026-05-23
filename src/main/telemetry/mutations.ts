/**
 * HTTP mutation client for backend write endpoints (cron CRUD,
 * kanban CRUD, etc.). Lives next to the read-only ``client.ts``
 * but kept separate so the read path stays trivially auditable.
 *
 * Same connection-mode resolver and Bearer-token plumbing.
 * Translates response shape into a discriminated success/error
 * union so callers never throw.
 */

import http from "http";
import https from "https";
import { URL } from "url";

import { getApiUrl, getRemoteAuthHeader } from "../hermes";

export type MutationResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

const DEFAULT_TIMEOUT_MS = 12000;

function buildUrl(path: string): string {
  const base = getApiUrl();
  if (!path.startsWith("/")) path = "/" + path;
  return base.replace(/\/+$/, "") + path;
}

/**
 * Issue an HTTP request that may carry a JSON body. Used for
 * POST / PATCH / PUT. DELETE without a body uses ``method: "DELETE"``.
 */
export async function telemetryRequest<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<MutationResult<T>> {
  let url: string;
  try {
    url = buildUrl(path);
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 0, error: `Invalid URL: ${url}` };
  }

  const lib = parsed.protocol === "https:" ? https : http;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const payload = body === undefined ? "" : JSON.stringify(body);

  return new Promise<MutationResult<T>>((resolve) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...getRemoteAuthHeader(),
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) {
            // Empty body is fine for DELETE; treat as success.
            if (!responseBody.trim()) {
              resolve({ ok: true, data: undefined as unknown as T });
              return;
            }
            try {
              resolve({ ok: true, data: JSON.parse(responseBody) as T });
            } catch (err) {
              resolve({
                ok: false,
                status,
                error: `parse error: ${(err as Error).message}`,
              });
            }
            return;
          }
          // Try to extract `{"error": "..."}` envelope; fall back
          // to the raw body or status code.
          let errMsg = `HTTP ${status}`;
          try {
            const parsedBody = JSON.parse(responseBody);
            if (parsedBody && typeof parsedBody === "object") {
              errMsg =
                (parsedBody.error as string) ||
                (parsedBody.message as string) ||
                errMsg;
            }
          } catch {
            if (responseBody.trim()) errMsg = responseBody.trim().slice(0, 200);
          }
          resolve({ ok: false, status, error: errMsg });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, error: err.message });
    });
    if (payload) req.write(payload);
    req.end();
  });
}
