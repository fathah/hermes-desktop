import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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

  // @lat: [[connections#Legacy migration#Preserves existing configurations]]
  it.each([
    {
      mode: "local",
      legacy: { connectionMode: "local" },
      expected: { mode: "local", remoteUrl: "", apiKey: "" },
      name: "Local",
    },
    {
      mode: "remote",
      legacy: {
        connectionMode: "remote",
        remoteUrl: "https://hermes.example",
        remoteApiKey: "remote-secret",
        remoteAuthMode: "token",
        remoteChatTransport: "dashboard",
      },
      expected: {
        mode: "remote",
        remoteUrl: "https://hermes.example",
        apiKey: "remote-secret",
        remoteAuthMode: "token",
        remoteChatTransport: "dashboard",
      },
      name: "Remote",
    },
    {
      mode: "ssh",
      legacy: {
        connectionMode: "ssh",
        remoteUrl: "https://saved-remote.example",
        remoteApiKey: "saved-remote-secret",
        sshChatTransport: "legacy",
        sshConfig: {
          host: "gateway.internal",
          port: 2222,
          username: "hermes",
          keyPath: "/keys/hermes",
          remotePort: 9000,
          localPort: 19000,
          dockerContainerName: "hermes-agent",
        },
      },
      expected: {
        mode: "ssh",
        remoteUrl: "https://saved-remote.example",
        apiKey: "saved-remote-secret",
        sshChatTransport: "legacy",
        ssh: {
          host: "gateway.internal",
          port: 2222,
          username: "hermes",
          keyPath: "/keys/hermes",
          remotePort: 9000,
          localPort: 19000,
          dockerContainerName: "hermes-agent",
        },
      },
      name: "SSH",
    },
  ])(
    "migrates the existing $mode configuration",
    async ({ legacy, expected, name }) => {
      writeFileSync(
        join(testHome, "desktop.json"),
        JSON.stringify({ ...legacy, unrelatedPreference: true }),
        "utf-8",
      );
      const { getConnectionConfig, getConnectionRegistry } =
        await loadConnectionConfigModule();

      const registry = getConnectionRegistry();
      expect(registry).toMatchObject({
        version: 1,
        activeConnectionId: registry.connections[0].connectionId,
        connections: [{ name, config: expected }],
      });
      expect(getConnectionConfig()).toMatchObject(expected);

      const saved = JSON.parse(
        readFileSync(join(testHome, "desktop.json"), "utf-8"),
      );
      expect(saved.connectionRegistry).toEqual(registry);
      expect(saved.connectionMode).toBeUndefined();
      expect(saved.remoteApiKey).toBeUndefined();
      expect(saved.unrelatedPreference).toBe(true);
    },
  );

  // @lat: [[connections#Stable active identity]]
  it("keeps the active connection identity stable across updates and reloads", async () => {
    const {
      getConnectionRegistry,
      getPublicConnectionConfig,
      setConnectionConfig,
    } = await loadConnectionConfigModule();
    const initial = getPublicConnectionConfig();

    setConnectionConfig({
      ...getConnectionRegistry().connections[0].config,
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
    });

    expect(getPublicConnectionConfig()).toMatchObject({
      connectionId: initial.connectionId,
      name: "Remote",
      mode: "remote",
    });

    const reloaded = await loadConnectionConfigModule();
    expect(reloaded.getPublicConnectionConfig().connectionId).toBe(
      initial.connectionId,
    );
  });

  // @lat: [[connections#Named connection management]]
  it("creates, edits, selects, renames, and removes redacted connection records", async () => {
    const {
      createConnection,
      getConnectionConfig,
      getPublicConnectionConfig,
      getPublicConnectionRegistry,
      removeConnection,
      renameConnection,
      selectConnection,
      setConnectionConfig,
    } = await loadConnectionConfigModule();
    const initialId = getPublicConnectionRegistry().activeConnectionId;
    const created = createConnection();

    setConnectionConfig({
      ...getConnectionConfig(),
      mode: "remote",
      remoteUrl: "https://second.example",
      apiKey: "second-secret",
    });
    renameConnection(created.connectionId, "Production");

    const registry = getPublicConnectionRegistry();
    expect(registry).toMatchObject({
      version: 1,
      activeConnectionId: created.connectionId,
      connections: [
        { connectionId: initialId, name: "Local", mode: "local" },
        {
          connectionId: created.connectionId,
          name: "Production",
          mode: "remote",
          remoteUrl: "https://second.example",
          hasApiKey: true,
        },
      ],
    });
    expect(JSON.stringify(registry)).not.toContain("second-secret");
    expect(getConnectionConfig(initialId).mode).toBe("local");
    expect(getConnectionConfig(created.connectionId).apiKey).toBe(
      "second-secret",
    );
    expect(getPublicConnectionConfig(initialId)).toMatchObject({
      connectionId: initialId,
      mode: "local",
    });
    expect(() => getPublicConnectionConfig({})).toThrow(
      "Connection not found.",
    );

    selectConnection(initialId);
    expect(getPublicConnectionRegistry().activeConnectionId).toBe(initialId);
    removeConnection(created.connectionId);
    expect(getPublicConnectionRegistry().connections).toHaveLength(1);
    expect(() => removeConnection(initialId)).toThrow(
      "The last connection cannot be removed.",
    );
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
      remoteChatTransport: "dashboard",
      sshChatTransport: "auto",
      remoteAuthMode: "auto",
      ssh: getConnectionConfig().ssh,
    });

    expect(getConnectionConfig().apiKey).toBe("remote-secret");

    const publicConfig = getPublicConnectionConfig();
    expect(publicConfig).toMatchObject({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      remoteChatTransport: "dashboard",
      sshChatTransport: "auto",
      remoteAuthMode: "auto",
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

  it("reads desktop config files written with a UTF-8 BOM", async () => {
    const { getConnectionConfig } = await loadConnectionConfigModule();

    writeFileSync(
      join(testHome, "desktop.json"),
      `\uFEFF${JSON.stringify({
        connectionMode: "remote",
        remoteUrl: "https://hermes.example",
        remoteApiKey: "remote-secret",
        remoteChatTransport: "dashboard",
      })}`,
      "utf-8",
    );

    expect(getConnectionConfig()).toMatchObject({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
      remoteChatTransport: "dashboard",
    });
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
        remoteChatTransport: "auto",
        sshChatTransport: "auto",
        ssh: {
          host: "",
          port: 22,
          username: "",
          keyPath: "",
          remotePort: 8642,
          localPort: 18642,
        },
      });

      await expect(testRemoteConnection(url)).resolves.toBe(true);
      await expect(testRemoteConnection(url, "wrong-secret")).resolves.toBe(
        false,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not attach a stale token to OAuth Remote health probes", async () => {
    const { setConnectionConfig } = await loadConnectionConfigModule();
    const { testRemoteConnection } = await import("../src/main/hermes");
    const server = http.createServer((req, res) => {
      res.statusCode =
        req.url === "/api/status" && !req.headers.authorization ? 200 : 401;
      res.end();
    });

    const url = await listen(server);

    try {
      setConnectionConfig({
        mode: "remote",
        remoteUrl: url,
        apiKey: "stale-token",
        remoteAuthMode: "oauth",
        remoteChatTransport: "auto",
        sshChatTransport: "auto",
        ssh: {
          host: "",
          port: 22,
          username: "",
          keyPath: "",
          remotePort: 8642,
          localPort: 18642,
        },
      });

      await expect(testRemoteConnection(url)).resolves.toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("preserves remote settings when switching away from remote mode", async () => {
    const {
      getConnectionConfig,
      resolveConnectionApiKeyUpdate,
      setConnectionConfig,
    } = await loadConnectionConfigModule();

    const ssh = getConnectionConfig().ssh;
    setConnectionConfig({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
      remoteChatTransport: "dashboard",
      sshChatTransport: "auto",
      ssh,
    });

    setConnectionConfig({
      ...getConnectionConfig(),
      mode: "local",
      remoteUrl: "",
      apiKey: "",
    });

    expect(getConnectionConfig()).toMatchObject({
      mode: "local",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
      remoteChatTransport: "dashboard",
    });

    const localConfig = getConnectionConfig();
    const restoredApiKey = resolveConnectionApiKeyUpdate(
      localConfig,
      "remote",
      "https://hermes.example",
      undefined,
    );
    setConnectionConfig({
      ...localConfig,
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: restoredApiKey,
    });

    expect(getConnectionConfig()).toMatchObject({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
      remoteChatTransport: "dashboard",
    });
  });

  it("exposes SSH settings without exposing the stored remote API key", async () => {
    const { getPublicConnectionConfig, setConnectionConfig } =
      await loadConnectionConfigModule();

    setConnectionConfig({
      mode: "ssh",
      remoteUrl: "",
      apiKey: "remote-secret",
      remoteChatTransport: "auto",
      sshChatTransport: "legacy",
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
    expect(publicConfig.sshChatTransport).toBe("legacy");
    expect(publicConfig.ssh.host).toBe("example.internal");
    expect("apiKey" in publicConfig).toBe(false);
    expect(JSON.stringify(publicConfig)).not.toContain("remote-secret");
  });
});
