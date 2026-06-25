import { EventEmitter } from "events";
import { execFileSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: mockSpawn,
    default: { ...actual, spawn: mockSpawn },
  };
});

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
  sshDiscoverMemoryProviders,
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

function makeSshProcess(
  stdoutText: string,
  onStdin?: (input?: string) => void,
): EventEmitter & {
  stdout: EventEmitter & { setEncoding: (encoding: string) => void };
  stderr: EventEmitter & { setEncoding: (encoding: string) => void };
  stdin: { end: (input?: string) => void };
  kill: (signal?: string) => void;
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: (encoding: string) => void };
    stderr: EventEmitter & { setEncoding: (encoding: string) => void };
    stdin: { end: (input?: string) => void };
    kill: (signal?: string) => void;
  };
  proc.stdout = new EventEmitter() as EventEmitter & {
    setEncoding: (encoding: string) => void;
  };
  proc.stderr = new EventEmitter() as EventEmitter & {
    setEncoding: (encoding: string) => void;
  };
  proc.stdout.setEncoding = vi.fn();
  proc.stderr.setEncoding = vi.fn();
  proc.kill = vi.fn();
  proc.stdin = {
    end: (input?: string) => {
      onStdin?.(input);
      queueMicrotask(() => {
        if (stdoutText) proc.stdout.emit("data", stdoutText);
        proc.emit("close", 0);
      });
    },
  };
  return proc;
}

function runWithHermesShim(command: string): Buffer {
  const home = mkdtempSync(join(tmpdir(), "hermes-ssh-cmd-home-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const hermes = join(bin, "hermes");
  writeFileSync(
    hermes,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "doctor" ]; then',
      '  printf "doctor stderr preserved\\n" >&2',
      "  exit 0",
      "fi",
      'printf "%s\\0" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(hermes, 0o755);
  return execFileSync("bash", ["-lc", command], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH || ""}`,
    },
  });
}

function parseNulArgs(output: Buffer): string[] {
  const parts = output.toString("utf8").split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

beforeEach(() => {
  mockSpawn.mockReset();
});

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

describe("ssh memory provider discovery", () => {
  it("discovers recall-sqlite metadata and active state over SSH", async () => {
    const discoveredProviders = [
      {
        name: "recall-sqlite",
        description: "memory.providers.recall-sqlite",
        envVars: [],
        installed: true,
        active: true,
      },
    ];
    let discoveryScript = "";

    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const remoteCommand = args.at(-1) || "";
      if (remoteCommand === "python3 -") {
        return makeSshProcess(
          `${JSON.stringify(discoveredProviders)}\n`,
          (input) => {
            discoveryScript = String(input || "");
          },
        );
      }
      return makeSshProcess("memory:\n  provider: recall-sqlite\n");
    });

    const providers = await sshDiscoverMemoryProviders(sshConfig);

    expect(providers).toContainEqual({
      name: "recall-sqlite",
      description: "memory.providers.recall-sqlite",
      installed: true,
      active: true,
      envVars: [],
    });
    expect(discoveryScript).toContain('"recall-sqlite"');
    expect(discoveryScript).toContain("memory.providers.recall-sqlite");
  });
});

describe("ssh Hermes command quoting", () => {
  it("shell-quotes the whole bash script without dropping per-argument quoting", () => {
    const command = buildRemoteHermesCmd([
      "kanban",
      "create",
      "My task title",
      "--triage",
      "--json",
    ]);

    expect(command).not.toContain(
      "bash -c '[ -x $HOME/hermes-agent/.venv/bin/hermes ] && exec $HOME/hermes-agent/.venv/bin/hermes 'kanban' 'create'",
    );
    expect(command).toContain(
      `$HOME/hermes-agent/.venv/bin/hermes '"'"'kanban'"'"'`,
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
  ])("preserves %s", (_name, expectedArgs) => {
    const command = buildRemoteHermesCmd(expectedArgs);
    expect(parseNulArgs(runWithHermesShim(command))).toEqual(expectedArgs);
  });

  it("preserves existing extraShell redirects", () => {
    const output = runWithHermesShim(
      buildRemoteHermesCmd(["doctor"], " 2>&1"),
    ).toString("utf8");
    expect(output).toBe("doctor stderr preserved\n");
  });
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

  it("marks default active and normalizes empty model output", () => {
    const profiles = parseHermesProfileListOutput(`
 Profile          Model       Gateway
 default          —           running
 marketing        gpt-5.5     stopped
`);

    expect(profiles.find((p) => p.name === "default")?.isActive).toBe(true);
    expect(profiles.find((p) => p.name === "default")?.model).toBe("");
    expect(profiles.find((p) => p.name === "marketing")?.isActive).toBe(false);
  });
});
