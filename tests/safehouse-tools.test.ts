import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import {
  askSafeHouseToolBridge,
  callSafeHouseTool,
  getSafeHouseToolBridgeHealth,
  isLoopbackBridgeUrl,
  listSafeHouseTools,
  redactSafeHouseBridgeValue,
  resolveSafeHouseBridgeUrl,
  routeSafeHousePrompt,
  formatSafeHouseToolResponse,
} from "../src/main/safehouse-tools";

const servers: http.Server[] = [];

async function startMockBridge(): Promise<{
  url: string;
  calls: Array<{ url: string; body: unknown }>;
}> {
  const calls: Array<{ url: string; body: unknown }> = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/health") {
      res.end(
        JSON.stringify({
          ok: true,
          service: "safehouse-hermes-tool-bridge",
          mode: "local_proof",
          tools_count: 2,
          mutations_blocked: true,
          direct_db_access: false,
          service_role_key_required: false,
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/tools") {
      res.end(
        JSON.stringify({
          name: "safehouse-signal-admin-tools",
          version: "test",
          tools: [
            {
              name: "safehouse.platform.status",
              description: "Platform status",
              classification: "read_only",
              risk_level: "read_only",
              approval_required: false,
              action: "platform_status",
            },
            {
              name: "safehouse.block.migration",
              description: "Block migration",
              classification: "blocked",
              risk_level: "blocked",
              approval_required: true,
              action: "migration",
            },
          ],
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/tools/call") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      calls.push({ url: req.url, body });
      const blocked = body.tool === "safehouse.block.migration";
      res.end(
        JSON.stringify({
          ok: true,
          tool: body.tool,
          action: blocked ? "migration" : "platform_status",
          classification: blocked ? "blocked" : "read_only",
          source: blocked ? "policy_block" : "local_proof",
          status: blocked ? "blocked" : "completed",
          result: {
            summary: blocked
              ? "Migration is blocked by policy."
              : "Platform status is available.",
            status: blocked ? "blocked" : "unknown",
            key_findings: ["Bridge call reached SafeHouse mock."],
            risks: ["No mutation was performed."],
            recommended_next_actions: ["Keep using approved tools."],
            runtime_notes: ["test bridge"],
          },
          mutation_performed: false,
          strict_json: true,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock server did not bind");
  }
  return { url: `http://127.0.0.1:${address.port}`, calls };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("SafeHouse Tool Bridge client", () => {
  it("accepts loopback bridge URLs and rejects non-local URLs", () => {
    expect(isLoopbackBridgeUrl("http://127.0.0.1:57109")).toBe(true);
    expect(isLoopbackBridgeUrl("http://localhost:57109")).toBe(true);
    expect(isLoopbackBridgeUrl("https://example.com/tools")).toBe(false);
    expect(() =>
      resolveSafeHouseBridgeUrl("https://example.com/tools"),
    ).toThrow(/loopback/);
  });

  it("loads bridge health and tool manifest", async () => {
    const bridge = await startMockBridge();
    const health = await getSafeHouseToolBridgeHealth(bridge.url);
    const manifest = await listSafeHouseTools(bridge.url);

    expect(health.ok).toBe(true);
    expect(health.bridge_url).toBe(bridge.url);
    expect(health.mutations_blocked).toBe(true);
    expect(manifest.tools).toHaveLength(2);
  });

  it("calls read-only tools without leaking secrets", async () => {
    const bridge = await startMockBridge();
    const result = await callSafeHouseTool(
      "safehouse.platform.status",
      {
        prompt: "Summarize platform health",
        token: "sk-test-secret",
      },
      bridge.url,
    );

    expect(result.ok).toBe(true);
    expect(result.classification).toBe("read_only");
    expect(result.mutation_performed).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
    expect(JSON.stringify(bridge.calls[0].body)).not.toContain(
      "sk-test-secret",
    );
  });

  it("routes plain-English SafeHouse prompts to approved tools", () => {
    expect(
      routeSafeHousePrompt("Summarize SafeHouse platform health")?.tool,
    ).toBe("safehouse.platform.status");
    expect(routeSafeHousePrompt("Check API usage")?.tool).toBe(
      "safehouse.api.usage.summary",
    );
    expect(
      routeSafeHousePrompt("Can you replay failed queue items?")?.tool,
    ).toBe("safehouse.propose.queue.retry");
    expect(routeSafeHousePrompt("Can you run a migration?")?.tool).toBe(
      "safehouse.block.migration",
    );
    expect(routeSafeHousePrompt("write a poem")).toBeNull();
  });

  it("returns display markdown for routed bridge prompts", async () => {
    const bridge = await startMockBridge();
    const result = await askSafeHouseToolBridge(
      "Summarize SafeHouse platform health",
      bridge.url,
    );

    expect(result.matched).toBe(true);
    expect(result.response?.mutation_performed).toBe(false);
    expect(result.markdown).toContain("SafeHouse Tool Result");
    expect(result.markdown).toContain("Mutation performed: no");
  });

  it("renders live gateway-backed run output instead of the bridge envelope", () => {
    const markdown = formatSafeHouseToolResponse(
      {
        tool: "safehouse.platform.status",
        action: "platform_status",
        classification: "read_only",
        reason: "test",
      },
      {
        ok: true,
        tool: "safehouse.platform.status",
        action: "platform_status",
        classification: "read_only",
        source: "safehouse_agent_runtime_gateway",
        status: "completed",
        result: {
          ok: true,
          status: "completed",
          gateway: {
            data: {
              run: {
                run_id: "run-123",
                runtime: "hermes",
                schema_valid: true,
                output: {
                  summary: "Live platform summary.",
                  status: "degraded",
                  key_findings: ["Gateway output rendered."],
                  risks: ["Provider can be unavailable."],
                  recommended_next_actions: ["Keep fallback available."],
                  runtime_notes: ["No mutation."],
                },
                provider_truth: {
                  provider_mode: "real_hermes_model",
                },
              },
            },
          },
        },
      },
    );

    expect(markdown).toContain("Live platform summary.");
    expect(markdown).toContain("Run ID: `run-123`");
    expect(markdown).toContain("Runtime: hermes");
    expect(markdown).toContain("Provider mode: real_hermes_model");
    expect(markdown).toContain("Strict JSON: yes");
    expect(markdown).not.toContain("No summary returned");
  });

  it("renders blocked tool responses as policy-blocked with no mutation", async () => {
    const bridge = await startMockBridge();
    const result = await askSafeHouseToolBridge(
      "Can you run a migration?",
      bridge.url,
    );

    expect(result.matched).toBe(true);
    expect(result.route?.classification).toBe("blocked");
    expect(result.response?.classification).toBe("blocked");
    expect(result.response?.mutation_performed).toBe(false);
    expect(result.markdown).toContain("Blocked by policy");
  });

  it("redacts secret-like fields from bridge values", () => {
    expect(
      redactSafeHouseBridgeValue({
        authorization: "Bearer abc123",
        nested: { api_key: "sk-test-secret" },
      }),
    ).toEqual({
      authorization: "[redacted]",
      nested: { api_key: "[redacted]" },
    });
  });
});
