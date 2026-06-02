import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory model of each profile's configured api_server port. `undefined`
// profile is the default. Tests mutate this to set up scenarios.
const { configuredPorts, dirEntries } = vi.hoisted(() => ({
  configuredPorts: new Map<string, string | null>(),
  dirEntries: [] as string[],
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-test-home",
}));

vi.mock("../src/main/utils", () => ({
  normalizeProfileName: (p?: string) =>
    p === undefined || p === "" || p === "default" ? undefined : p,
}));

const setConfigValueSpy = vi.fn(
  (key: string, value: string, profile?: string) => {
    configuredPorts.set(profile ?? "default", value);
  },
);

vi.mock("../src/main/config", () => ({
  getConfigValue: (_key: string, profile?: string) =>
    configuredPorts.get(profile ?? "default") ?? null,
  setConfigValue: (key: string, value: string, profile?: string) =>
    setConfigValueSpy(key, value, profile),
}));

vi.mock("fs", () => {
  const fns = {
    existsSync: () => true,
    readdirSync: () => dirEntries,
    statSync: () => ({ isDirectory: () => true }),
  };
  return { ...fns, default: fns };
});

import {
  getProfilePort,
  DEFAULT_API_SERVER_PORT,
} from "../src/main/gateway-ports";

describe("getProfilePort", () => {
  beforeEach(() => {
    configuredPorts.clear();
    dirEntries.length = 0;
    setConfigValueSpy.mockClear();
  });

  it("pins the default profile to 8642 without touching config", () => {
    expect(getProfilePort(undefined)).toBe(DEFAULT_API_SERVER_PORT);
    expect(getProfilePort("default")).toBe(DEFAULT_API_SERVER_PORT);
    expect(setConfigValueSpy).not.toHaveBeenCalled();
  });

  it("allocates the first free port for a named profile with no configured port", () => {
    dirEntries.push("coder");
    expect(getProfilePort("coder")).toBe(8643);
  });

  it("reassigns a cloned profile that inherited the default's 8642", () => {
    dirEntries.push("coder");
    configuredPorts.set("coder", "8642");
    const port = getProfilePort("coder");
    expect(port).toBe(8643);
    expect(setConfigValueSpy).toHaveBeenCalledWith(
      "platforms.api_server.extra.port",
      "8643",
      "coder",
    );
  });

  it("keeps an already-unique configured port and does not rewrite it", () => {
    dirEntries.push("coder");
    configuredPorts.set("coder", "8650");
    expect(getProfilePort("coder")).toBe(8650);
    expect(setConfigValueSpy).not.toHaveBeenCalled();
  });

  it("avoids collisions across multiple named profiles", () => {
    dirEntries.push("a", "b");
    configuredPorts.set("a", "8643");
    // b has no port yet → must skip 8642 (default) and 8643 (a) → 8644
    expect(getProfilePort("b")).toBe(8644);
  });
});
