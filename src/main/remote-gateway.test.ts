import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { RemoteGatewayActionResult } from "../shared/gateway";

const { request, state } = vi.hoisted(() => ({
  request: vi.fn(),
  state: {
    connection: {
      mode: "remote",
      remoteUrl: "http://r:9119",
      apiKey: "key",
      remoteAuthMode: "token",
    },
  },
}));
vi.mock("./config", () => ({ getConnectionConfig: () => state.connection }));
vi.mock("./hermes", () => ({
  normaliseRemoteUrl: (url: string) => url.replace(/\/+$/, ""),
}));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: request }));

import {
  remoteGatewayStatus,
  remoteGatewayAction,
  remoteGatewayCommandPending,
  remoteGatewayCommandStatus,
  remoteRestartGateway,
  remoteStartGateway,
  remoteStopGateway,
} from "./remote-gateway";

const actions = {
  start: remoteStartGateway,
  stop: remoteStopGateway,
  restart: remoteRestartGateway,
};

function immediateRoute(path: string): unknown {
  if (path.includes("/api/gateway/")) {
    const action = path.split("/api/gateway/")[1].split("?")[0];
    return { ok: true, pid: 11, name: `gateway-${action}` };
  }
  if (path.includes("/api/actions/"))
    return { pid: 11, running: false, exit_code: 0 };
  return { gateway_running: true, gateway_pid: 21 };
}

async function tick(ms = 1000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function completed(action: keyof typeof actions): void {
  let reads = 0;
  request.mockImplementation(async (_conn, path: string) => {
    if (path.includes("/api/status"))
      return {
        gateway_running: action !== "stop",
        gateway_pid: ++reads === 1 ? 21 : 22,
      };
    return immediateRoute(path);
  });
}

let testPort = 9119;

function remoteActionIpcHandler(
  config: () => { mode: string },
  action: ReturnType<typeof vi.fn>,
): (action: unknown, profile?: string) => Promise<RemoteGatewayActionResult> {
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
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "ipcMain.handle" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "remote-gateway-action"
    )
      handler = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!handler) throw new Error("Remote gateway action IPC handler missing");
  const compiled = ts.transpileModule(
    `const handler = ${handler.getText(ast)};`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const registered = new Function(
    "getConnectionConfig",
    "remoteGatewayAction",
    `${compiled}; return handler;`,
  )(config, action);
  return (command, profile) => registered(undefined, command, profile);
}

describe("remote gateway lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    request.mockReset();
    state.connection = {
      mode: "remote",
      remoteUrl: `http://r:${++testPort}`,
      apiKey: "key",
      remoteAuthMode: "token",
    };
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads liveness with an explicit default or named profile", async () => {
    request.mockResolvedValue({ gateway_running: true });
    expect(await remoteGatewayStatus()).toBe(true);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "remote" }),
      "/api/status?profile=default",
      { method: "GET", timeoutMs: 15000 },
    );
    await remoteGatewayStatus("work space");
    expect(request.mock.calls.at(-1)?.[1]).toBe(
      "/api/status?profile=work%20space",
    );
  });

  it("treats an unreachable dashboard as not running for the display", async () => {
    request.mockRejectedValue(new Error("down"));
    expect(await remoteGatewayStatus()).toBe(false);
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Remote-only action transport]]
  it("keeps the actual typed IPC branch Remote-only and forwards failure meaning unchanged", async () => {
    let mode = "local";
    const result = {
      success: false,
      error: "fetch failed",
      failureKind: "unconfirmed",
    };
    const action = vi.fn().mockResolvedValue(result);
    const handler = remoteActionIpcHandler(() => ({ mode }), action);
    for (const unsupportedMode of ["local", "ssh"]) {
      mode = unsupportedMode;
      expect(await handler("stop", "work")).toMatchObject({
        success: false,
        failureKind: "failed",
      });
    }
    mode = "remote";
    expect(await handler("invalid", "work")).toMatchObject({
      success: false,
      failureKind: "failed",
    });
    expect(action).not.toHaveBeenCalled();
    expect(await handler("restart", "work")).toBe(result);
    expect(action).toHaveBeenCalledExactlyOnceWith("restart", "work");
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Completion read failure classification]]
  it.each([
    ["stop", "network"],
    ["stop", "http"],
    ["stop", "json"],
    ["restart", "network"],
    ["restart", "http"],
    ["restart", "json"],
  ] as const)(
    "labels accepted %s completion %s failures unconfirmed until matching reconciliation",
    async (action, failure) => {
      state.connection = { ...state.connection, apiKey: "" };
      let admitted = false;
      let recovered = false;
      let reads = 0;
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (url: string, options: { method: string }) => {
            const path = new URL(url).pathname;
            if (options.method === "POST") admitted = true;
            if (admitted && !recovered && path.includes("/api/actions/")) {
              if (failure === "network") throw new TypeError("fetch failed");
              return new Response(
                failure === "http"
                  ? "<html>Unavailable</html>"
                  : "invalid JSON",
                { status: failure === "http" ? 500 : 200 },
              );
            }
            const data =
              path === "/api/status"
                ? {
                    gateway_running: !admitted || action !== "stop",
                    gateway_pid: ++reads === 1 ? 21 : 22,
                  }
                : immediateRoute(path);
            return new Response(JSON.stringify(data), { status: 200 });
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      expect(await remoteGatewayAction(action, "work")).toMatchObject({
        success: false,
        failureKind: "unconfirmed",
      });
      await expect(remoteGatewayCommandPending("work")).rejects.toThrow();
      expect((await remoteGatewayAction("start", "other")).success).toBe(false);
      recovered = true;
      expect(await remoteGatewayCommandPending("work")).toBe(false);
      expect(
        fetchMock.mock.calls.filter((call) => call[1].method === "POST"),
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.every((call) =>
          call[0].startsWith(state.connection.remoteUrl),
        ),
      ).toBe(true);
    },
  );

  it.each(["stop", "restart"] as const)(
    "labels matching accepted %s exit failure terminal",
    async (action) => {
      let admitted = false;
      request.mockImplementation(
        async (_conn, path: string, options: { method: string }) => {
          if (options.method === "POST") admitted = true;
          if (admitted && path.includes("/api/actions/"))
            return { pid: 11, running: false, exit_code: 1 };
          return immediateRoute(path);
        },
      );
      expect(await remoteGatewayAction(action, "work")).toEqual({
        success: false,
        error: `Remote gateway ${action} failed (exit 1).`,
        failureKind: "failed",
      });
      expect(await remoteGatewayCommandPending("work")).toBe(false);
    },
  );

  // @lat: [[main-process#Main Process#Remote Gateway management#Late command outcomes reach the view]]
  it.each([
    ["stop", 0],
    ["stop", 1],
    ["restart", 0],
    ["restart", 1],
  ] as const)(
    "returns the matching late %s exit%s result once without keeping failure history",
    async (action, exitCode) => {
      let admitted = false;
      let recovered = false;
      let reads = 0;
      request.mockImplementation(
        async (_conn, path: string, options: { method: string }) => {
          if (options.method === "POST") admitted = true;
          if (admitted && path.includes("/api/actions/")) {
            if (!recovered) throw new TypeError("fetch failed");
            return { pid: 11, running: false, exit_code: exitCode };
          }
          if (path.includes("/api/status"))
            return {
              gateway_running: !admitted || action !== "stop" || exitCode !== 0,
              gateway_pid: ++reads === 1 ? 21 : 22,
            };
          return immediateRoute(path);
        },
      );
      expect(await remoteGatewayAction(action, "work")).toMatchObject({
        success: false,
        failureKind: "unconfirmed",
      });
      recovered = true;
      expect(await remoteGatewayCommandStatus("work")).toEqual(
        exitCode === 0
          ? { pending: false }
          : {
              pending: false,
              failure: { error: `Remote gateway ${action} failed (exit 1).` },
            },
      );
      expect(await remoteGatewayCommandStatus("work")).toEqual({
        pending: false,
      });
      expect(
        request.mock.calls.filter((call) => call[2].method === "POST"),
      ).toHaveLength(1);
      expect(
        request.mock.calls.every((call) => call[1].endsWith("?profile=work")),
      ).toBe(true);
    },
  );

  // @lat: [[main-process#Main Process#Remote Gateway management#Stale refresh cannot report old failure]]
  it("does not report an old failure or delete the newer command after a delayed status read", async () => {
    let phase: "initial" | "recovered" | "new" = "initial";
    let deferOld = false;
    let resolveOld!: (value: unknown) => void;
    const oldRead = new Promise((resolve) => {
      resolveOld = resolve;
    });
    request.mockImplementation(
      async (_conn, path: string, options: { method: string }) => {
        if (path.includes("/api/status"))
          return {
            gateway_running: true,
            gateway_pid: phase === "initial" ? 21 : 22,
          };
        if (path.includes("/api/gateway/stop") && options.method === "POST") {
          phase = "new";
          return { ok: true, pid: 12, name: "gateway-stop" };
        }
        if (path.includes("/api/actions/gateway-restart") && deferOld) {
          deferOld = false;
          return oldRead;
        }
        if (phase === "new" && path.includes("/api/actions/gateway-stop"))
          throw new TypeError("new operation read failed");
        return immediateRoute(path);
      },
    );
    const first = remoteRestartGateway("work");
    await tick(240000);
    expect((await first).success).toBe(false);
    phase = "recovered";
    deferOld = true;
    const oldStatus = remoteGatewayCommandStatus("work");
    expect(await remoteStopGateway("work")).toMatchObject({
      success: false,
      failureKind: "unconfirmed",
    });
    resolveOld({ pid: 11, running: false, exit_code: 1 });
    expect(await oldStatus).toEqual({ pending: true });
    await expect(remoteGatewayCommandStatus("work")).rejects.toThrow(
      "new operation read failed",
    );
  });

  it.each(["start", "stop", "restart"] as const)(
    "confirms %s from the matching completed action and selected profile status",
    async (action) => {
      completed(action);
      expect(await actions[action]("work")).toEqual({ success: true });
      const calls = request.mock.calls;
      expect(
        calls.some(
          (call) =>
            call[1] === `/api/gateway/${action}?profile=work` &&
            call[2].method === "POST",
        ),
      ).toBe(true);
      expect(
        calls.some(
          (call) =>
            call[1] === `/api/actions/gateway-${action}/status?profile=work`,
        ),
      ).toBe(true);
      expect(calls.every((call) => call[1].endsWith("?profile=work"))).toBe(
        true,
      );
    },
  );

  // @lat: [[main-process#Main Process#Remote Gateway management#Lifecycle completion and overlap]]
  it("keeps Stop pending and rejects an overlapping Start until the command and gateway both stop", async () => {
    let admitted = false;
    let commandDone = false;
    let stopped = false;
    request.mockImplementation(async (_conn, path: string) => {
      if (path.includes("/api/actions/"))
        return {
          pid: admitted ? 11 : null,
          running: admitted && !commandDone,
          exit_code: commandDone ? 0 : null,
        };
      if (path.includes("/api/status")) return { gateway_running: !stopped };
      if (path.includes("/api/gateway/")) admitted = true;
      return immediateRoute(path);
    });
    const pending = remoteStopGateway("work");
    const settled = vi.fn();
    void pending.then(settled);
    await tick(0);
    expect(settled).not.toHaveBeenCalled();
    expect(await remoteStartGateway("work")).toEqual({
      success: false,
      error: expect.stringContaining("already pending"),
      failureKind: "unconfirmed",
    });
    expect(
      request.mock.calls.filter((call) => call[2].method === "POST"),
    ).toHaveLength(1);
    commandDone = true;
    await tick();
    expect(settled).not.toHaveBeenCalled();
    stopped = true;
    await tick();
    expect(await pending).toEqual({ success: true });
  });

  it("does not confirm Start from successful action admission before liveness", async () => {
    let running = false;
    request.mockImplementation(async (_conn, path: string) =>
      path.includes("/api/status")
        ? { gateway_running: running }
        : immediateRoute(path),
    );
    const pending = remoteStartGateway();
    const settled = vi.fn();
    void pending.then(settled);
    await tick(0);
    expect(settled).not.toHaveBeenCalled();
    running = true;
    await tick();
    expect(await pending).toEqual({ success: true });
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Restart handoff evidence]]
  it("does not confirm Restart while the old gateway remains alive after command exit", async () => {
    let gatewayPid = 21;
    request.mockImplementation(async (_conn, path: string) =>
      path.includes("/api/status")
        ? { gateway_running: true, gateway_pid: gatewayPid }
        : immediateRoute(path),
    );
    const pending = remoteRestartGateway("work");
    const settled = vi.fn();
    void pending.then(settled);
    await tick(0);
    expect(settled).not.toHaveBeenCalled();
    gatewayPid = 22;
    await tick();
    expect(await pending).toEqual({ success: true });
  });

  it("can confirm Restart from an observed stopped to running transition without gateway PIDs", async () => {
    let reads = 0;
    request.mockImplementation(async (_conn, path: string) =>
      path.includes("/api/status")
        ? { gateway_running: ++reads !== 2 }
        : immediateRoute(path),
    );
    const pending = remoteRestartGateway();
    await tick();
    expect(await pending).toEqual({ success: true });
  });

  it("reports an unconfirmed restart timeout without claiming the command was cancelled", async () => {
    let gatewayPid = 21;
    request.mockImplementation(async (_conn, path: string) =>
      path.includes("/api/status")
        ? { gateway_running: true, gateway_pid: gatewayPid }
        : immediateRoute(path),
    );
    const pending = remoteRestartGateway();
    await tick(240000);
    expect(await pending).toEqual({
      success: false,
      error: expect.stringContaining("server may still be processing"),
      failureKind: "unconfirmed",
    });
    expect(await remoteGatewayCommandPending()).toBe(true);
    const postsBefore = request.mock.calls.filter(
      (call) => call[2].method === "POST",
    ).length;
    expect((await remoteStartGateway("another-profile")).success).toBe(false);
    expect(
      request.mock.calls.filter((call) => call[2].method === "POST"),
    ).toHaveLength(postsBefore);
    gatewayPid = 22;
    expect(await remoteGatewayCommandPending()).toBe(false);
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#External action preflight]]
  it("rejects server commands already running before submitting another mutation", async () => {
    request.mockResolvedValue({ running: true, pid: 98, exit_code: null });
    expect((await remoteStopGateway()).success).toBe(false);
    expect(request.mock.calls.some((call) => call[2].method === "POST")).toBe(
      false,
    );
    expect(await remoteGatewayCommandPending()).toBe(true);
  });

  it("serializes admission across profiles on the same dashboard", async () => {
    let finishPreflight!: (value: unknown) => void;
    const preflight = new Promise((resolve) => {
      finishPreflight = resolve;
    });
    request
      .mockReturnValueOnce(preflight)
      .mockImplementation(async (_conn, path: string) => immediateRoute(path));
    const pending = remoteStartGateway("work");
    expect((await remoteStopGateway("other")).success).toBe(false);
    finishPreflight({ running: false, pid: null, exit_code: null });
    expect(await pending).toEqual({ success: true });
    expect(
      request.mock.calls.filter((call) => call[2].method === "POST"),
    ).toHaveLength(1);
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Uncertain dispatch and explicit refusals]]
  it.each([
    new Error("connection reset after dispatch"),
    { ok: true, name: "gateway-start" },
  ])(
    "retains an uncertain POST reservation without inferring another action PID: %j",
    async (admission) => {
      request.mockImplementation(async (_conn, path: string) => {
        if (path.includes("/api/gateway/")) {
          if (admission instanceof Error) throw admission;
          return admission;
        }
        return immediateRoute(path);
      });
      expect((await remoteStartGateway()).success).toBe(false);
      await expect(remoteGatewayCommandPending()).rejects.toThrow(
        "accepted action PID is unknown",
      );
      expect((await remoteStopGateway("other")).success).toBe(false);
      expect(
        request.mock.calls.filter((call) => call[2].method === "POST"),
      ).toHaveLength(1);
    },
  );

  it("releases an explicit HTTP refusal without leaving a permanently uncertain reservation", async () => {
    request.mockImplementation(async (_conn, path: string) => {
      if (path.includes("/api/gateway/"))
        throw Object.assign(new Error("served by multiplexer"), {
          statusCode: 409,
        });
      return immediateRoute(path);
    });
    expect((await remoteStartGateway()).success).toBe(false);
    expect(await remoteGatewayCommandPending()).toBe(false);
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Refresh preserves newer operations]]
  it("does not let a delayed old-operation refresh erase a newer admitted operation", async () => {
    let gatewayPid = 21;
    let stopAdmitted = false;
    let deferOldRead = false;
    let resolveOldRead!: (value: unknown) => void;
    const oldRead = new Promise((resolve) => {
      resolveOldRead = resolve;
    });
    request.mockImplementation(async (_conn, path: string) => {
      if (path.includes("/api/status"))
        return { gateway_running: true, gateway_pid: gatewayPid };
      if (path.includes("/api/gateway/stop")) {
        stopAdmitted = true;
        return { ok: true, pid: 12, name: "gateway-stop" };
      }
      if (path.includes("/api/actions/gateway-restart") && deferOldRead) {
        deferOldRead = false;
        return oldRead;
      }
      if (path.includes("/api/actions/gateway-stop") && stopAdmitted)
        return { pid: 12, running: true, exit_code: null };
      return immediateRoute(path);
    });
    const first = remoteRestartGateway();
    await tick(240000);
    expect((await first).success).toBe(false);
    gatewayPid = 22;
    deferOldRead = true;
    const staleRefresh = remoteGatewayCommandPending();
    const second = remoteStopGateway();
    await tick(0);
    expect(stopAdmitted).toBe(true);
    resolveOldRead({ pid: 11, running: false, exit_code: 0 });
    expect(await staleRefresh).toBe(true);
    await tick(240000);
    expect((await second).success).toBe(false);
    expect(await remoteGatewayCommandPending()).toBe(true);
  });

  it.each([
    { pid: 12, running: false, exit_code: 0 },
    { pid: 11, running: false, exit_code: 1 },
    { pid: 11, running: false, exit_code: null },
  ])(
    "rejects a replaced, failed or unknown action result: %j",
    async (command) => {
      request.mockImplementation(async (_conn, path: string) =>
        path.includes("/api/actions/") ? command : immediateRoute(path),
      );
      expect((await remoteStopGateway()).success).toBe(false);
    },
  );

  // @lat: [[main-process#Main Process#Remote Gateway management#Strict completion status]]
  it.each([
    new Error("OAuth sign-in required"),
    { detail: "not gateway status" },
  ])(
    "does not turn an invalid Stop status into successful stopped confirmation: %j",
    async (status) => {
      request.mockImplementation(async (_conn, path: string) => {
        if (path.includes("/api/status")) {
          if (status instanceof Error) throw status;
          return status;
        }
        return immediateRoute(path);
      });
      expect((await remoteStopGateway()).success).toBe(false);
    },
  );

  it("surfaces server refusal as an error result", async () => {
    request.mockRejectedValue(new Error("409: served by multiplexer"));
    expect(await remoteStartGateway()).toEqual({
      success: false,
      error: "409: served by multiplexer",
      failureKind: "failed",
    });
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Lifecycle target snapshot]]
  it("retains the original connection and profile through delayed admission and polls", async () => {
    let admit!: (result: unknown) => void;
    const admission = new Promise((resolve) => {
      admit = resolve;
    });
    request.mockImplementation(async (_conn, path: string) =>
      path.includes("/api/gateway/") ? admission : immediateRoute(path),
    );
    const originalUrl = state.connection.remoteUrl;
    const pending = remoteStartGateway("work");
    state.connection = {
      ...state.connection,
      remoteUrl: "http://different:9119",
      apiKey: "other",
    };
    admit({ ok: true, pid: 11, name: "gateway-start" });
    expect(await pending).toEqual({ success: true });
    expect(
      request.mock.calls.every(
        (call) =>
          call[0].remoteUrl === originalUrl &&
          call[0].apiKey === "key" &&
          call[1].endsWith("?profile=work"),
      ),
    ).toBe(true);
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Keyless lifecycle compatibility]]
  it.each(["token", "auto"])(
    "supports %s keyless status and all lifecycle verbs with scoped JSON requests",
    async (authMode) => {
      state.connection = {
        ...state.connection,
        apiKey: "",
        remoteAuthMode: authMode,
      };
      request.mockRejectedValue(
        new Error("Remote Hermes dashboard token is not configured."),
      );
      let action: keyof typeof actions = "start";
      let reads = 0;
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        const path = new URL(url).pathname;
        const data =
          path === "/api/status"
            ? {
                gateway_running: action !== "stop",
                gateway_pid: ++reads === 1 ? 21 : 22,
              }
            : immediateRoute(path);
        return { ok: true, json: async () => data };
      });
      vi.stubGlobal("fetch", fetchMock);
      expect(await remoteGatewayStatus("work")).toBe(true);
      for (const verb of ["start", "stop", "restart"] as const) {
        action = verb;
        reads = 0;
        expect(await actions[verb]("work")).toEqual({ success: true });
      }
      expect(
        fetchMock.mock.calls.every(
          (call) =>
            call[0].startsWith(`${state.connection.remoteUrl}/api/`) &&
            call[0].endsWith("?profile=work"),
        ),
      ).toBe(true);
      expect(
        fetchMock.mock.calls.filter((call) => call[1].method === "POST"),
      ).toHaveLength(3);
      if (authMode === "token") expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(["oauth", "auto"])(
    "never retries %s authentication/probe failure anonymously",
    async (authMode) => {
      state.connection = {
        ...state.connection,
        apiKey: "",
        remoteAuthMode: authMode,
      };
      request.mockRejectedValue(new Error("Sign in to this gateway"));
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      expect((await remoteStartGateway()).success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  // @lat: [[main-process#Main Process#Remote Gateway management#Keyless refusal releases admission]]
  it.each(["token", "auto"])(
    "releases a keyless %s POST refusal and allows a later tracked admission",
    async (authMode) => {
      state.connection = {
        ...state.connection,
        apiKey: "",
        remoteAuthMode: authMode,
      };
      request.mockRejectedValue(
        new Error("Remote Hermes dashboard token is not configured."),
      );
      let refused = true;
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (url: string, options: { method: string }) => {
            const path = new URL(url).pathname;
            if (options.method === "POST" && refused)
              return {
                ok: false,
                status: 409,
                json: async () => ({ detail: "served by multiplexer" }),
              };
            return { ok: true, json: async () => immediateRoute(path) };
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      expect(await remoteStartGateway("work")).toEqual({
        success: false,
        error: "served by multiplexer",
        failureKind: "failed",
      });
      expect(await remoteGatewayCommandPending("work")).toBe(false);
      refused = false;
      expect(await remoteStartGateway("work")).toEqual({ success: true });
      expect(
        fetchMock.mock.calls.filter((call) => call[1].method === "POST"),
      ).toHaveLength(2);
      expect(
        fetchMock.mock.calls.every((call) => call[0].endsWith("?profile=work")),
      ).toBe(true);
    },
  );

  it("rejects HTML-200 keyless responses rather than confirming Stop", async () => {
    state.connection = { ...state.connection, apiKey: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      }),
    );
    expect((await remoteStopGateway()).success).toBe(false);
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Non-JSON refusals retain HTTP status]]
  it.each([
    ["token", 403],
    ["token", 429],
    ["auto", 403],
    ["auto", 429],
  ])(
    "releases a keyless %s non-JSON HTTP%s refusal before a valid retry",
    async (authMode, status) => {
      state.connection = {
        ...state.connection,
        apiKey: "",
        remoteAuthMode: String(authMode),
      };
      request.mockRejectedValue(
        new Error("Remote Hermes dashboard token is not configured."),
      );
      let refused = true;
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (url: string, options: { method: string }) => {
            const path = new URL(url).pathname;
            if (options.method === "POST" && refused)
              return new Response(
                status === 403 ? "" : "<html>Rate limited</html>",
                { status: Number(status) },
              );
            return new Response(JSON.stringify(immediateRoute(path)), {
              status: 200,
            });
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      expect(await remoteStartGateway("work")).toEqual({
        success: false,
        error: `HTTP ${status}`,
        failureKind: "failed",
      });
      expect(await remoteGatewayCommandPending("work")).toBe(false);
      refused = false;
      expect(await remoteStartGateway("work")).toEqual({ success: true });
      expect(
        fetchMock.mock.calls.filter((call) => call[1].method === "POST"),
      ).toHaveLength(2);
    },
  );

  it("retains uncertainty when a keyless lifecycle POST returns malformed success JSON", async () => {
    state.connection = { ...state.connection, apiKey: "" };
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async (url: string, options: { method: string }) =>
          new Response(
            options.method === "POST"
              ? "<html>Unknown admission</html>"
              : JSON.stringify(immediateRoute(new URL(url).pathname)),
            { status: 200 },
          ),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect((await remoteStartGateway("work")).success).toBe(false);
    await expect(remoteGatewayCommandPending("work")).rejects.toThrow(
      "accepted action PID is unknown",
    );
    expect((await remoteStopGateway("work")).success).toBe(false);
    expect(
      fetchMock.mock.calls.filter((call) => call[1].method === "POST"),
    ).toHaveLength(1);
  });
});
