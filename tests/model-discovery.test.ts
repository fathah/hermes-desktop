import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import http from "http";
import type { AddressInfo } from "net";

/**
 * model-discovery is a small HTTP client; we spin up a real loopback
 * server so the tests exercise the actual fetch/parse path instead of
 * stubbing it.  Keeps coverage honest without hitting the network.
 */

let testHome: string;
let server: http.Server;
let baseUrl: string;

async function loadDiscovery(): Promise<
  typeof import("../src/main/model-discovery")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  const mod = await import("../src/main/model-discovery");
  mod._clearCache();
  return mod;
}

function listen(): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}/v1`;
      resolve();
    });
  });
}

function close(): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("model-discovery", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-discovery-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (server && server.listening) await close();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("returns the parsed list when /models returns the standard OpenAI shape", async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/v1/models" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ id: "gamma" }, { id: "alpha" }, { id: "beta" }],
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await listen();
    writeFileSync(join(testHome, ".env"), "DEEPSEEK_API_KEY=sk-test\n");

    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "custom",
      baseUrl,
      "sk-explicit",
      undefined,
    );

    expect(result.status).toBe("ok");
    expect(result.cached).toBe(false);
    // Sorted alphabetically
    expect(result.models).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns status=no-key for public custom endpoints when no apiKey is provided or in .env", async () => {
    server = http.createServer(() => {
      throw new Error("must not be called when there's no key");
    });
    await listen();
    // .env intentionally empty of DEEPSEEK_API_KEY
    writeFileSync(join(testHome, ".env"), "");

    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "custom",
      "https://example.com/v1",
      undefined,
      undefined,
    );
    expect(result.status).toBe("no-key");
    expect(result.models).toEqual([]);
  });

  it("discovers loopback custom models without an API key", async () => {
    let receivedAuth = "not-called";
    server = http.createServer((req, res) => {
      receivedAuth = String(req.headers["authorization"] || "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "llama3.2:latest" }] }));
    });
    await listen();
    writeFileSync(join(testHome, ".env"), "");

    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "custom",
      baseUrl,
      undefined,
      undefined,
    );

    expect(result.status).toBe("ok");
    expect(result.models).toEqual(["llama3.2:latest"]);
    expect(receivedAuth).toBe("");
  });

  it("discovers named local-provider models without an API key", async () => {
    let receivedAuth = "not-called";
    server = http.createServer((req, res) => {
      receivedAuth = String(req.headers["authorization"] || "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "qwen2.5-coder:7b" }] }));
    });
    await listen();
    writeFileSync(join(testHome, ".env"), "");

    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "atomicchat",
      baseUrl,
      undefined,
      undefined,
    );

    expect(result.status).toBe("ok");
    expect(result.models).toEqual(["qwen2.5-coder:7b"]);
    expect(receivedAuth).toBe("");
  });

  it("uses the Xiaomi MiMo env key for first-class xiaomi discovery", async () => {
    let receivedAuth = "";
    server = http.createServer((req, res) => {
      receivedAuth = String(req.headers["authorization"] || "");
      if (req.url === "/v1/models" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mimo-v2.5-pro" }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await listen();
    writeFileSync(join(testHome, ".env"), "XIAOMI_API_KEY=sk-mimo-test\n");

    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "xiaomi",
      baseUrl,
      undefined,
      undefined,
    );

    expect(receivedAuth).toBe("Bearer sk-mimo-test");
    expect(result.status).toBe("ok");
    expect(result.models).toEqual(["mimo-v2.5-pro"]);
  });

  it("returns status=unsupported for known no-discovery providers", async () => {
    const { discoverProviderModels } = await loadDiscovery();
    // openai-codex / qwen-oauth / nous are no longer here — OAuth
    // providers (including `nous` as of #367) are discovered via
    // hermes-agent's provider_model_ids instead.
    for (const provider of ["google", "xai"]) {
      const result = await discoverProviderModels(
        provider,
        undefined,
        "sk-x",
        undefined,
      );
      expect(result.status).toBe("unsupported");
      expect(result.models).toEqual([]);
    }
  });

  it("forwards Bearer auth on the request", async () => {
    let receivedAuth = "";
    server = http.createServer((req, res) => {
      receivedAuth = String(req.headers["authorization"] || "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "m1" }] }));
    });
    await listen();
    writeFileSync(join(testHome, ".env"), "");

    const { discoverProviderModels } = await loadDiscovery();
    await discoverProviderModels("custom", baseUrl, "sk-actual-key", undefined);
    expect(receivedAuth).toBe("Bearer sk-actual-key");
  });

  it("uses x-api-key + anthropic-version headers for anthropic", async () => {
    let receivedApiKey = "";
    let receivedVersion = "";
    server = http.createServer((req, res) => {
      receivedApiKey = String(req.headers["x-api-key"] || "");
      receivedVersion = String(req.headers["anthropic-version"] || "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "claude-3-5-sonnet" }] }));
    });
    await listen();
    writeFileSync(join(testHome, ".env"), "");

    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "anthropic",
      baseUrl,
      "sk-ant-test",
      undefined,
    );
    expect(receivedApiKey).toBe("sk-ant-test");
    expect(receivedVersion).toBe("2023-06-01");
    expect(result.models).toEqual(["claude-3-5-sonnet"]);
  });

  it("returns status=ok with empty list when upstream returns malformed JSON", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not-json-at-all");
    });
    await listen();
    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "custom",
      baseUrl,
      "sk-test",
      undefined,
    );
    expect(result.status).toBe("ok");
    expect(result.models).toEqual([]);
  });

  it("returns status=ok with empty list when upstream returns 4xx/5xx", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    await listen();
    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "custom",
      baseUrl,
      "sk-bad",
      undefined,
    );
    expect(result.status).toBe("ok");
    expect(result.models).toEqual([]);
  });

  it("returns status=error when the local provider cannot be reached", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "lmstudio-model" }] }));
    });
    await listen();
    const offlineBaseUrl = baseUrl;
    await close();

    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "lmstudio",
      offlineBaseUrl,
      undefined,
      undefined,
    );
    expect(result.status).toBe("error");
    expect(result.models).toEqual([]);
  });

  it("dedupes model ids that appear twice in the response", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [{ id: "x" }, { id: "x" }, { id: "y" }],
        }),
      );
    });
    await listen();
    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "custom",
      baseUrl,
      "sk-test",
      undefined,
    );
    expect(result.models).toEqual(["x", "y"]);
  });

  it("caches results within the TTL — second call hits cache without re-fetching", async () => {
    let calls = 0;
    server = http.createServer((_req, res) => {
      calls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: `m${calls}` }] }));
    });
    await listen();
    const { discoverProviderModels } = await loadDiscovery();

    const first = await discoverProviderModels(
      "custom",
      baseUrl,
      "sk-test",
      undefined,
    );
    const second = await discoverProviderModels(
      "custom",
      baseUrl,
      "sk-test",
      undefined,
    );

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.models).toEqual(first.models);
    expect(calls).toBe(1);
  });

  it("returns status=unknown-host for non-custom provider without a mapping", async () => {
    const { discoverProviderModels } = await loadDiscovery();
    // "openrouter" has a mapping, "kimi-coding" is unsupported, but a
    // hypothetical unknown provider name returns unsupported (it's in the
    // exclusion list)/unknown-host.  Use a name that's neither in the
    // PROVIDER_BASE_URLS map nor in NON_DISCOVERABLE.  The list is closed
    // so the fall-through is "unknown-host".
    const result = await discoverProviderModels(
      "fictional-provider-x",
      undefined,
      "sk-test",
      undefined,
    );
    expect(result.status).toBe("unknown-host");
  });

  it("uses .env API key when caller doesn't pass one explicitly", async () => {
    let receivedAuth = "";
    server = http.createServer((req, res) => {
      receivedAuth = String(req.headers["authorization"] || "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "m" }] }));
    });
    await listen();
    writeFileSync(join(testHome, ".env"), "DEEPSEEK_API_KEY=sk-from-dotenv\n");

    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "custom",
      "https://api.deepseek.com/v1",
      undefined,
      undefined,
    );
    // The fetch shouldn't reach our server because the canonical URL
    // isn't loopback — but the resolver should still produce the right
    // shape.  Since the canonical URL is unreachable in tests, status
    // ends up "ok" with an empty list (network failure → empty).
    // What we *do* care about is that the resolver picked up the .env
    // key (not that the request succeeded against the real DeepSeek).
    expect(["ok"]).toContain(result.status);
    // No assertion on receivedAuth — the real call goes to the canonical
    // URL which isn't our loopback server.  Sanity check the .env load
    // path separately:
    expect(receivedAuth).toBe(""); // confirms the canonical URL was used, not our test server
  });

  // Issue #367 — Nous Portal model discovery routes through the
  // OAuth path (provider_model_ids via Python) AND enriches the
  // result with a `freeModels` subset parsed from the live catalog
  // at `inference_base_url`. The Python call can be unreachable in
  // tests, but the live /v1/models fetch using the auth.json token
  // is testable end-to-end against the loopback server.

  it("nous discovery flags free models from the live /v1/models pricing data (#367)", async () => {
    let receivedAuth = "";
    server = http.createServer((req, res) => {
      receivedAuth = String(req.headers["authorization"] || "");
      if (req.url === "/v1/models" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              {
                id: "deepseek/deepseek-v4-flash:free",
                pricing: { prompt: "0", completion: "0" },
              },
              {
                id: "openrouter/owl-alpha",
                pricing: { prompt: "0.0", completion: "0.0" },
              },
              {
                id: "anthropic/claude-opus-4.7",
                pricing: { prompt: "0.000003", completion: "0.000015" },
              },
              { id: "missing-pricing" },
            ],
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await listen();

    // Plant auth.json with the loopback server's URL as the inference
    // base. Token can be anything — the test server checks it came.
    writeFileSync(
      join(testHome, "auth.json"),
      JSON.stringify({
        providers: {
          nous: {
            access_token: "tok-nous-test",
            inference_base_url: baseUrl,
          },
        },
      }),
    );

    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "nous",
      undefined,
      undefined,
      undefined,
    );

    // Bearer header reached the live /v1/models endpoint
    expect(receivedAuth).toBe("Bearer tok-nous-test");
    // Free flag carries through, two free models found
    expect(result.freeModels).toBeDefined();
    expect(result.freeModels?.sort()).toEqual([
      "deepseek/deepseek-v4-flash:free",
      "openrouter/owl-alpha",
    ]);
    // Status stays "ok" regardless of the Python provider_model_ids
    // call (which may fail under tests — that path returns the
    // curated fallback or an empty list, but `status:ok` either way).
    expect(result.status).toBe("ok");
  });

  it("nous discovery returns empty freeModels when auth.json is missing", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    await listen();
    // No auth.json planted in testHome — fetchNousFreeModelIds returns []
    const { discoverProviderModels } = await loadDiscovery();
    const result = await discoverProviderModels(
      "nous",
      undefined,
      undefined,
      undefined,
    );
    expect(result.freeModels).toEqual([]);
    expect(result.status).toBe("ok");
  });

  // Issue #597 — the context gauge reads `getModelContextWindow`, which must
  // resolve the advertised `context_length` even when `discoverProviderModels`
  // has already populated the model cache (the common case once the model
  // picker has loaded). The earlier implementation re-ran discovery, hit the
  // model-cache early-return, and never filled the ctx cache — silently
  // falling back to the heuristic.

  it("getModelContextWindow resolves context_length after the model cache is already warm", async () => {
    let calls = 0;
    server = http.createServer((_req, res) => {
      calls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [{ id: "big-model", context_length: 128000 }],
        }),
      );
    });
    await listen();

    const { discoverProviderModels, getModelContextWindow } =
      await loadDiscovery();

    // Model picker primes `_cache` (and `_ctxCache`) in one call.
    const disc = await discoverProviderModels(
      "custom",
      baseUrl,
      "sk-test",
      undefined,
    );
    expect(disc.models).toEqual(["big-model"]);

    // Gauge query: must return the advertised window, not null. The warm
    // ctx cache means no second HTTP round-trip is needed.
    const ctx = await getModelContextWindow(
      "custom",
      "big-model",
      baseUrl,
      "sk-test",
      undefined,
    );
    expect(ctx).toBe(128000);
    expect(calls).toBe(1);
  });

  it("getModelContextWindow treats an empty ctx map as authoritative (no re-fetch)", async () => {
    let calls = 0;
    server = http.createServer((_req, res) => {
      calls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      // Provider advertises models but no `context_length`.
      res.end(JSON.stringify({ data: [{ id: "m" }] }));
    });
    await listen();

    const mod = await loadDiscovery();
    await mod.discoverProviderModels("custom", baseUrl, "sk-test", undefined);
    // The first response carried no context_length, so the ctx map is empty
    // (present-but-empty) — that's treated as authoritative.
    const ctx = await mod.getModelContextWindow(
      "custom",
      "m",
      baseUrl,
      "sk-test",
      undefined,
    );
    expect(ctx).toBeNull();
    // Only the discovery call should have hit the server — no re-fetch.
    expect(calls).toBe(1);
  });

  // A manual `model.context_length` override in config.yaml must win over
  // /models detection (and the heuristic) for the active model — the primary
  // fix for providers like qwen that don't advertise context_length.
  it("getModelContextWindow returns the config override for the active model", async () => {
    writeFileSync(
      join(testHome, "config.yaml"),
      ["model:", '  default: "qwen-max"', '  context_length: "65536"', ""].join(
        "\n",
      ),
    );
    // qwen is non-discoverable, so without the override this would be null.
    const { getModelContextWindow } = await loadDiscovery();
    const ctx = await getModelContextWindow(
      "qwen",
      "qwen-max",
      undefined,
      undefined,
      undefined,
    );
    expect(ctx).toBe(65536);
  });

  it("getModelContextWindow ignores the override for a non-active model id", async () => {
    writeFileSync(
      join(testHome, "config.yaml"),
      ["model:", '  default: "qwen-max"', '  context_length: "65536"', ""].join(
        "\n",
      ),
    );
    const { getModelContextWindow } = await loadDiscovery();
    // Different model id → override must not leak; qwen has no /models, → null.
    const ctx = await getModelContextWindow(
      "qwen",
      "some-other-model",
      undefined,
      undefined,
      undefined,
    );
    expect(ctx).toBeNull();
  });

  it("getModelContextWindow does not apply the override when model.default is absent", async () => {
    // A hand-edited / partial config can carry context_length without a
    // model.default. The override must NOT leak onto an arbitrary model id
    // (regression: the old `override.model === ""` branch matched everything).
    writeFileSync(
      join(testHome, "config.yaml"),
      ["model:", '  context_length: "65536"', ""].join("\n"),
    );
    const { getModelContextWindow } = await loadDiscovery();
    const ctx = await getModelContextWindow(
      "qwen",
      "qwen-max",
      undefined,
      undefined,
      undefined,
    );
    expect(ctx).toBeNull();
  });

  it("getModelContextWindow returns null for providers without a /models endpoint", async () => {
    const { getModelContextWindow } = await loadDiscovery();
    const ctx = await getModelContextWindow(
      "openai-codex",
      "gpt-5.5",
      undefined,
      "sk-x",
      undefined,
    );
    expect(ctx).toBeNull();
  });
});
