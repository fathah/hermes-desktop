import { describe, expect, it } from "vitest";
import {
  sshSetConfigValue,
  buildGatewayStartCommand,
  buildGatewayStopCommand,
  buildGatewayStatusCommand,
  buildRemoteHermesCmd,
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
