import { describe, expect, it } from "vitest";
import {
  adapterPortFromWsUrl,
  buildOfficeEnv,
  buildOfficeSettings,
  writeOfficeFileIfChanged,
} from "../src/main/claw3d";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
    expect(env).toContain("CLAW3D_GATEWAY_ADAPTER_TYPE=hermes");
    expect(env).toContain("HERMES_API_KEY=secret-key-123");
  });

  it("derives the adapter port from the configured WebSocket URL", () => {
    const env = buildOfficeEnv({
      port: 5179,
      url: "ws://localhost:19777",
      apiKey: "",
      model: "hermes",
    });
    expect(env).toContain("HERMES_ADAPTER_PORT=19777");
    expect(env).not.toContain("HERMES_ADAPTER_PORT=18789");
  });

  it("emits empty token/key fields when the gateway has no API_SERVER_KEY", () => {
    const env = buildOfficeEnv({
      port: 5179,
      url: "ws://x",
      apiKey: "",
      model: "hermes",
    });
    expect(env).toContain("CLAW3D_GATEWAY_TOKEN=");
    expect(env).toContain("CLAW3D_GATEWAY_ADAPTER_TYPE=hermes");
    expect(env).toContain("HERMES_API_KEY=");
  });
});

describe("adapterPortFromWsUrl", () => {
  it("uses the URL port when present", () => {
    expect(adapterPortFromWsUrl("ws://localhost:19777")).toBe(19777);
  });

  it("falls back to a Windows-safe default when the URL has no usable port", () => {
    expect(adapterPortFromWsUrl("ws://localhost")).toBe(18989);
    expect(adapterPortFromWsUrl("not a url")).toBe(18989);
  });
});

describe("buildOfficeSettings", () => {
  it("writes the modern Hermes gateway settings shape", () => {
    const settings = buildOfficeSettings(
      {},
      { url: "ws://localhost:18789", apiKey: "key-123" },
    );

    expect(settings).toMatchObject({
      adapter: "hermes",
      url: "ws://localhost:18789",
      token: "key-123",
      gateway: {
        url: "ws://localhost:18789",
        token: "key-123",
        adapterType: "hermes",
        profiles: {
          hermes: {
            url: "ws://localhost:18789",
            token: "key-123",
          },
        },
      },
    });
  });

  it("preserves unrelated settings and existing gateway metadata", () => {
    const settings = buildOfficeSettings(
      {
        theme: "dark",
        gateway: {
          lastKnownGood: {
            url: "ws://old",
            adapterType: "openclaw",
          },
          profiles: {
            demo: {
              url: "ws://demo",
              token: "",
            },
          },
          reconnect: true,
        },
      },
      { url: "ws://localhost:18789", apiKey: "key-123" },
    );

    expect(settings).toMatchObject({
      theme: "dark",
      gateway: {
        url: "ws://localhost:18789",
        token: "key-123",
        adapterType: "hermes",
        reconnect: true,
        profiles: {
          demo: {
            url: "ws://demo",
            token: "",
          },
          hermes: {
            url: "ws://localhost:18789",
            token: "key-123",
          },
        },
        lastKnownGood: {
          url: "ws://localhost:18789",
          token: "key-123",
          adapterType: "hermes",
        },
      },
    });
  });

  it("refreshes stale lastKnownGood so Office can auto-connect", () => {
    const settings = buildOfficeSettings(
      {
        gateway: {
          url: "ws://old",
          token: "old-token",
          adapterType: "openclaw",
          lastKnownGood: {
            url: "ws://old",
            token: "old-token",
            adapterType: "openclaw",
          },
        },
      },
      { url: "ws://localhost:18789", apiKey: "key-123" },
    );

    expect(settings.gateway).toMatchObject({
      url: "ws://localhost:18789",
      token: "key-123",
      adapterType: "hermes",
      profiles: {
        hermes: {
          url: "ws://localhost:18789",
          token: "key-123",
        },
      },
      lastKnownGood: {
        url: "ws://localhost:18789",
        token: "key-123",
        adapterType: "hermes",
      },
    });
  });

  it("keeps legacy top-level fields for older Office builds and rollback", () => {
    const settings = buildOfficeSettings(
      {
        adapter: "openclaw",
        url: "ws://old",
        token: "old-token",
      },
      { url: "ws://localhost:18789", apiKey: "" },
    );

    expect(settings.adapter).toBe("hermes");
    expect(settings.url).toBe("ws://localhost:18789");
    expect(settings.token).toBe("");
  });

  it("refreshes a stale Hermes adapter profile so Office does not reconnect to an old port", () => {
    const settings = buildOfficeSettings(
      {
        gateway: {
          adapterType: "hermes",
          profiles: {
            hermes: {
              url: "ws://localhost:18789",
              token: "",
            },
            openclaw: {
              url: "ws://openclaw",
              token: "openclaw-token",
            },
          },
        },
      },
      { url: "ws://localhost:18989", apiKey: "key-123" },
    );

    expect(settings.gateway).toMatchObject({
      profiles: {
        hermes: {
          url: "ws://localhost:18989",
          token: "key-123",
        },
        openclaw: {
          url: "ws://openclaw",
          token: "openclaw-token",
        },
      },
    });
  });
});

describe("writeOfficeFileIfChanged", () => {
  it("skips identical writes so Office status polling does not churn mtimes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-office-write-"));
    try {
      const file = join(dir, ".env");
      writeFileSync(file, "PORT=3000\n", "utf-8");
      const before = statSync(file).mtimeMs;

      const wrote = writeOfficeFileIfChanged(file, "PORT=3000\n");

      expect(wrote).toBe(false);
      expect(readFileSync(file, "utf-8")).toBe("PORT=3000\n");
      expect(statSync(file).mtimeMs).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes when Office settings content changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-office-write-"));
    try {
      const file = join(dir, "settings.json");
      writeFileSync(file, '{"adapter":"openclaw"}', "utf-8");

      const wrote = writeOfficeFileIfChanged(file, '{"adapter":"hermes"}');

      expect(wrote).toBe(true);
      expect(readFileSync(file, "utf-8")).toBe('{"adapter":"hermes"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
