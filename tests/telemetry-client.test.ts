/**
 * Unit tests for `src/main/telemetry/client.ts` — the
 * Node-side HTTP fetcher. The client is path-agnostic (the
 * caller passes the path), so these tests exercise its
 * transport + envelope + validation behaviour using arbitrary
 * route names, NOT the real `/api/*` endpoints — those are
 * covered end-to-end in tests/telemetry-contract.test.ts.
 *
 * We spin up a tiny http.Server inside each test and point the
 * client at it by stubbing the connection-mode resolvers it
 * imports from `../hermes`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";

// Mock the hermes module so getApiUrl()/getRemoteAuthHeader()
// point at the test server.
let serverPort = 0;
const authHeaderMock = vi.fn(() => ({}) as Record<string, string>);
vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => `http://127.0.0.1:${serverPort}`,
  getRemoteAuthHeader: () => authHeaderMock(),
}));

// Import AFTER the mock is registered.
import { telemetryGet } from "../src/main/telemetry/client";

let server: http.Server;
let routes: Record<string, (res: http.ServerResponse) => void> = {};

beforeEach(async () => {
  routes = {};
  server = http.createServer((req, res) => {
    const handler = routes[req.url || ""];
    if (handler) {
      handler(res);
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverPort = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  authHeaderMock.mockClear();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("telemetryGet", () => {
  it("returns the parsed envelope on 200", async () => {
    routes["/v1/telemetry/gateway-status"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          available: true,
          data: {
            service: "hermes-agent",
            version: "0.14.0",
            uptimeSeconds: 42,
            capabilities: ["tools"],
            upstreamProviders: [],
          },
        }),
      );
    };

    const env = await telemetryGet("/v1/telemetry/gateway-status");
    expect(env.available).toBe(true);
    if (env.available) {
      expect(env.data).toMatchObject({ version: "0.14.0" });
    }
  });

  it("forwards an available:false envelope unchanged", async () => {
    routes["/v1/telemetry/kanban"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          available: false,
          reason: "not-configured",
          detail: "no board",
        }),
      );
    };

    const env = await telemetryGet("/v1/telemetry/kanban");
    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("not-configured");
      expect(env.detail).toBe("no board");
    }
  });

  it("maps 404 to not-implemented", async () => {
    // No route registered → default 404
    const env = await telemetryGet("/v1/telemetry/missing");
    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("not-implemented");
    }
  });

  it("maps 500 to upstream-error", async () => {
    routes["/v1/telemetry/boom"] = (res) => {
      res.statusCode = 500;
      res.end("kaboom");
    };
    const env = await telemetryGet("/v1/telemetry/boom");
    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("upstream-error");
      expect(env.detail).toMatch(/500/);
    }
  });

  it("maps 401 to upstream-error with auth detail", async () => {
    routes["/v1/telemetry/restricted"] = (res) => {
      res.statusCode = 401;
      res.end("nope");
    };
    const env = await telemetryGet("/v1/telemetry/restricted");
    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("upstream-error");
      expect(env.detail).toMatch(/auth/);
    }
  });

  it("sends the auth header from getRemoteAuthHeader()", async () => {
    authHeaderMock.mockReturnValueOnce({
      Authorization: "Bearer test-token",
    });
    let seenAuth: string | undefined;
    routes["/v1/telemetry/gateway-status"] = (res) => {
      // Headers are visible on the req we don't have here; capture via a
      // wrapper server. Instead, use the request listener directly.
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ available: true, data: { x: 1 } }));
    };

    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      seenAuth = req.headers.authorization;
      const handler = routes[req.url || ""];
      if (handler) return handler(res);
      res.statusCode = 404;
      res.end();
    });

    await telemetryGet("/v1/telemetry/gateway-status");
    expect(seenAuth).toBe("Bearer test-token");
  });

  it("returns upstream-error on connection refused", async () => {
    // Stop the server first; the client will fail to connect.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const env = await telemetryGet("/v1/telemetry/anything");
    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("upstream-error");
    }
    // Restart for afterEach close to find a server (cheap).
    server = http.createServer();
    await new Promise<void>((resolve) =>
      server.listen(serverPort, "127.0.0.1", resolve),
    );
  });
});

// ---------------------------------------------------------------------------
// validateShape — runs on BOTH paths
// ---------------------------------------------------------------------------

describe("telemetryGet — validateShape", () => {
  // Require `{kind: string}` for these tests; minimal validator so
  // we can exercise the validation pathway without locking the
  // tests to a specific real DTO.
  const requireKind = (data: unknown): true | string => {
    if (!data || typeof data !== "object") return "expected object";
    if (typeof (data as Record<string, unknown>)["kind"] !== "string") {
      return "missing 'kind'";
    }
    return true;
  };

  beforeEach(() => {
    // Silence the [telemetry] console.warn during validator
    // negative tests — clutter, not signal.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("envelope path: validator passes when env.data matches shape", async () => {
    routes["/v1/telemetry/ok"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          available: true,
          data: { kind: "expected", extra: "tolerated" },
        }),
      );
    };
    const env = await telemetryGet("/v1/telemetry/ok", {
      validateShape: requireKind,
    });
    expect(env.available).toBe(true);
  });

  it("envelope path: validator rejects env.data when shape is wrong", async () => {
    routes["/v1/telemetry/bad-env"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      // Envelope valid, but env.data missing `kind`.
      res.end(
        JSON.stringify({
          available: true,
          data: { unrelated: 42 },
        }),
      );
    };
    const env = await telemetryGet("/v1/telemetry/bad-env", {
      validateShape: requireKind,
    });
    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("upstream-error");
      // Detail is intentionally empty (debug-log only).
      expect(env.detail).toBeUndefined();
    }
  });

  it("envelope path: available:false envelopes skip validation (no data)", async () => {
    routes["/v1/telemetry/unavail"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          available: false,
          reason: "not-configured",
          detail: "no subsystem",
        }),
      );
    };
    const env = await telemetryGet("/v1/telemetry/unavail", {
      validateShape: requireKind,
    });
    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("not-configured");
      expect(env.detail).toBe("no subsystem");
    }
  });

  it("raw fallback: validator passes when raw payload matches shape", async () => {
    routes["/v1/telemetry/raw-ok"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      // No envelope wrapper — raw JSON.
      res.end(JSON.stringify({ kind: "expected", extra: "tolerated" }));
    };
    const env = await telemetryGet("/v1/telemetry/raw-ok", {
      validateShape: requireKind,
    });
    expect(env.available).toBe(true);
    if (env.available) {
      expect(env.data).toMatchObject({ kind: "expected" });
    }
  });

  it("raw fallback: validator rejects raw payload when shape is wrong", async () => {
    routes["/v1/telemetry/raw-bad"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ unrelated: 42 }));
    };
    const env = await telemetryGet("/v1/telemetry/raw-bad", {
      validateShape: requireKind,
    });
    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("upstream-error");
      expect(env.detail).toBeUndefined();
    }
  });

  it("no validateShape: both paths back-compat (envelope forwarded, raw wrapped)", async () => {
    routes["/v1/telemetry/no-validator"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ unrelated: 42 }));
    };
    const env = await telemetryGet("/v1/telemetry/no-validator");
    expect(env.available).toBe(true);
    if (env.available) {
      expect(env.data).toMatchObject({ unrelated: 42 });
    }
  });
});
