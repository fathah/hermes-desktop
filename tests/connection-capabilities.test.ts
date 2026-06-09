import { describe, it, expect, beforeEach, vi } from "vitest";

let currentMode: "local" | "remote" | "ssh" = "local";

vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({
    mode: currentMode,
    remoteUrl: "",
    apiKey: "",
    ssh: {},
  }),
}));

import {
  CONNECTION_CAPABILITIES,
  supportsCapability,
  requireCapability,
  dualHandlerTarget,
  UnsupportedConnectionModeError,
  type Capability,
} from "../src/main/connection-capabilities";

const ALL_CAPS = Object.keys(CONNECTION_CAPABILITIES) as Capability[];

describe("connection capability matrix", () => {
  beforeEach(() => {
    currentMode = "local";
  });

  it("workspaceFiles + memoryWrite are local-only", () => {
    for (const cap of ["workspaceFiles", "memoryWrite"] as const) {
      expect(supportsCapability(cap, "local")).toBe(true);
      expect(supportsCapability(cap, "ssh")).toBe(false);
      expect(supportsCapability(cap, "remote")).toBe(false);
    }
  });

  it("dual-mode capabilities work over local and ssh, never remote", () => {
    for (const cap of [
      "memoryRead",
      "sessions",
      "skillsInstall",
      "toolsets",
    ] as const) {
      expect(supportsCapability(cap, "local")).toBe(true);
      expect(supportsCapability(cap, "ssh")).toBe(true);
      expect(supportsCapability(cap, "remote")).toBe(false);
    }
  });

  it("remote-URL mode implements none of the matrix capabilities", () => {
    for (const cap of ALL_CAPS) {
      expect(supportsCapability(cap, "remote")).toBe(false);
    }
  });

  it("every capability is at least supported locally (local-first invariant)", () => {
    for (const cap of ALL_CAPS) {
      expect(supportsCapability(cap, "local")).toBe(true);
    }
  });

  it("supportsCapability defaults to the active connection mode", () => {
    currentMode = "ssh";
    expect(supportsCapability("workspaceFiles")).toBe(false);
    expect(supportsCapability("sessions")).toBe(true);
    currentMode = "local";
    expect(supportsCapability("workspaceFiles")).toBe(true);
  });

  it("requireCapability is a no-op when the active mode supports it", () => {
    currentMode = "local";
    expect(() => requireCapability("workspaceFiles")).not.toThrow();
    currentMode = "ssh";
    expect(() => requireCapability("sessions")).not.toThrow();
  });

  it("requireCapability throws UnsupportedConnectionModeError otherwise", () => {
    currentMode = "ssh";
    expect(() => requireCapability("workspaceFiles")).toThrow(
      UnsupportedConnectionModeError,
    );
    try {
      requireCapability("workspaceFiles");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedConnectionModeError);
      expect((e as UnsupportedConnectionModeError).mode).toBe("ssh");
    }
  });
});

describe("dualHandlerTarget (registerDualHandler routing)", () => {
  it("routes local mode to the local implementation", () => {
    expect(dualHandlerTarget({ mode: "local" })).toBe("local");
  });

  it("routes ssh mode (with ssh config) to the ssh implementation", () => {
    expect(dualHandlerTarget({ mode: "ssh", ssh: { host: "h" } })).toBe("ssh");
  });

  it("falls back to local when ssh mode has no ssh config", () => {
    expect(dualHandlerTarget({ mode: "ssh", ssh: undefined })).toBe("local");
  });

  it("flags remote mode as unsupported instead of silently using local", () => {
    // The bug this fixes: remote previously fell through to the local impl,
    // returning LOCAL data over a remote connection.
    expect(dualHandlerTarget({ mode: "remote" })).toBe("remote-unsupported");
  });
});
