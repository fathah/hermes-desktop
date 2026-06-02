import { describe, expect, it } from "vitest";
import { createServer, type Server } from "net";
import {
  buildOfficeEnv,
  findAvailableAdapterPort,
  resolveLocalAdapterPortFromWsUrl,
} from "../src/main/claw3d";

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// Hermes Desktop writes the hermes-office `.env`. It used to hardcode
// `HERMES_MODEL=hermes`, so Office ignored the user's configured model
// (issue #256). The model is now passed through.
describe("buildOfficeEnv (issue #256)", () => {
  it("writes the configured model into HERMES_MODEL", () => {
    const env = buildOfficeEnv({
      port: 5179,
      url: "ws://127.0.0.1:8642",
      apiKey: "",
      model: "grok-4.3",
    });
    expect(env).toContain("HERMES_MODEL=grok-4.3");
    expect(env).not.toContain("HERMES_MODEL=hermes");
  });

  it("falls back to `hermes` when no model is configured", () => {
    const env = buildOfficeEnv({
      port: 5179,
      url: "ws://x",
      apiKey: "",
      model: "",
    });
    expect(env).toContain("HERMES_MODEL=hermes");
  });

  it("carries the port and gateway URL through", () => {
    const env = buildOfficeEnv({
      port: 1234,
      url: "ws://gw.test",
      apiKey: "",
      model: "m",
    });
    expect(env).toContain("PORT=1234");
    expect(env).toContain("NEXT_PUBLIC_GATEWAY_URL=ws://gw.test");
    expect(env).toContain("CLAW3D_GATEWAY_URL=ws://gw.test");
  });

  it("threads the gateway API key into CLAW3D_GATEWAY_TOKEN and HERMES_API_KEY (#297)", () => {
    const env = buildOfficeEnv({
      port: 5179,
      url: "ws://x",
      apiKey: "secret-key-123",
      model: "hermes",
    });
    expect(env).toContain("CLAW3D_GATEWAY_TOKEN=secret-key-123");
    expect(env).toContain("HERMES_API_KEY=secret-key-123");
  });

  it("emits empty token/key fields when the gateway has no API_SERVER_KEY", () => {
    const env = buildOfficeEnv({
      port: 5179,
      url: "ws://x",
      apiKey: "",
      model: "hermes",
    });
    expect(env).toContain("CLAW3D_GATEWAY_TOKEN=");
    expect(env).toContain("HERMES_API_KEY=");
  });

  it("writes the selected Hermes adapter port", () => {
    const env = buildOfficeEnv({
      port: 5179,
      url: "ws://localhost:19444",
      apiKey: "",
      model: "hermes",
      adapterPort: 19444,
    });
    expect(env).toContain("HERMES_ADAPTER_PORT=19444");
  });

  it("extracts local adapter ports from localhost WebSocket URLs only", () => {
    expect(resolveLocalAdapterPortFromWsUrl("ws://localhost:19444")).toBe(
      19444,
    );
    expect(resolveLocalAdapterPortFromWsUrl("ws://127.0.0.1:19445")).toBe(
      19445,
    );
    expect(resolveLocalAdapterPortFromWsUrl("ws://[::1]:19446")).toBe(19446);
    expect(resolveLocalAdapterPortFromWsUrl("ws://gateway.example:19444")).toBe(
      null,
    );
  });

  it("skips an occupied adapter port", async () => {
    const server = createServer();
    await listen(server, 0);
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address");
      }

      const port = await findAvailableAdapterPort(address.port);
      expect(port).toBeGreaterThan(address.port);
    } finally {
      await close(server);
    }
  });
});
