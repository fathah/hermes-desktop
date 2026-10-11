import { describe, expect, it } from "vitest";
import {
  buildGatewayStartCommand,
  buildGatewayStatusCommand,
  buildGatewayStopCommand,
  sshResolveDashboardPort,
} from "./ssh-remote";
import type { SshConfig } from "./ssh-tunnel";

const dummySsh: SshConfig = {
  host: "h",
  port: 22,
  username: "u",
  keyPath: "",
  remotePort: 8642,
  localPort: 18642,
};

describe("SSH remote profile gateway commands", () => {
  it("uses the default systemd-aware gateway command for the default profile", () => {
    const command = buildGatewayStartCommand();

    expect(command).toContain("systemctl start hermes.service");
    // Default profile resolves the CLI via the venv/launcher probe in the
    // non-systemd branch (not bare `hermes`), so it works when `hermes` is not
    // on the non-interactive SSH PATH.
    expect(command).toContain("venv/bin/hermes");
    expect(command).not.toContain("--profile");
  });

  it("launches the gateway with `run`, not the service-only `start`", () => {
    // `gateway start` drives the systemd/launchd service and fails with
    // "Gateway service is not installed" on a bare VPS; `gateway run` launches
    // the gateway (and its api_server) directly. The systemd branch still uses
    // `systemctl start`, but the CLI invocation must never be `gateway start`.
    // CLI args are shell-quoted individually, so the invocation appears as the
    // quoted token `'run'` (never the service-only `'start'`). The systemd
    // branch's `systemctl start` is unquoted and unaffected.
    const command = buildGatewayStartCommand();
    expect(command).toContain("'run'");
    expect(command).not.toContain("'start'");

    const named = buildGatewayStartCommand("research");
    expect(named).toContain("'run'");
    expect(named).not.toContain("'start'");
  });

  it("targets the named profile gateway pid and CLI flag", () => {
    const start = buildGatewayStartCommand("research");
    const status = buildGatewayStatusCommand("research");
    const stop = buildGatewayStopCommand("research");

    expect(start).toContain("$HOME/.hermes/profiles/research");
    expect(start).toContain("--profile");
    expect(start).toContain("research");
    expect(status).toContain("$HOME/.hermes/profiles/research/gateway.pid");
    expect(stop).toContain("$HOME/.hermes/profiles/research/gateway.pid");
  });
});

describe("SSH dashboard transport", () => {
  it("resolves the default profile dashboard port to 9119 without SSH", async () => {
    // Default profile returns the fixed dashboard port synchronously (no remote
    // round-trip), so the desktop tunnels to the right port even before any
    // gateway/dashboard call.
    await expect(sshResolveDashboardPort(dummySsh)).resolves.toBe(9119);
    await expect(sshResolveDashboardPort(dummySsh, "default")).resolves.toBe(
      9119,
    );
  });
});
