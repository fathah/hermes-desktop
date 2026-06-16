import { execFileSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/locale", () => ({
  getAppLocale: () => "en",
}));

import {
  buildRemoteHermesCmd,
  sshSetConfigValue,
  buildGatewayStartCommand,
  buildGatewayStopCommand,
  buildGatewayStatusCommand,
} from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";

/** The `then` clause of the leading `if` — the systemd-managed branch. */
function systemdBranch(command: string): string {
  return command.slice(command.indexOf("then"), command.indexOf("else"));
}

const sshConfig: SshConfig = {
  host: "example.test",
  port: 22,
  username: "hermes",
  keyPath: "",
  remotePort: 8642,
  localPort: 18642,
};

function runWithHermesShim(command: string): Buffer {
  const home = mkdtempSync(join(tmpdir(), "hermes-ssh-cmd-home-"));
  // Install the shim at a path buildRemoteHermesCmd PROBES BY ABSOLUTE PATH
  // ($HOME/.local/bin/hermes), not just on PATH. The command runs under
  // `bash -lc` (a login shell), which re-sources /etc/profile and RESETS PATH —
  // so a shim reachable only via a prepended PATH entry is dropped, and the
  // final `command -v hermes` fallback then finds either nothing (clean CI
  // container → the test fails) or a real host hermes (dev box → the test
  // passes for the wrong reason). Placing the shim at the probed absolute
  // location makes the `[ -x $HOME/.local/bin/hermes ]` branch fire first,
  // independent of login-shell PATH behavior and of whether a real hermes
  // exists on the host. PATH is still prepended as belt-and-suspenders.
  const localBin = join(home, ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  const hermes = join(localBin, "hermes");
  writeFileSync(
    hermes,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "doctor" ]; then',
      '  printf "doctor stderr preserved\\\\n" >&2',
      "  exit 0",
      "fi",
      'printf "%s\\\\0" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(hermes, 0o755);
  return execFileSync("bash", ["-lc", command], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${localBin}:${process.env.PATH || ""}`,
    },
  });
}

function parseNulArgs(output: Buffer): string[] {
  const parts = output.toString("utf8").split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

describe("ssh remote config writes", () => {
  it.each([
    ["quote", 'bad"value'],
    ["backslash", "bad\\value"],
    ["newline", "bad\nvalue"],
    ["carriage return", "bad\rvalue"],
  ])(
    "rejects YAML-breaking %s values before remote writes",
    async (_name, value) => {
      await expect(
        sshSetConfigValue(sshConfig, "base_url", value),
      ).rejects.toThrow("Config value contains illegal characters");
    },
  );
});

describe("ssh Hermes command quoting", () => {
  it("shell-quotes the whole sh script without dropping per-argument quoting", () => {
    const command = buildRemoteHermesCmd([
      "kanban",
      "create",
      "My task title",
      "--triage",
      "--json",
    ]);

    expect(command).not.toContain(
      "sh -c '[ -x $HOME/hermes-agent/.venv/bin/hermes ] && exec $HOME/hermes-agent/.venv/bin/hermes 'kanban' 'create'",
    );
    expect(command).toContain(
      `sh -c '[ -x $HOME/hermes-agent/.venv/bin/hermes ] && exec $HOME/hermes-agent/.venv/bin/hermes '"'"'kanban'"'"'`,
    );
  });

  it.each([
    [
      "multi-word title",
      ["kanban", "create", "My task title", "--triage", "--json"],
    ],
    [
      "multiline markdown body",
      [
        "kanban",
        "create",
        "My task title",
        "--body",
        "first line\n- bullet one\n- bullet two",
        "--triage",
        "--json",
      ],
    ],
    [
      "single quote in user input",
      ["kanban", "create", "User's task", "--json"],
    ],
  ])(
    "preserves %s",
    (_name, expectedArgs) => {
      const command = buildRemoteHermesCmd(expectedArgs);
      expect(parseNulArgs(runWithHermesShim(command))).toEqual(expectedArgs);
    },
    30000,
  );

  it("preserves existing extraShell redirects", () => {
    const output = runWithHermesShim(
      buildRemoteHermesCmd(["doctor"], " 2>&1"),
    ).toString("utf8");
    expect(output).toBe("doctor stderr preserved\n");
  }, 30000);
});

describe("ssh gateway commands (issue #285)", () => {
  it("detects a systemd hermes.service unit before acting", () => {
    for (const cmd of [
      buildGatewayStartCommand(),
      buildGatewayStopCommand(),
      buildGatewayStatusCommand(),
    ]) {
      expect(cmd).toContain("systemctl list-unit-files hermes.service");
      expect(cmd.indexOf("if ")).toBeLessThan(cmd.indexOf("else"));
    }
  });

  it("start prefers systemd, falling back to nohup only without a unit", () => {
    const cmd = buildGatewayStartCommand();
    expect(cmd).toContain("systemctl start hermes.service");
    expect(cmd).toContain("sudo -n systemctl start hermes.service");
    // The nohup fallback must live in the else branch — never alongside
    // systemd, where it would strand the unit in a restart crash-loop.
    expect(cmd).toContain("nohup hermes gateway start");
    expect(systemdBranch(cmd)).not.toContain("nohup");
  });

  it("stop routes through systemd, else hermes gateway stop", () => {
    const cmd = buildGatewayStopCommand();
    expect(cmd).toContain("systemctl stop hermes.service");
    expect(cmd).toContain("hermes gateway stop");
    expect(systemdBranch(cmd)).not.toContain("hermes gateway stop");
    expect(systemdBranch(cmd)).not.toContain("kill");
  });

  it("status reports the systemd unit state when managed", () => {
    const cmd = buildGatewayStatusCommand();
    expect(cmd).toContain("systemctl is-active hermes.service");
    expect(cmd).toContain("gateway.pid");
    expect(systemdBranch(cmd)).not.toContain("gateway.pid");
  });
});

describe("buildRemoteHermesCmd venv probe (issue #284)", () => {
  const cmd = buildRemoteHermesCmd(["--version"]);

  it("probes both .venv and venv for every install base", () => {
    for (const base of [
      "$HOME/hermes-agent",
      "$HOME/.hermes/hermes-agent",
      "/opt/hermes/hermes-agent",
    ]) {
      expect(cmd).toContain(`${base}/.venv/bin/hermes`);
      expect(cmd).toContain(`${base}/venv/bin/hermes`);
    }
  });

  it("probes ~/.local/bin where pip --user installs a wrapper", () => {
    expect(cmd).toContain("$HOME/.local/bin/hermes");
  });

  it("does not probe the /usr/local/bin sudo-wrapper it deliberately bypasses", () => {
    expect(cmd).not.toContain("/usr/local/bin/hermes");
  });

  it("still falls back to bare hermes on PATH", () => {
    expect(cmd).toContain("command -v hermes");
  });
});
