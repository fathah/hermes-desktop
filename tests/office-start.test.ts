import { describe, expect, it } from "vitest";

import {
  startOfficeStack,
  type OfficeStartDependencies,
} from "../src/main/office-start";
import type { ConnectionConfig } from "../src/main/config";

function localConnection(): ConnectionConfig {
  return {
    mode: "local",
    remoteUrl: "",
    apiKey: "",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    },
  };
}

function sshConnection(): ConnectionConfig {
  return {
    ...localConnection(),
    mode: "ssh",
    ssh: {
      host: "office.example.com",
      port: 22,
      username: "hermes",
      keyPath: "C:\\keys\\id_rsa",
      remotePort: 8642,
      localPort: 18642,
    },
  };
}

function makeDeps(
  connection: ConnectionConfig,
  overrides: Partial<OfficeStartDependencies> = {},
): { calls: string[]; deps: OfficeStartDependencies } {
  const calls: string[] = [];
  const deps: OfficeStartDependencies = {
    getConnectionConfig: () => connection,
    isGatewayRunning: () => false,
    startGateway: (profile) => {
      calls.push(`startGateway:${profile ?? ""}`);
      return true;
    },
    sshGatewayStatus: async () => false,
    sshStartGateway: async () => {
      calls.push("sshStartGateway");
    },
    startSshTunnel: async () => {
      calls.push("startSshTunnel");
    },
    sshReadRemoteApiKey: async () => "remote-key",
    setSshRemoteApiKey: (key) => {
      calls.push(`setSshRemoteApiKey:${key}`);
    },
    startClaw3dAll: () => {
      calls.push("startClaw3dAll");
      return { success: true };
    },
    ...overrides,
  };
  return { calls, deps };
}

describe("startOfficeStack", () => {
  it("starts the local gateway with the active profile before Claw3D", async () => {
    const { calls, deps } = makeDeps(localConnection());

    const result = await startOfficeStack("research", deps);

    expect(result).toEqual({ success: true });
    expect(calls).toEqual(["startGateway:research", "startClaw3dAll"]);
  });

  it("does not restart a local gateway that is already running", async () => {
    const { calls, deps } = makeDeps(localConnection(), {
      isGatewayRunning: () => true,
    });

    const result = await startOfficeStack("research", deps);

    expect(result).toEqual({ success: true });
    expect(calls).toEqual(["startClaw3dAll"]);
  });

  it("starts the SSH gateway and tunnel before Claw3D", async () => {
    const { calls, deps } = makeDeps(sshConnection());

    const result = await startOfficeStack("research", deps);

    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      "sshStartGateway",
      "startSshTunnel",
      "setSshRemoteApiKey:remote-key",
      "startClaw3dAll",
    ]);
  });
});
