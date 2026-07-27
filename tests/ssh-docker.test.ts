import { execFileSync } from "child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/locale", () => ({
  getAppLocale: () => "en",
}));

import {
  buildApplySshDockerTargetCommand,
  buildDockerLauncherScript,
  buildInspectSshHermesTargetCommand,
  buildProbeSshDockerTargetCommand,
  isValidDockerContainerName,
  parseSshHermesTargetInspection,
} from "../src/main/ssh-docker";

// The generated remote scripts are python; validating that they at least
// compile catches template/quoting regressions. python3 is not part of the
// repo's supported dev toolchain on Windows, so these compile checks skip
// there (and anywhere python3 is missing) — the string assertions below run
// on every platform.
function resolvePython3(): string | null {
  if (process.platform === "win32") return null;
  try {
    const out = execFileSync("/bin/sh", ["-c", "command -v python3"], {
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}
const python3Path = resolvePython3();
const itPython = python3Path ? it : it.skip;

function assertPythonCompiles(script: string): void {
  // compile() only parses — nothing in the script is executed.
  execFileSync(python3Path as string, ["-c", "import sys; compile(sys.stdin.read(), '<script>', 'exec')"], {
    input: script,
  });
}

describe("isValidDockerContainerName", () => {
  it("accepts docker's documented name charset", () => {
    expect(isValidDockerContainerName("hermes-kk5any7517jzgl9y19mrabul")).toBe(
      true,
    );
    expect(isValidDockerContainerName("Hermes_1.2-x")).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["leading dash", "-hermes"],
    ["whitespace", "hermes agent"],
    ["shell metacharacters", "hermes;rm -rf /"],
    ["command substitution", "$(reboot)"],
    ["quote", "hermes'quote"],
  ])("rejects %s", (_name, value) => {
    expect(isValidDockerContainerName(value)).toBe(false);
  });
});

describe("buildDockerLauncherScript", () => {
  it("embeds the container, CLI path, and management marker", () => {
    const script = buildDockerLauncherScript(
      "hermes-abc",
      "/opt/hermes/.venv/bin/hermes",
      "",
    );
    expect(script).toContain("# managed by Hermes Desktop (docker:hermes-abc)");
    expect(script).toContain("container='hermes-abc'");
    expect(script).toContain("'/opt/hermes/.venv/bin/hermes' \"$@\"");
    expect(script).toContain("-e HOME=/opt/data -e HERMES_HOME=/opt/data");
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    // No exec user flag when the container default user works.
    expect(script).not.toContain("-u ");
  });

  it("adds the exec user flag when a non-default user is required", () => {
    const script = buildDockerLauncherScript(
      "hermes-abc",
      "/opt/hermes/.venv/bin/hermes",
      "hermes",
    );
    expect(script).toContain("docker exec $tty_args -u 'hermes' ");
  });

  it("keeps interactive and piped stdin working", () => {
    const script = buildDockerLauncherScript("c1", "/bin/hermes", "");
    expect(script).toContain(
      'if [ -t 0 ] && [ -t 1 ]; then tty_args="-it"; elif [ -t 0 ]; then tty_args="-i"; fi',
    );
  });

  it("refuses container names that could break out of the script", () => {
    expect(() =>
      buildDockerLauncherScript("bad name", "/bin/hermes", ""),
    ).toThrow("Invalid Docker container name");
    expect(() =>
      buildDockerLauncherScript("$(evil)", "/bin/hermes", ""),
    ).toThrow("Invalid Docker container name");
  });
});

describe("buildInspectSshHermesTargetCommand", () => {
  it("scopes container matching to the configured remote port", () => {
    const cmd = buildInspectSshHermesTargetCommand(8642, "");
    expect(cmd).toContain("remote_port = 8642");
    expect(cmd).toContain("nousresearch/hermes-agent");
  });

  it("passes the selected container name as data, not code", () => {
    const cmd = buildInspectSshHermesTargetCommand(8642, 'evil"; import os');
    expect(cmd).toContain('selected_name = "evil\\"; import os"');
  });

  it("omits port matching when no remote port is configured", () => {
    expect(buildInspectSshHermesTargetCommand(undefined, "")).toContain(
      "remote_port = None",
    );
  });

  itPython("generates python that compiles", () => {
    assertPythonCompiles(buildInspectSshHermesTargetCommand(8642, "sel'ected"));
  });
});

describe("parseSshHermesTargetInspection", () => {
  const container = {
    id: "abc123",
    name: "hermes-1",
    image: "nousresearch/hermes-agent:latest",
    ports: "127.0.0.1:8642->8642/tcp",
    dataHome: "/data/hermes",
    matchesRemotePort: true,
  };

  it("maps a full inspection payload", () => {
    const parsed = parseSshHermesTargetInspection(
      JSON.stringify({
        hostInstallFound: false,
        hermesHomeState: "symlink",
        hermesHomeTarget: "/data/hermes",
        launcherState: "docker",
        launcherContainerName: "hermes-1",
        dockerAvailable: true,
        dockerContainers: [container],
        selectedDockerContainerName: "hermes-1",
      }),
      "hermes-1",
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.launcherState).toBe("docker");
    expect(parsed.launcherContainerName).toBe("hermes-1");
    expect(parsed.dockerContainers).toHaveLength(1);
  });

  it("reports a selected container that is no longer running", () => {
    const parsed = parseSshHermesTargetInspection(
      JSON.stringify({
        hostInstallFound: false,
        hermesHomeState: "missing",
        launcherState: "missing",
        dockerAvailable: true,
        dockerContainers: [container],
      }),
      "hermes-gone",
    );
    expect(parsed.error).toContain('"hermes-gone" is not running');
  });

  it("reports a selected container without a data mount", () => {
    const parsed = parseSshHermesTargetInspection(
      JSON.stringify({
        dockerAvailable: true,
        dockerContainers: [{ ...container, dataHome: "" }],
      }),
      "hermes-1",
    );
    expect(parsed.error).toContain("no host mount for /opt/data");
  });

  it("defaults sanely on empty remote output", () => {
    const parsed = parseSshHermesTargetInspection("", "");
    expect(parsed.hostInstallFound).toBe(false);
    expect(parsed.hermesHomeState).toBe("missing");
    expect(parsed.hermesHomeEmpty).toBe(false);
    expect(parsed.launcherState).toBe("missing");
    expect(parsed.dockerContainers).toEqual([]);
    expect(parsed.error).toBeUndefined();
  });

  it("distinguishes an empty ~/.hermes directory from a real one", () => {
    // An empty directory is replaceable by the setup symlink, so the UI must
    // not report it as a conflict (greptile P1 on PR #435).
    const parsed = parseSshHermesTargetInspection(
      JSON.stringify({
        hermesHomeState: "directory",
        hermesHomeEmpty: true,
        dockerAvailable: true,
        dockerContainers: [container],
      }),
      "",
    );
    expect(parsed.hermesHomeState).toBe("directory");
    expect(parsed.hermesHomeEmpty).toBe(true);
  });
});

describe("buildProbeSshDockerTargetCommand", () => {
  it("validates the container name before building the script", () => {
    expect(() => buildProbeSshDockerTargetCommand("bad name")).toThrow(
      "Invalid Docker container name",
    );
  });

  it("prefers the service user and public CLI before legacy fallbacks", () => {
    const cmd = buildProbeSshDockerTargetCommand("hermes-1");
    expect(cmd).toContain('container = "hermes-1"');
    expect(cmd).toContain("nousresearch/hermes-agent");
    expect(cmd).toContain(
      'cli_candidates = ["hermes", "/opt/hermes/bin/hermes", "/opt/hermes/.venv/bin/hermes", "/opt/hermes/venv/bin/hermes"]',
    );
    expect(cmd).toContain('for candidate_user in ("hermes", None):');
  });

  itPython("generates python that compiles", () => {
    assertPythonCompiles(buildProbeSshDockerTargetCommand("hermes-1"));
  });
});

describe("buildApplySshDockerTargetCommand", () => {
  const launcher = buildDockerLauncherScript(
    "hermes-1",
    "/opt/hermes/.venv/bin/hermes",
    "hermes",
  );

  it("passes the launcher script and data home as data, not code", () => {
    const cmd = buildApplySshDockerTargetCommand(
      "hermes-1",
      launcher,
      "/data/it's home",
    );
    expect(cmd).toContain(JSON.stringify(launcher));
    expect(cmd).toContain('"/data/it\'s home"');
  });

  it("validates the container name before building the script", () => {
    expect(() =>
      buildApplySshDockerTargetCommand("bad name", launcher, "/data/hermes"),
    ).toThrow("Invalid Docker container name");
  });

  it("refuses to clobber non-managed launchers and real home directories", () => {
    const cmd = buildApplySshDockerTargetCommand(
      "hermes-1",
      launcher,
      "/data/hermes",
    );
    expect(cmd).toContain("A custom launcher already exists");
    expect(cmd).toContain("~/.hermes already exists as a real directory");
  });

  it("seeds API server settings from the container env, not fresh values first", () => {
    const cmd = buildApplySshDockerTargetCommand(
      "hermes-1",
      launcher,
      "/data/hermes",
    );
    expect(cmd).toContain('cenv.get("API_SERVER_KEY")');
    expect(cmd).toContain("API_SERVER_ENABLED");
    expect(cmd).toContain("secrets.token_hex(24)");
  });

  itPython("generates python that compiles", () => {
    assertPythonCompiles(
      buildApplySshDockerTargetCommand("hermes-1", launcher, "/data/hermes"),
    );
  });
});
