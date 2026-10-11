import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, connection } = vi.hoisted(() => ({
  request: vi.fn(),
  connection: {
    current: {
      mode: "remote",
      remoteUrl: "http://r:9119",
      remoteAuthMode: "oauth",
      apiKey: "",
    },
  },
}));

vi.mock("./hermes", () => ({
  getApiUrl: () => "http://r:9119",
  getRemoteAuthHeader: () => ({}),
  isRemoteMode: () => true,
}));
vi.mock("./config", () => ({
  getConnectionConfig: () => connection.current,
}));
vi.mock("./utils", () => ({
  profilePaths: () => ({ configFile: "config.yaml" }),
  safeWriteFile: vi.fn(),
}));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: request }));

import { listMcpServers, listMcpCatalog } from "./mcp-servers";

describe("remote MCP requests", () => {
  beforeEach(() => {
    request.mockReset();
    connection.current.remoteAuthMode = "oauth";
  });

  it("lists servers through the authenticated dashboard boundary, not a bare fetch", async () => {
    const bare = vi.fn();
    vi.stubGlobal("fetch", bare);
    request.mockResolvedValue({
      servers: [{ name: "linear", url: "https://x", enabled: true }],
    });
    const servers = await listMcpServers("work");
    expect(servers.map((s) => s.name)).toEqual(["linear"]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "remote" }),
      "/api/mcp/servers",
      { method: "GET", body: undefined },
      "work",
    );
    expect(bare).not.toHaveBeenCalled();
  });

  it("propagates an auth failure instead of showing an empty list", async () => {
    request.mockImplementation(async () => {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    });
    await expect(listMcpServers()).rejects.toThrow("Unauthorized");
  });

  it("keeps the 404 status so a server without the catalog is reported as unsupported", async () => {
    request.mockImplementation(async () => {
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    });
    const res = await listMcpCatalog();
    expect(JSON.stringify(res)).toMatch(/not available|catalog/i);
  });

  // @lat: [[remote-dashboard-oauth#Test specifications#Anonymous MCP compatibility]]
  it("preserves named-profile MCP access to an explicitly keyless token dashboard", async () => {
    connection.current.remoteAuthMode = "token";
    const bare = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ servers: [{ name: "linear", url: "https://x" }] }),
        ),
      );
    vi.stubGlobal("fetch", bare);

    expect((await listMcpServers("work")).map((server) => server.name)).toEqual(
      ["linear"],
    );
    expect(bare).toHaveBeenCalledWith(
      "http://r:9119/api/mcp/servers?profile=work",
      expect.objectContaining({ headers: {} }),
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("retains anonymous access when auto authentication resolves to a keyless token dashboard", async () => {
    connection.current.remoteAuthMode = "auto";
    request.mockRejectedValue(
      new Error("Remote Hermes dashboard token is not configured."),
    );
    const bare = vi.fn().mockResolvedValue(new Response('{"servers":[]}'));
    vi.stubGlobal("fetch", bare);

    await expect(listMcpServers("work")).resolves.toEqual([]);
    expect(bare).toHaveBeenCalledWith(
      "http://r:9119/api/mcp/servers?profile=work",
      expect.anything(),
    );
  });
});
