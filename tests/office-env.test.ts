import { describe, expect, it } from "vitest";
import { buildOfficeEnv } from "../src/main/claw3d";

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
});
