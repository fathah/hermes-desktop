import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { ConnectionConfig } from "./config";
const state = vi.hoisted(() => ({
  id: "a",
  connection: {} as ConnectionConfig,
}));
vi.mock("./config", () => ({
  getActiveConnection: () => ({ connectionId: state.id }),
  getConnectionConfig: () => state.connection,
}));
vi.mock("./utils", () => ({ getActiveProfileNameSync: () => "default" }));
import {
  captureProfileEditorTarget,
  resolveProfileEditorTarget,
} from "./profile-editor-target";
function handler(
  channel: string,
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
  let expression: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "ipcMain.handle" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === channel
    )
      expression = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!expression) throw new Error(`Missing IPC ${channel}`);
  const js = ts.transpileModule(
    `const selected = ${expression.getText(ast)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return new Function(
    ...Object.keys(dependencies),
    `${js}; return (...args) => selected({}, ...args);`,
  )(...Object.values(dependencies));
}

beforeEach(() => {
  state.id = "a";
  state.connection = {
    mode: "remote",
    remoteUrl: "https://a.test",
    apiKey: "key-a",
    remoteAuthMode: "token",
  } as ConnectionConfig;
});
// @lat: [[remote-profiles#Tests#Remote selection never invokes local profile use]]
it("actual Remote selection uses only the desktop preference and never Local or remote gateway controls", async () => {
  const target = captureProfileEditorTarget("default");
  const local = vi.fn(),
    selected = vi.fn(),
    gateway = vi.fn();
  const select = handler("set-active-profile", {
    resolveProfileEditorTarget,
    isValidProfileName: (name: string) => name === "work",
    PROFILE_NAME_ERROR: "invalid",
    setRemoteSelectedProfile: selected,
    notifyProfileSwitched: vi.fn(),
    setActiveProfile: local,
    sshGatewayStatus: gateway,
    startGateway: gateway,
  });
  await expect(select("work", target)).resolves.toBe(true);
  expect(selected).toHaveBeenCalledWith(
    "a",
    expect.objectContaining({ remoteUrl: "https://a.test" }),
    "work",
  );
  expect(local).not.toHaveBeenCalled();
  expect(gateway).not.toHaveBeenCalled();
  await expect(select("work")).rejects.toThrow("explicit target");
});
// @lat: [[remote-profiles#Tests#Unsupported mutations cannot fall through]]
it("actual Remote sync, deletion and appearance branches never mutate Local or cloud data", async () => {
  const target = captureProfileEditorTarget("work");
  const mutation = vi.fn();
  for (const [channel, args, deps] of [
    ["agent-sync-run", [target], { syncAgents: mutation }],
    [
      "set-profile-color",
      ["work", "#112233", target],
      { setProfileColor: mutation },
    ],
    [
      "set-profile-avatar",
      ["work", "data:image/png", target],
      { setProfileAvatar: mutation },
    ],
    [
      "remove-profile-avatar",
      ["work", target],
      { removeProfileAvatar: mutation },
    ],
  ] as const) {
    const dispatch = handler(channel, { resolveProfileEditorTarget, ...deps });
    if (channel === "agent-sync-run")
      await expect(dispatch(...args)).rejects.toThrow("Local");
    else expect(() => dispatch(...args)).toThrow("unavailable");
  }
  const remove = handler("delete-profile", {
    resolveProfileEditorTarget,
    deleteProfileWithSync: mutation,
  });
  expect(remove("work", target)).toMatchObject({ success: false });
  expect(mutation).not.toHaveBeenCalled();
});
// @lat: [[remote-profiles#Tests#Queued and SSH follow-up requests keep authority]]
it("rejects stale queued creates and an SSH start after the selected target changes during its status read", async () => {
  const target = captureProfileEditorTarget("default");
  const mutation = vi.fn();
  const create = handler("create-profile", {
    resolveProfileEditorTarget,
    remoteCreateProfile: mutation,
    createProfile: mutation,
  });
  state.id = "b";
  expect(() => create("work", null, target)).toThrow("changed");
  expect(mutation).not.toHaveBeenCalled();
  state.id = "a";
  state.connection.mode = "ssh";
  state.connection.ssh = {} as ConnectionConfig["ssh"];
  const sshTarget = captureProfileEditorTarget("default");
  let resolveStatus!: (running: boolean) => void;
  const sshStart = vi.fn();
  const select = handler("set-active-profile", {
    resolveProfileEditorTarget,
    isValidProfileName: () => true,
    setActiveProfile: vi.fn(),
    notifyProfileSwitched: vi.fn(),
    sshGatewayStatus: () =>
      new Promise((done) => {
        resolveStatus = done;
      }),
    sshStartGateway: sshStart,
  });
  const pending = select("work", sshTarget);
  state.id = "b";
  resolveStatus(false);
  await expect(pending).rejects.toThrow("changed");
  expect(sshStart).not.toHaveBeenCalled();
});
