import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { ConnectionConfig } from "./config";

const state = vi.hoisted(() => ({
  connection: {} as ConnectionConfig,
  request: vi.fn(),
  getConnection: vi.fn(),
  probe: vi.fn(),
}));
vi.mock("./config", () => ({
  getConnectionConfig: (...args: unknown[]) => state.getConnection(...args),
}));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: state.request }));
vi.mock("./remote-oauth", () => ({ probeRemoteAuthMode: state.probe }));
import {
  providerTargetRevision,
  beginProviderAuthChange,
  finishProviderAuthChange,
} from "./provider-request-target";
import {
  discoverModelsRemote,
  remoteAddCredentialPoolEntry,
  remoteGetCredentialPool,
  remoteGetEnv,
  remoteSetCredentialPool,
  remoteSetEnv,
  resetRemoteProvidersState,
} from "./remote-providers";

function connection(
  url = "http://a:9119",
  apiKey = "account-a",
): ConnectionConfig {
  return {
    mode: "remote",
    remoteUrl: url,
    apiKey,
    remoteAuthMode: "token",
    remoteChatTransport: "dashboard",
    sshChatTransport: "auto",
    ssh: {} as ConnectionConfig["ssh"],
  };
}
const POOL = {
  providers: [
    {
      provider: "openai",
      entries: [
        { id: "a1", label: "A", token_preview: "sk-a…1111" },
        { id: "a2", label: "B", token_preview: "sk-a…2222" },
      ],
    },
  ],
};
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Compile the registered callback and its routing helper from actual source.
function ipcHandler(
  name: string,
  dependencies: Record<string, unknown>,
): (...args: unknown[]) => unknown {
  const source = readFileSync(
    resolve(process.cwd(), "src/main/ipc/register.ts"),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "register.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let handler: ts.Expression | undefined;
  let routing: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "providerConnection"
    )
      routing = node;
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "ipcMain.handle" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === name
    )
      handler = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!handler || !routing) throw new Error(`Missing actual handler ${name}`);
  const code = ts.transpileModule(
    `${routing.getText(ast)}\nconst handler = ${handler.getText(ast)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  dependencies = { providerTargetRevision, ...dependencies };
  return new Function(...Object.keys(dependencies), `${code};return handler;`)(
    ...Object.values(dependencies),
  );
}

describe("Remote provider target ownership", () => {
  beforeEach(() => {
    state.connection = connection();
    state.request.mockReset();
    state.getConnection.mockReset().mockImplementation(() => state.connection);
    resetRemoteProvidersState();
    state.probe.mockReset().mockResolvedValue({ authMode: "token" });
  });

  it("issues an opaque explicit-connection target without credentials and rejects implicit issuance", () => {
    const issue = ipcHandler("get-provider-request-target", {
      getConnectionConfig: state.getConnection,
    });
    expect(() => issue(null, undefined)).toThrow(
      "explicit provider connection",
    );
    const target = issue(null, "A") as Record<string, unknown>;
    expect(target).toEqual({
      connectionId: "A",
      mode: "remote",
      remoteUrl: "http://a:9119",
      revision: expect.any(String),
    });
    expect(JSON.stringify(target)).not.toContain("account-a");
    state.connection.apiKey = "account-b";
    expect((issue(null, "A") as Record<string, unknown>).revision).not.toBe(
      target.revision,
    );
  });

  it("returns only set redacted env values and explicitly scopes default", async () => {
    state.request.mockResolvedValue({
      OPENAI_API_KEY: { is_set: true, redacted_value: "sk-…a" },
      GROQ_API_KEY: { is_set: false },
    });
    expect(await remoteGetEnv()).toEqual({ OPENAI_API_KEY: "sk-…a" });
    expect(state.request.mock.calls[0][1]).toBe("/api/env?profile=default");
  });

  // @lat: [[remote-providers#Remote Providers#Late preview ownership]]
  it("keeps an A env reply under A even after the selected server and token account change", async () => {
    const reply = deferred<Record<string, unknown>>();
    state.request.mockReturnValueOnce(reply.promise);
    const pending = remoteGetEnv("work");
    state.connection = connection("http://b:9119", "account-b");
    reply.resolve({
      OPENAI_API_KEY: { is_set: true, redacted_value: "sk-…a" },
    });
    await pending;
    state.connection = connection();
    state.request.mockClear();
    await remoteSetEnv("OPENAI_API_KEY", "sk-…a", "work");
    expect(state.request).not.toHaveBeenCalled();
  });

  it("separates preview ownership for equal URLs with distinct token accounts", async () => {
    state.request.mockResolvedValue({
      OPENAI_API_KEY: { is_set: true, redacted_value: "sk-…a" },
    });
    await remoteGetEnv();
    state.connection = connection("http://a:9119", "account-b");
    state.request.mockClear().mockResolvedValue({});
    await remoteSetEnv("OPENAI_API_KEY", "new-key");
    expect(state.request.mock.calls[0][0].apiKey).toBe("account-b");
  });

  it("captures a copy of connection data before an awaited key write", async () => {
    const reply = deferred<unknown>();
    state.request.mockReturnValue(reply.promise);
    const pending = remoteSetEnv("OPENAI_API_KEY", "new-key", "work");
    state.connection.remoteUrl = "http://b:9119";
    state.connection.apiKey = "account-b";
    reply.resolve({});
    await pending;
    expect(state.request.mock.calls[0][0]).toMatchObject({
      remoteUrl: "http://a:9119",
      apiKey: "account-a",
    });
    expect(state.request.mock.calls[0][1]).toBe("/api/env?profile=work");
  });

  it("uses PUT for a new key and DELETE for clearing; unset404 is already cleared", async () => {
    state.request.mockResolvedValue({});
    await remoteSetEnv("OPENAI_API_KEY", "new-key");
    state.request.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );
    expect(await remoteSetEnv("OPENAI_API_KEY", "")).toBe(true);
    expect(state.request.mock.calls.map((call) => call[2].method)).toEqual([
      "PUT",
      "DELETE",
    ]);
  });

  it("fails closed on Remote auth/read errors", async () => {
    state.request.mockRejectedValue(new Error("OAuth login required"));
    await expect(remoteGetEnv()).rejects.toThrow("OAuth");
  });
  it("returns redacted pool entries", async () => {
    state.request.mockResolvedValue(POOL);
    expect((await remoteGetCredentialPool()).openai[0]).toMatchObject({
      id: "a1",
      access_token: "sk-a…1111",
    });
  });

  // @lat: [[remote-providers#Remote Providers#Pool add retains original target]]
  it("retains A connection and profile across POST and refresh after switching to B", async () => {
    const admitted = deferred<unknown>();
    state.request
      .mockReturnValueOnce(admitted.promise)
      .mockResolvedValueOnce(POOL);
    const pending = remoteAddCredentialPoolEntry(
      "openai",
      "new-key",
      "label",
      "default",
    );
    state.connection = connection("http://b:9119", "account-b");
    admitted.resolve({ ok: true });
    expect(await pending).toHaveLength(2);
    expect(state.request.mock.calls.map((call) => call[0].remoteUrl)).toEqual([
      "http://a:9119",
      "http://a:9119",
    ]);
    expect(state.request.mock.calls.map((call) => call[1])).toEqual([
      "/api/credentials/pool?profile=default",
      "/api/credentials/pool?profile=default",
    ]);
  });

  // @lat: [[remote-providers#Remote Providers#Named pool operations fail closed]]
  it("refuses named-profile pool reads and additions before HTTP because Agent ignores profile", async () => {
    await expect(remoteGetCredentialPool("work")).rejects.toThrow(
      "profile-scoped",
    );
    await expect(
      remoteAddCredentialPoolEntry("openai", "key", "label", "work"),
    ).rejects.toThrow("profile-scoped");
    expect(state.request).not.toHaveBeenCalled();
  });

  // @lat: [[remote-providers#Remote Providers#Deletion race refuses HTTP]]
  it("never dispatches index deletion even for loaded A entries after A to B selection", async () => {
    state.request.mockResolvedValue(POOL);
    await remoteGetCredentialPool();
    state.connection = connection("http://b:9119");
    state.request.mockClear();
    await expect(
      remoteSetCredentialPool("openai", [{ id: "a1" }]),
    ).rejects.toThrow("unavailable");
    expect(state.request).not.toHaveBeenCalled();
  });

  // @lat: [[remote-providers#Remote Providers#Agent owned discovery]]
  it("uses selected Agent profile catalog without invoking any desktop key or account cache", async () => {
    state.request.mockResolvedValue({
      providers: [{ slug: "openai-codex", models: ["remote-model"] }],
    });
    expect(
      await discoverModelsRemote("openai-codex", undefined, "work"),
    ).toEqual({
      models: ["remote-model"],
      status: "unsupported",
      cached: false,
    });
    expect(state.request.mock.calls[0][1]).toBe(
      "/api/model/options?profile=work",
    );
    expect(state.request.mock.calls[0][0].remoteUrl).toBe("http://a:9119");
  });

  it("does not mix catalogs from an unmatched custom endpoint", async () => {
    state.request.mockResolvedValue({
      providers: [
        { slug: "custom", api_url: "https://a.example/v1", models: ["A"] },
      ],
    });
    expect(
      (await discoverModelsRemote("custom", "https://b.example/v1")).models,
    ).toEqual([]);
  });

  // @lat: [[remote-providers#Remote Providers#Explicit IPC routing]]
  it("actual env IPC resolves explicit A while B is active and rejects changed mode or URL", async () => {
    const localRead = vi.fn();
    const selected = connection();
    const getConfig = vi.fn((id?: string) =>
      id === "A" ? selected : connection("http://b:9119"),
    );
    const handler = ipcHandler("get-env", {
      getConnectionConfig: getConfig,
      remoteGetEnv,
      readEnv: localRead,
    });
    state.request.mockResolvedValue({});
    const target = {
      connectionId: "A",
      mode: "remote",
      remoteUrl: "http://a:9119",
      revision: providerTargetRevision(selected),
    };
    await handler(undefined, "work", target);
    expect(getConfig).toHaveBeenCalledWith("A");
    expect(localRead).not.toHaveBeenCalled();
    expect(state.request.mock.calls[0][0].remoteUrl).toBe("http://a:9119");
    selected.mode = "local";
    expect(() => handler(undefined, "work", target)).toThrow("changed");
    expect(localRead).not.toHaveBeenCalled();
    selected.mode = "remote";
    selected.remoteUrl = "http://new:9119";
    expect(() => handler(undefined, "work", target)).toThrow("changed");
  });

  // @lat: [[remote-providers#Remote Providers#Stale authentication revisions are rejected]]
  it("actual env IPC refuses an old typed draft after same-ID same-URL token or auth changes", async () => {
    const selected = connection();
    const target = {
      connectionId: "A",
      mode: "remote",
      remoteUrl: selected.remoteUrl,
      revision: providerTargetRevision(selected),
    };
    const localWrite = vi.fn();
    const handler = ipcHandler("set-env", {
      getConnectionConfig: () => selected,
      remoteSetEnv,
      setEnvValue: localWrite,
    });
    selected.apiKey = "account-b";
    await expect(
      handler(undefined, "OPENAI_API_KEY", "typed-account-a", "work", target),
    ).rejects.toThrow("changed");
    selected.apiKey = "account-a";
    selected.remoteAuthMode = "oauth";
    await expect(
      handler(undefined, "OPENAI_API_KEY", "typed-account-a", "work", target),
    ).rejects.toThrow("changed");
    expect(state.request).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
  });

  it("rejects an OAuth account change during auto auth resolution before HTTP dispatch", async () => {
    state.connection.remoteAuthMode = "auto";
    const probed = deferred<{ authMode: "oauth" }>();
    state.probe.mockReturnValueOnce(probed.promise);
    const pending = remoteSetEnv("OPENAI_API_KEY", "typed-A", "work");
    beginProviderAuthChange(state.connection.remoteUrl);
    finishProviderAuthChange(state.connection.remoteUrl);
    probed.resolve({ authMode: "oauth" });
    await expect(pending).rejects.toThrow("authentication changed");
    expect(state.request).not.toHaveBeenCalled();
  });

  it("does not refresh a pool under a new OAuth account after an admitted add", async () => {
    state.connection.remoteAuthMode = "oauth";
    const admitted = deferred<unknown>();
    state.request.mockReturnValueOnce(admitted.promise);
    const pending = remoteAddCredentialPoolEntry("openai", "key-A", "A");
    beginProviderAuthChange(state.connection.remoteUrl);
    finishProviderAuthChange(state.connection.remoteUrl);
    admitted.resolve({ ok: true });
    await expect(pending).rejects.toThrow("authentication changed");
    expect(state.request).toHaveBeenCalledTimes(1);
  });

  it("actual discover IPC never invokes local discovery even with a typed key", async () => {
    const localDiscovery = vi.fn();
    const handler = ipcHandler("discover-provider-models", {
      getConnectionConfig: () => state.connection,
      discoverModelsRemote,
      discoverProviderModels: localDiscovery,
    });
    state.request.mockResolvedValue({ providers: [] });
    await handler(undefined, "openai", undefined, "typed-key", "work");
    expect(localDiscovery).not.toHaveBeenCalled();
    expect(state.request).toHaveBeenCalledTimes(1);
  });

  it("actual SSH pool add rejects before either desktop or remote mutation", () => {
    state.connection.mode = "ssh";
    const localAdd = vi.fn();
    const remoteAdd = vi.fn();
    const handler = ipcHandler("add-credential-pool-entry", {
      getConnectionConfig: () => state.connection,
      addCredentialPoolEntry: localAdd,
      remoteAddCredentialPoolEntry: remoteAdd,
    });
    expect(() =>
      handler(undefined, "openai", "ssh-key", "Work", "work"),
    ).toThrow("unavailable");
    expect(localAdd).not.toHaveBeenCalled();
    expect(remoteAdd).not.toHaveBeenCalled();
  });

  it("actual Remote writes require explicit targets and never mutate local env or pool", async () => {
    const localWrite = vi.fn();
    const handler = ipcHandler("set-env", {
      getConnectionConfig: () => state.connection,
      remoteSetEnv,
      setEnvValue: localWrite,
    });
    await expect(
      handler(undefined, "OPENAI_API_KEY", "desktop-key", "default"),
    ).rejects.toThrow("explicit connection");
    expect(localWrite).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalled();
    const poolWrite = ipcHandler("set-credential-pool", {
      getConnectionConfig: () => state.connection,
      remoteSetCredentialPool,
      setCredentialPool: localWrite,
    });
    await expect(
      poolWrite(undefined, "openai", [{ id: "a1" }], "default"),
    ).rejects.toThrow("unavailable");
    expect(localWrite).not.toHaveBeenCalled();
  });
});
