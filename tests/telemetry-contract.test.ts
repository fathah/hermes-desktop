/**
 * Contract tests — regression guard against upstream wire-shape
 * drift on the Phase A endpoints.
 *
 * Motivated by @pmos69's line-by-line review of fathah/hermes-
 * desktop#396, which surfaced that the original Phase A code
 * called paths and modelled DTOs that did NOT match what
 * NousResearch/hermes-agent #23742 (+ the #31125 enrichment)
 * actually exposes.
 *
 * For each of the three wired endpoints this file:
 *
 *   1. spins up an HTTP mock at the EXACT documented path,
 *      returning the EXACT documented live shape (verified
 *      against the deploy/codex-stack deployment running
 *      #23742 + #31125 on 2026-05-25);
 *   2. runs the real adapter from `src/main/telemetry/subsystems.ts`
 *      against it (not the lower-level client — Pedro asked for
 *      adapter-level coverage, not just client-level);
 *   3. asserts the adapter (a) called the right path, (b)
 *      produced the expected *Telemetry DTO, and (c) rejects a
 *      wrong-shape payload with `upstream-error` rather than
 *      wrapping garbage.
 *
 * The fixtures are NOT minimised — they carry the redundant
 * snake_case + camelCase fields, the empty arrays, the optional
 * fields, exactly as the live backend ships them. If upstream
 * ever changes one of those shapes, this test fails by name and
 * tells the reviewer which adapter to adjust.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";

// Mock hermes module so getApiUrl()/getRemoteAuthHeader() point at
// the test server. Same pattern as tests/telemetry-client.test.ts.
let serverPort = 0;
vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => `http://127.0.0.1:${serverPort}`,
  getRemoteAuthHeader: () => ({}),
}));

// Import AFTER the mock is registered so subsystems.ts picks it up.
import {
  fetchGatewayStatus,
  fetchMemory,
  fetchTools,
} from "../src/main/telemetry/subsystems";

let server: http.Server;
let routes: Record<string, (res: http.ServerResponse) => void> = {};
let pathsHit: string[] = [];

beforeEach(async () => {
  routes = {};
  pathsHit = [];
  // Silence the [telemetry] console.warn that fires on
  // validator-reject — visible would only clutter the negative
  // shape tests below.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  server = http.createServer((req, res) => {
    const url = req.url || "";
    pathsHit.push(url);
    const handler = routes[url];
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
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

// ---------------------------------------------------------------------------
// /api/gateway/status — NousResearch/hermes-agent#23742 + #31125
// ---------------------------------------------------------------------------

/**
 * Documented live shape captured from deploy/codex-stack on
 * 2026-05-25. Backend is hermes-agent v0.14.0 with #23742 +
 * #31125 (subsystem_capabilities hook) cherry-picked.
 */
const GATEWAY_STATUS_LIVE: Record<string, unknown> = {
  ok: true,
  running: true,
  pid: 13636,
  gateway_state: "running",
  platforms: {
    api_server: {
      state: "connected",
      error_code: null,
      error_message: null,
      updated_at: "2026-05-24T15:03:53.298526+00:00",
    },
    telegram: {
      state: "retrying",
      error_code: null,
      error_message: "failed to reconnect",
      updated_at: "2026-05-24T16:26:31.990259+00:00",
    },
  },
  active_agents: 0,
  exit_reason: null,
  updated_at: "2026-05-24T16:26:31.990238+00:00",
  version: "0.14.0",
  python_version: "3.11.15",
  openai_sdk_version: "2.24.0",
  released: "2026.5.7",
  subsystem_capabilities: ["memory", "tools"],
};

/** Documented /v1/capabilities response — best-effort merged
 *  into the capabilities list by the adapter. */
const CAPABILITIES_LIVE: Record<string, unknown> = {
  features: {
    remote_memory: true,
    remote_toolsets: true,
    remote_persona: false,
  },
};

describe("Contract: /api/gateway/status (#23742 + #31125)", () => {
  it("accepts the documented live shape and produces the expected DTO", async () => {
    routes["/api/gateway/status"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(GATEWAY_STATUS_LIVE));
    };
    routes["/v1/capabilities"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(CAPABILITIES_LIVE));
    };

    const env = await fetchGatewayStatus();

    expect(env.available).toBe(true);
    if (env.available) {
      expect(env.data.service).toBe("hermes-agent");
      expect(env.data.version).toBe("0.14.0");
      expect(env.data.released).toBe("2026.5.7");
      expect(env.data.pythonVersion).toBe("3.11.15");
      expect(env.data.openaiSdkVersion).toBe("2.24.0");
      // uptimeSeconds is intentionally omitted by the adapter —
      // backend doesn't expose it (see Commit 6 — the "—"
      // placeholder semantics).
      expect(env.data.uptimeSeconds).toBeUndefined();
      // Capabilities are union-merged from subsystem_capabilities
      // (memory + tools) and /v1/capabilities.features.remote_*
      // (memory + toolsets → "tools"). Persona is `false` so it
      // does NOT appear.
      expect([...env.data.capabilities].sort()).toEqual(["memory", "tools"]);
      // platforms map → upstreamProviders: api_server connected →
      // reachable; telegram retrying → unreachable.
      const api = env.data.upstreamProviders.find(
        (p) => p.name === "api_server",
      );
      const tg = env.data.upstreamProviders.find((p) => p.name === "telegram");
      expect(api).toMatchObject({ configured: true, reachable: true });
      expect(tg).toMatchObject({ configured: true, reachable: false });
    }
  });

  it("hits exactly /api/gateway/status, never the legacy /v1/telemetry/* path", async () => {
    routes["/api/gateway/status"] = (res) => {
      res.statusCode = 200;
      res.end(JSON.stringify(GATEWAY_STATUS_LIVE));
    };
    routes["/v1/capabilities"] = (res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({}));
    };

    await fetchGatewayStatus();

    expect(pathsHit).toContain("/api/gateway/status");
    expect(pathsHit.some((p) => p.startsWith("/v1/telemetry/"))).toBe(false);
  });

  it("rejects a wrong-shape payload (no `ok` boolean) as upstream-error", async () => {
    routes["/api/gateway/status"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      // Missing `ok` and `running` — the validator added in
      // Commit 2 must catch this on the raw-JSON fallback path.
      res.end(JSON.stringify({ pid: 42, gateway_state: "running" }));
    };

    const env = await fetchGatewayStatus();

    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("upstream-error");
    }
  });
});

// ---------------------------------------------------------------------------
// /api/tools/toolsets — NousResearch/hermes-agent#23742
// ---------------------------------------------------------------------------

/**
 * Documented live shape captured from deploy/codex-stack on
 * 2026-05-25. Each toolset carries the full Codex shape — key,
 * name, label (with emoji), description, enabled, available,
 * configured, and a tools array of tool-method names.
 */
const TOOLSETS_LIVE: Record<string, unknown> = {
  toolsets: [
    {
      key: "web",
      name: "web",
      label: "🔍 Web Search & Scraping",
      description: "web_search, web_extract",
      enabled: true,
      available: true,
      configured: true,
      tools: ["web_extract", "web_search"],
    },
    {
      key: "browser",
      name: "browser",
      label: "🌐 Browser Automation",
      description: "navigate, click, type, scroll",
      enabled: false,
      available: true,
      configured: false,
      tools: ["browser_back", "browser_click", "browser_navigate"],
    },
  ],
};

describe("Contract: /api/tools/toolsets (#23742)", () => {
  it("accepts the documented live shape and maps to ToolsTelemetry", async () => {
    routes["/api/tools/toolsets"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(TOOLSETS_LIVE));
    };

    const env = await fetchTools();

    expect(env.available).toBe(true);
    if (env.available) {
      expect(env.data.toolsets).toHaveLength(2);
      const web = env.data.toolsets.find((t) => t.key === "web");
      expect(web).toMatchObject({
        key: "web",
        label: "🔍 Web Search & Scraping",
        description: "web_search, web_extract",
        enabled: true,
        // Codex doesn't carry `source` — adapter defaults to "builtin".
        source: "builtin",
      });
      const browser = env.data.toolsets.find((t) => t.key === "browser");
      expect(browser?.enabled).toBe(false);
    }
  });

  it("hits exactly /api/tools/toolsets", async () => {
    routes["/api/tools/toolsets"] = (res) => {
      res.statusCode = 200;
      res.end(JSON.stringify(TOOLSETS_LIVE));
    };

    await fetchTools();

    expect(pathsHit).toContain("/api/tools/toolsets");
    expect(pathsHit.some((p) => p.startsWith("/v1/telemetry/"))).toBe(false);
  });

  it("rejects toolsets[i] with missing key (per-item validator)", async () => {
    routes["/api/tools/toolsets"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      // Empty object as item — would slip past a array-only
      // validator and reach the renderer as <li key={undefined}>.
      // Commit 2's per-item check must catch this.
      res.end(JSON.stringify({ toolsets: [{}] }));
    };

    const env = await fetchTools();

    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("upstream-error");
    }
  });
});

// ---------------------------------------------------------------------------
// /api/memory — NousResearch/hermes-agent#23742 + sanitiser #31568
// ---------------------------------------------------------------------------

/**
 * Documented live shape captured from deploy/codex-stack on
 * 2026-05-25. `user.content` arrives as "<redacted>" because
 * the sanitiser (#31568) is loaded server-side. The adapter
 * doesn't depend on `user.content` (it reads char_count
 * instead), so the redacted value is harmless — but the fixture
 * carries it explicitly so a future sanitiser regression on
 * the upstream side would be visible in this test's input.
 *
 * Both snake_case and camelCase variants are present — the
 * backend ships both for compatibility with old clients.
 */
const MEMORY_LIVE: Record<string, unknown> = {
  memory: {
    content: "",
    exists: true,
    lastModified: 1779630248,
    last_modified: 1779630248,
    entries: [],
    charCount: 0,
    char_count: 0,
    charLimit: 2200,
    char_limit: 2200,
  },
  user: {
    content: "<redacted>",
    exists: true,
    lastModified: 1779630434,
    last_modified: 1779630434,
    charCount: 9,
    char_count: 9,
    charLimit: 1375,
    char_limit: 1375,
  },
  stats: {
    totalSessions: 0,
    totalMessages: 0,
    total_sessions: 0,
    total_messages: 0,
  },
};

describe("Contract: /api/memory (#23742 + sanitiser #31568)", () => {
  it("accepts the documented live shape and maps to MemoryTelemetry", async () => {
    routes["/api/memory"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(MEMORY_LIVE));
    };

    const env = await fetchMemory();

    expect(env.available).toBe(true);
    if (env.available) {
      // Adapter synthesises a stable provider label — Codex'
      // /api/memory has no "provider" field of its own.
      expect(env.data.provider).toBe("hermes-server");
      // memory.exists OR user.exists → configured: true
      expect(env.data.configured).toBe(true);
      // entries[] is empty in the live fixture, sum of char
      // counts is 0 (memory) + 9 (user) = 9.
      expect(env.data.itemCount).toBe(0);
      expect(env.data.sizeBytes).toBe(9);
      // last_modified epoch → ISO string with Z suffix.
      expect(env.data.lastUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    }
  });

  it("hits exactly /api/memory", async () => {
    routes["/api/memory"] = (res) => {
      res.statusCode = 200;
      res.end(JSON.stringify(MEMORY_LIVE));
    };

    await fetchMemory();

    expect(pathsHit).toContain("/api/memory");
    expect(pathsHit.some((p) => p.startsWith("/v1/telemetry/"))).toBe(false);
  });

  it("rejects a wrong-shape payload (no memory object) as upstream-error", async () => {
    routes["/api/memory"] = (res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      // `memory` and `user` sub-objects are the required keys
      // per the validator from Commit 2.
      res.end(JSON.stringify({ stats: {} }));
    };

    const env = await fetchMemory();

    expect(env.available).toBe(false);
    if (!env.available) {
      expect(env.reason).toBe("upstream-error");
    }
  });
});
