import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import http from "http";
import type { AddressInfo } from "net";

let testHome: string;

async function loadConnectionConfigModule(): Promise<
  typeof import("../src/main/config")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/config");
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe("connection config secret exposure", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-connection-config-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("keeps the remote API key out of the public renderer config", async () => {
    const {
      getConnectionConfig,
      getPublicConnectionConfig,
      resolveConnectionApiKeyUpdate,
      setConnectionConfig,
    } = await loadConnectionConfigModule();

    setConnectionConfig({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
    });

    expect(getConnectionConfig().apiKey).toBe("remote-secret");

    const publicConfig = getPublicConnectionConfig();
    expect(publicConfig).toMatchObject({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      hasApiKey: true,
      // Length is intentionally exposed so the renderer can render a
      // mask that matches the stored key's width. The secret itself
      // must NOT be present — covered by the assertions below.
      apiKeyLength: "remote-secret".length,
    });
    expect("apiKey" in publicConfig).toBe(false);
    expect(JSON.stringify(publicConfig)).not.toContain("remote-secret");

    const existing = getConnectionConfig();
    expect(
      resolveConnectionApiKeyUpdate(
        existing,
        "remote",
        "https://hermes.example",
      ),
    ).toBe("remote-secret");
    expect(
      resolveConnectionApiKeyUpdate(
        existing,
        "remote",
        "https://attacker.example",
      ),
    ).toBe("");
  });

  it("uses the stored remote API key for main-process connection tests", async () => {
    const { setConnectionConfig } = await loadConnectionConfigModule();
    const { testRemoteConnection } = await import("../src/main/hermes");
    const server = http.createServer((req, res) => {
      res.statusCode =
        req.headers.authorization === "Bearer remote-secret" ? 200 : 401;
      res.end();
    });

    const url = await listen(server);

    try {
      setConnectionConfig({
        mode: "remote",
        remoteUrl: url,
        apiKey: "remote-secret",
      });

      await expect(testRemoteConnection(url)).resolves.toBe(true);
      await expect(testRemoteConnection(url, "wrong-secret")).resolves.toBe(
        false,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("exposes SSH settings without exposing the stored remote API key", async () => {
    const { getPublicConnectionConfig, setConnectionConfig } =
      await loadConnectionConfigModule();

    setConnectionConfig({
      mode: "ssh",
      remoteUrl: "",
      apiKey: "remote-secret",
      ssh: {
        host: "example.internal",
        port: 22,
        username: "hermes",
        keyPath: "~/.ssh/id_rsa",
        remotePort: 8642,
        localPort: 18642,
      },
    });

    const publicConfig = getPublicConnectionConfig();
    expect(publicConfig.mode).toBe("ssh");
    expect(publicConfig.ssh.host).toBe("example.internal");
    expect("apiKey" in publicConfig).toBe(false);
    expect(JSON.stringify(publicConfig)).not.toContain("remote-secret");
  });
});
