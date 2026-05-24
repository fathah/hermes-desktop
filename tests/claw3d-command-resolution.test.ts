import { describe, expect, it } from "vitest";
import {
  buildWindowsScriptCommandLine,
  createClaw3dScriptInvocation,
  createNpmCommandInvocation,
  isWindowsCommandScript,
  pickWindowsCommandCandidate,
} from "../src/main/claw3d";

describe("Claw3D command resolution", () => {
  it("detects Windows command scripts", () => {
    expect(isWindowsCommandScript("npm.cmd")).toBe(true);
    expect(isWindowsCommandScript("C:\\node\\npm.BAT")).toBe(true);
    expect(isWindowsCommandScript("git.exe")).toBe(false);
    expect(isWindowsCommandScript("/usr/local/bin/npm")).toBe(false);
  });

  it("prefers npm.cmd over extensionless npm on Windows", () => {
    const command = pickWindowsCommandCandidate([
      "C:\\nvm4w\\nodejs\\npm",
      "C:\\nvm4w\\nodejs\\npm.cmd",
    ]);

    expect(command).toEqual({
      command: "C:\\nvm4w\\nodejs\\npm.cmd",
      windowsScript: true,
    });
  });

  it("runs native executables directly", () => {
    const command = pickWindowsCommandCandidate([
      "C:\\Program Files\\Git\\cmd\\git.exe",
    ]);

    expect(command).toEqual({
      command: "C:\\Program Files\\Git\\cmd\\git.exe",
      windowsScript: false,
    });
  });

  it("wraps Windows command scripts for cmd.exe without losing spaces", () => {
    expect(
      buildWindowsScriptCommandLine("C:\\Program Files\\nodejs\\npm.cmd", [
        "run",
        "dev",
      ]),
    ).toBe('""C:\\Program Files\\nodejs\\npm.cmd" "run" "dev""');
  });

  it("runs Windows npm scripts through node.exe instead of cmd.exe when npm CLI is available", () => {
    const invocation = createNpmCommandInvocation(
      {
        command: "C:\\nvm4w\\nodejs\\npm.cmd",
        windowsScript: true,
      },
      ["run", "dev"],
      {
        platform: "win32",
        fileExists: (path) =>
          [
            "C:\\nvm4w\\nodejs\\node.exe",
            "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
          ].includes(path),
      },
    );

    expect(invocation).toEqual({
      command: "C:\\nvm4w\\nodejs\\node.exe",
      args: [
        "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
        "run",
        "dev",
      ],
    });
  });

  it("falls back to node on PATH for Windows npm shims without a sibling node.exe", () => {
    const invocation = createNpmCommandInvocation(
      {
        command: "C:\\Users\\me\\AppData\\Roaming\\npm\\npm.cmd",
        windowsScript: true,
      },
      ["run", "hermes-adapter"],
      {
        platform: "win32",
        fileExists: (path) =>
          path ===
          "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js",
      },
    );

    expect(invocation).toEqual({
      command: "node",
      args: [
        "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js",
        "run",
        "hermes-adapter",
      ],
    });
  });

  it("runs Claw3D start scripts directly through node without npm or cmd.exe", () => {
    expect(
      createClaw3dScriptInvocation("dev", "C:\\nvm4w\\nodejs\\node.exe"),
    ).toEqual({
      command: "C:\\nvm4w\\nodejs\\node.exe",
      args: ["server/index.js", "--dev"],
    });

    expect(
      createClaw3dScriptInvocation(
        "hermes-adapter",
        "C:\\nvm4w\\nodejs\\node.exe",
      ),
    ).toEqual({
      command: "C:\\nvm4w\\nodejs\\node.exe",
      args: ["server/hermes-gateway-adapter.js"],
    });
  });
});
