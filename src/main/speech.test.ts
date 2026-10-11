import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";
import type { SpeechRequest } from "../shared/minimax-speech";
const state = vi.hoisted(() => ({
  active: "A",
  connection: {} as ConnectionConfig,
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  getSecret: vi.fn(),
}));
vi.mock("./config", () => ({
  getActiveConnection: () => ({ connectionId: state.active }),
  getConnectionConfig: () => state.connection,
  getConfigValue: (...args: unknown[]) => state.getConfig(...args),
  setMiniMaxSpeechConfigValue: (...args: unknown[]) => state.setConfig(...args),
}));
vi.mock("./secrets", () => ({
  getSecret: (...args: unknown[]) => state.getSecret(...args),
}));
vi.mock("./utils", () => ({
  isValidProfileName: (p: unknown) =>
    typeof p === "string" && /^[a-z0-9_][a-z0-9_-]{0,63}$/.test(p),
}));
import { providerTargetRevision } from "./provider-request-target";
import {
  runSpeechRequest,
  cancelSpeechRequest,
  getSpeechConfig,
  setSpeechConfig,
} from "./speech";
class WindowOwner extends EventEmitter {
  id = 1;
  isDestroyed(): boolean {
    return false;
  }
}
function owner(id = 1): Parameters<typeof runSpeechRequest>[0] {
  const result = new WindowOwner();
  result.id = id;
  return result as unknown as Parameters<typeof runSpeechRequest>[0];
}
function request(id = "request-a"): SpeechRequest {
  return {
    requestId: id,
    text: "hello",
    profile: "work",
    target: {
      connectionId: "A",
      mode: "local",
      revision: providerTargetRevision(state.connection),
    },
  };
}
function good(): Response {
  return new Response(
    JSON.stringify({
      data: { audio: "cafe", status: 2 },
      base_resp: { status_code: 0 },
    }),
  );
}
function handler(name: string): (...args: unknown[]) => unknown {
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
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "ipcMain.handle" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === name
    )
      expression = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!expression) throw new Error(`Missing actual handler ${name}`);
  const code = ts.transpileModule(
    `const handler = ${expression.getText(ast)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const dependencies = {
    runSpeechRequest,
    cancelSpeechRequest,
    getSpeechConfig,
    setSpeechConfig,
  };
  return new Function(...Object.keys(dependencies), `${code}; return handler;`)(
    ...Object.values(dependencies),
  );
}
beforeEach(() => {
  state.active = "A";
  state.connection = {
    mode: "local",
    remoteUrl: "",
    apiKey: "",
    ssh: {},
  } as ConnectionConfig;
  state.getConfig.mockReset();
  state.setConfig.mockReset();
  state.getSecret.mockReset().mockReturnValue("work-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(good()));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// @lat: [[speech-playback-tests#Selected local profile]]
it("actual IPC reads only the explicit Local profile's speech credential and returns encoded audio", async () => {
  const result = await handler("synthesize-speech")(
    { sender: owner() },
    request(),
  );
  expect(result).toEqual({
    audio: new Uint8Array([202, 254]),
    mimeType: "audio/mpeg",
  });
  expect(state.getSecret).toHaveBeenCalledExactlyOnceWith(
    "MINIMAX_API_KEY",
    "work",
  );
  expect(state.getConfig.mock.calls.every((call) => call[1] === "work")).toBe(
    true,
  );
  expect(fetch).toHaveBeenCalledWith(
    "https://api.minimax.io/v1/t2a_v2",
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer work-key" }),
    }),
  );
});

// @lat: [[speech-playback-tests#Local authority refusal]]
it("refuses Remote, SSH, inactive and stale Local DTOs before any profile key/config read", async () => {
  const synthesize = handler("synthesize-speech");
  const local = request();
  for (const mode of ["remote", "ssh"] as const) {
    state.connection.mode = mode;
    await expect(
      synthesize(
        { sender: owner() },
        { ...local, target: { ...local.target, mode } },
      ),
    ).rejects.toThrow("only on a Local");
  }
  state.connection.mode = "local";
  state.active = "B";
  await expect(synthesize({ sender: owner() }, local)).rejects.toThrow(
    "changed",
  );
  state.active = "A";
  state.connection.apiKey = "changed";
  await expect(synthesize({ sender: owner() }, local)).rejects.toThrow(
    "changed",
  );
  await expect(
    synthesize({ sender: owner() }, { ...local, profile: "../unsafe" }),
  ).rejects.toThrow("valid speech profile");
  expect(state.getSecret).not.toHaveBeenCalled();
  expect(state.getConfig).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

// @lat: [[speech-playback-tests#Owned cancellation and replacement]]
it("Stop, replacement and destroyed-window cancellation abort only the matching current request", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init) => {
      signals.push(init.signal);
      return new Promise(() => {});
    }),
  );
  const window = owner();
  const first = runSpeechRequest(window, request("request-1"));
  const firstError = expect(first).rejects.toThrow("cancelled");
  expect(cancelSpeechRequest(2, "request-1")).toBe(false);
  const second = runSpeechRequest(window, request("request-2"));
  const secondError = expect(second).rejects.toThrow("cancelled");
  await firstError;
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  expect(handler("cancel-speech")({ sender: window }, "request-1")).toBe(false);
  expect(handler("cancel-speech")({ sender: window }, "request-2")).toBe(true);
  await secondError;
  const third = runSpeechRequest(window, request("request-3"));
  const thirdError = expect(third).rejects.toThrow("cancelled");
  (window as unknown as EventEmitter).emit("destroyed");
  await thirdError;
  expect(signals[2].aborted).toBe(true);
  expect((window as unknown as EventEmitter).listenerCount("destroyed")).toBe(
    0,
  );
});

it("rejects delayed audio after the selected Local connection changes", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const pending = runSpeechRequest(owner(), request());
  state.active = "B";
  finish(good());
  await expect(pending).rejects.toThrow("changed");
});

// @lat: [[speech-playback-tests#Targeted settings writes]]
it("actual settings IPC validates target and values before writing only the explicit selected profile", () => {
  const target = request().target;
  expect(handler("get-speech-config")(null, "work", target)).toEqual({
    model: "speech-2.8-hd",
    region: "",
  });
  expect(
    handler("set-speech-config")(null, "region", "cn", "work", target),
  ).toBe(true);
  expect(state.setConfig.mock.calls).toEqual([["region", "cn", "work"]]);
  state.setConfig.mockClear();
  expect(handler("set-speech-config")(null, "region", "", "work", target)).toBe(
    true,
  );
  expect(state.setConfig.mock.calls).toEqual([["region", "", "work"]]);
  state.setConfig.mockClear();
  state.active = "B";
  expect(() =>
    handler("set-speech-config")(
      null,
      "model",
      "speech-2.8-hd",
      "work",
      target,
    ),
  ).toThrow("changed");
  state.active = "A";
  expect(() => setSpeechConfig("model", "unsupported", "work", target)).toThrow(
    "Invalid",
  );
  expect(() => setSpeechConfig("region", "wrong", "work", target)).toThrow(
    "Invalid",
  );
  state.connection.mode = "ssh";
  expect(() => getSpeechConfig("work", target)).toThrow("only on a Local");
  expect(state.setConfig).not.toHaveBeenCalled();
});
