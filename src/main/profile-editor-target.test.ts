import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { ConnectionConfig } from "./config";
import {
  beginProviderAuthChange,
  finishProviderAuthChange,
} from "./provider-request-target";
import type { ProfileEditorTarget } from "../shared/profile-editor-target";

const state = vi.hoisted(() => ({
  id: "a",
  activeProfile: "work",
  config: {
    mode: "remote",
    remoteUrl: "https://a.test",
    apiKey: "secret-a",
    remoteAuthMode: "token",
  } as ConnectionConfig,
}));
vi.mock("./config", () => ({
  getActiveConnection: () => ({ connectionId: state.id }),
  getConnectionConfig: () => state.config,
}));
vi.mock("./utils", () => ({
  getActiveProfileNameSync: () => state.activeProfile,
}));
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

describe("Captured profile editor target", () => {
  beforeEach(() => {
    state.id = "a";
    state.activeProfile = "work";
    state.config = {
      mode: "remote",
      remoteUrl: "https://a.test",
      apiKey: "secret-a",
      remoteAuthMode: "token",
    } as ConnectionConfig;
  });

  // @lat: [[profile-editors#Tests#Immutable connection dispatch]]
  it("captures a canonical profile and dispatches an independent private snapshot through the actual Soul IPC", async () => {
    const target = captureProfileEditorTarget("work");
    const remoteWriteSoul = vi.fn().mockResolvedValue(true);
    const writeSoul = vi.fn();
    const dispatch = handler("write-soul", {
      resolveProfileEditorTarget,
      remoteWriteSoul,
      writeSoul,
    });
    await expect(dispatch("a draft", "work", target)).resolves.toBe(true);
    const snapshot = remoteWriteSoul.mock.calls[0][2];
    state.config.remoteUrl = "https://b.test";
    expect(snapshot.remoteUrl).toBe("https://a.test");
    expect(writeSoul).not.toHaveBeenCalled();
    expect(JSON.stringify(target)).not.toContain("secret-a");
  });

  // @lat: [[profile-editors#Tests#Reject stale queued mutations]]
  it.each(["connection", "url", "key", "mode", "profile"])(
    "rejects a queued write after a %s change before reaching any backend",
    (change) => {
      const target = captureProfileEditorTarget("work");
      if (change === "connection") state.id = "b";
      if (change === "url") state.config.remoteUrl = "https://b.test";
      if (change === "key") state.config.apiKey = "secret-b";
      if (change === "mode") state.config.mode = "local";
      const remoteWriteSoul = vi.fn();
      const writeSoul = vi.fn();
      const dispatch = handler("write-soul", {
        resolveProfileEditorTarget,
        remoteWriteSoul,
        writeSoul,
      });
      expect(() =>
        dispatch("draft", change === "profile" ? "other" : "work", target),
      ).toThrow(/editor/);
      expect(remoteWriteSoul).not.toHaveBeenCalled();
      expect(writeSoul).not.toHaveBeenCalled();
    },
  );

  // @lat: [[profile-editors#Tests#Remote memory mutation boundary]]
  it("rejects Remote memory mutations and reset without touching local files", async () => {
    const target = captureProfileEditorTarget("work");
    const local = vi.fn();
    const add = handler("add-memory-entry", {
      resolveProfileEditorTarget,
      addMemoryEntry: local,
      REMOTE_MEMORY_READ_ONLY_ERROR: "read-only",
    });
    expect(add("entry", "work", target)).toEqual({
      success: false,
      error: "read-only",
    });
    const reset = handler("reset-soul", {
      resolveProfileEditorTarget,
      resetSoul: local,
    });
    expect(() => reset("work", target)).toThrow(/unavailable/);
    const env = handler("set-env", {
      resolveProfileEditorTarget,
      setEnvValue: local,
      REMOTE_MEMORY_READ_ONLY_ERROR: "read-only",
    });
    await expect(env("KEY", "secret", "work", target)).rejects.toThrow(
      /read-only/,
    );
    expect(local).not.toHaveBeenCalled();
  });

  // @lat: [[profile-editors#Tests#Local and SSH compatibility]]
  it("retains legacy dispatch and captures the implicit local active profile", () => {
    state.config.mode = "local";
    const target = captureProfileEditorTarget();
    expect(target.profile).toBe("work");
    expect(resolveProfileEditorTarget(undefined, target).profile).toBe("work");
    expect(resolveProfileEditorTarget("other").profile).toBe("other");
    const local = vi.fn().mockReturnValue(true);
    const localDispatch = handler("write-soul", {
      resolveProfileEditorTarget,
      writeSoul: local,
    });
    expect(localDispatch("legacy draft")).toBe(true);
    expect(local).toHaveBeenCalledWith("legacy draft", undefined);
    expect(localDispatch("scoped draft", "work", target)).toBe(true);
    expect(local).toHaveBeenLastCalledWith("scoped draft", "work");
    state.config.mode = "ssh";
    state.config.ssh = { host: "old-host" } as NonNullable<
      ConnectionConfig["ssh"]
    >;
    const sshTarget = captureProfileEditorTarget("ssh-work");
    const ssh = vi.fn().mockReturnValue(true);
    const sshDispatch = handler("write-soul", {
      resolveProfileEditorTarget,
      sshWriteSoul: ssh,
      writeSoul: local,
    });
    expect(sshDispatch("ssh draft", "ssh-work", sshTarget)).toBe(true);
    state.config.ssh.host = "new-host";
    expect(ssh.mock.calls[0][0].host).toBe("old-host");
    expect(ssh.mock.calls[0].slice(1)).toEqual(["ssh draft", "ssh-work"]);
    expect(captureProfileEditorTarget("ssh-work").mode).toBe("ssh");
    expect(() =>
      resolveProfileEditorTarget(undefined, {} as ProfileEditorTarget),
    ).toThrow(/Invalid/);
  });
});

// @lat: [[profile-editors#Tests#OAuth account changes invalidate queued targets]]
it("blocks target capture during sign-in and rejects a captured target after cookie-account changes", () => {
  state.id = "oauth";
  state.config = {
    mode: "remote",
    remoteUrl: "https://editor-target-oauth.test",
    remoteAuthMode: "oauth",
  } as ConnectionConfig;
  const target = captureProfileEditorTarget("work");
  beginProviderAuthChange(state.config.remoteUrl);
  expect(() => captureProfileEditorTarget("work")).toThrow(
    /sign-in is changing/,
  );
  finishProviderAuthChange(state.config.remoteUrl);
  expect(() => resolveProfileEditorTarget("work", target)).toThrow(
    /configuration changed/,
  );
});
