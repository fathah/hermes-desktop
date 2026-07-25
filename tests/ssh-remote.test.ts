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
  parseHermesProfileListOutput,
  selectSshProfiles,
} from "../src/main/ssh-remote";
import type { SshProfileInfo } from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";

function profile(
  name: string,
  overrides: Partial<SshProfileInfo> = {},
): SshProfileInfo {
  return {
    name,
    path: name === "default" ? "~/.hermes" : `~/.hermes/profiles/${name}`,
    isDefault: name === "default",
    isActive: name === "default",
    model: "",
    provider: "auto",
    hasEnv: false,
    hasSoul: false,
    skillCount: 0,
    gatewayRunning: false,
    ...overrides,
  };
}

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

// The shim-execution tests below run the generated command through a real
// POSIX shell. A clean Windows dev environment has no `bash` on PATH (and the
// shim/PATH model is POSIX-specific), so they skip there — the portable string
// assertions in this file still run on every platform.
const itPosix = process.platform === "win32" ? it.skip : it;

function runWithHermesShim(command: string): Buffer {
  if (process.platform === "win32") {
    throw new Error("POSIX-only helper — guard the calling test with itPosix");
  }
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
      `$HOME/hermes-agent/.venv/bin/hermes '"'"'kanban'"'"'`,
    );
  });

  itPosix.each([
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

  itPosix("preserves existing extraShell redirects", () => {
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

  it("start prefers systemd, falling back to a venv-probed nohup only without a unit", () => {
    const cmd = buildGatewayStartCommand();
    expect(cmd).toContain("systemctl start hermes.service");
    expect(cmd).toContain("sudo -n systemctl start hermes.service");
    // The nohup fallback must live in the else branch — never alongside
    // systemd, where it would strand the unit in a restart crash-loop — and it
    // resolves the CLI via the venv/launcher probe (not bare `hermes`) so it
    // works when `hermes` is not on the non-interactive SSH PATH.
    expect(cmd).toContain("nohup");
    expect(cmd).toContain("venv/bin/hermes");
    expect(cmd).toContain("$HOME/.hermes/gateway.log");
    expect(systemdBranch(cmd)).not.toContain("nohup");
    expect(systemdBranch(cmd)).not.toContain("venv/bin/hermes");
  });

  it("stop routes through systemd, else a venv-probed gateway stop", () => {
    const cmd = buildGatewayStopCommand();
    expect(cmd).toContain("systemctl stop hermes.service");
    // Resolves the CLI via the venv/launcher probe (not bare `hermes`); the
    // recorded-pid kill remains the last resort in the else branch.
    expect(cmd).toContain("venv/bin/hermes");
    expect(systemdBranch(cmd)).not.toContain("venv/bin/hermes");
    expect(systemdBranch(cmd)).not.toContain("kill");
  });

  it("status reports the systemd unit state when managed", () => {
    const cmd = buildGatewayStatusCommand();
    expect(cmd).toContain("systemctl is-active hermes.service");
    expect(cmd).toContain("gateway.pid");
    expect(systemdBranch(cmd)).not.toContain("gateway.pid");
  });

  it("status falls back to a loopback health probe for container pids (issue #432)", () => {
    // Docker-backed installs record the container-namespace pid, so a host
    // `kill -0` reports a healthy gateway as stopped; the health probe is the
    // namespace-agnostic tiebreaker.
    const cmd = buildGatewayStatusCommand(undefined, 8642);
    expect(cmd).toContain("http://127.0.0.1:8642/health");
    expect(cmd).toContain('kill -0 $pid 2>/dev/null && echo "running"');
  });

  it("status without a health port keeps the plain pid check", () => {
    const cmd = buildGatewayStatusCommand();
    expect(cmd).not.toContain("/health");
  });

  it("status ignores non-integer health ports", () => {
    expect(buildGatewayStatusCommand(undefined, 8642.5)).not.toContain(
      "/health",
    );
  });
});

describe("buildRemoteHermesCmd venv probe (issue #284)", () => {
  const cmd = buildRemoteHermesCmd(["--version"]);

  it("probes explicit remote launcher hooks before default install paths", () => {
    const configLauncher = "$HOME/.config/hermes-desktop/remote-hermes";
    const legacyLauncher = "$HOME/.hermes/desktop-remote-hermes";
    expect(cmd).toContain(configLauncher);
    expect(cmd).toContain(legacyLauncher);
    expect(cmd.indexOf(configLauncher)).toBeLessThan(
      cmd.indexOf("$HOME/hermes-agent/.venv/bin/hermes"),
    );
  });

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

  it("does not bake in deployment-specific managed runtime defaults", () => {
    expect(cmd).not.toContain("/projects/hermes-runtime");
    expect(cmd).not.toContain("sudo -n -u hermes");
  });

  it("does not probe the /usr/local/bin sudo-wrapper it deliberately bypasses", () => {
    expect(cmd).not.toContain("/usr/local/bin/hermes");
  });

  it("still falls back to bare hermes on PATH", () => {
    expect(cmd).toContain("command -v hermes");
  });
});

describe("parseHermesProfileListOutput", () => {
  it("parses the Hermes profile table used by managed SSH launchers", () => {
    const profiles = parseHermesProfileListOutput(`
 Profile              Model                        Gateway      Alias        Distribution
 ───────────────      ───────────────────────────  ───────────  ───────────  ────────────────────
 ◆default             gpt-5.5                      running      —            —
  biz-office          gpt-5.5                      running      biz-office   —
  finance-accounting  gpt-5.5                      stopped      finance-accounting —
  marketing           gpt-5.5                      running      marketing    —
`);

    expect(profiles.map((p) => p.name)).toEqual([
      "default",
      "biz-office",
      "finance-accounting",
      "marketing",
    ]);
    expect(profiles.find((p) => p.name === "default")?.isActive).toBe(true);
    expect(profiles.find((p) => p.name === "marketing")?.gatewayRunning).toBe(
      true,
    );
    expect(
      profiles.find((p) => p.name === "finance-accounting")?.gatewayRunning,
    ).toBe(false);
  });

  it("marks default active when the table has no active marker", () => {
    const profiles = parseHermesProfileListOutput(`
 Profile          Model       Gateway
 default          gpt-5.5     running
 marketing        gpt-5.5     stopped
`);

    expect(profiles.find((p) => p.name === "default")?.isActive).toBe(true);
    expect(profiles.find((p) => p.name === "marketing")?.isActive).toBe(false);
  });
});

describe("selectSshProfiles", () => {
  it("prefers the launcher runtime over an equal-length home-directory scan", () => {
    // Greptile P1: a managed install whose launcher reports the SAME profile
    // count as the SSH user's ~/.hermes scan must still surface the launcher's
    // live state (correct HERMES_HOME, real gateway status), not the stale scan.
    const launcher = {
      present: true,
      profiles: [
        profile("default", { gatewayRunning: true, model: "gpt-5.5" }),
      ],
    };
    const scanned = [profile("default", { gatewayRunning: false })];

    const result = selectSshProfiles(launcher, scanned);

    expect(result).toBe(launcher.profiles);
    expect(result[0].gatewayRunning).toBe(true);
  });

  it("prefers the launcher even when the home-directory scan has more profiles", () => {
    const launcher = { present: true, profiles: [profile("default")] };
    const scanned = [profile("default"), profile("leftover-home-profile")];

    expect(selectSshProfiles(launcher, scanned)).toBe(launcher.profiles);
  });

  it("falls back to the filesystem scan when no launcher is configured", () => {
    // Without a launcher, launcher.profiles is empty and the richer scan wins.
    const launcher = { present: false, profiles: [] };
    const scanned = [profile("default"), profile("marketing")];

    expect(selectSshProfiles(launcher, scanned)).toBe(scanned);
  });

  it("falls back to the scan when a launcher exists but returns no profiles", () => {
    const launcher = { present: true, profiles: [] };
    const scanned = [profile("default")];

    expect(selectSshProfiles(launcher, scanned)).toBe(scanned);
  });

  it("returns launcher profiles when the scan is empty", () => {
    const launcher = { present: true, profiles: [profile("default")] };

    expect(selectSshProfiles(launcher, [])).toBe(launcher.profiles);
  });
});
