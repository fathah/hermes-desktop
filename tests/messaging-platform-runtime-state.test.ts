import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-platform-state-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

vi.mock("../src/main/utils", () => ({
  profileHome: (profile?: string) =>
    profile && profile !== "default"
      ? join(TEST_HOME, "profiles", profile)
      : TEST_HOME,
}));

import { readLocalGatewayPlatformStates } from "../src/main/messaging-platforms";

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe("readLocalGatewayPlatformStates", () => {
  it("ignores stale gateway state when the gateway is not running", () => {
    writeFileSync(
      join(TEST_HOME, "gateway_state.json"),
      JSON.stringify({
        pid: 12345,
        gateway_state: "running",
        platforms: { telegram: { state: "connected" } },
      }),
    );

    expect(readLocalGatewayPlatformStates(undefined, false)).toEqual({});
  });

  it("trusts the caller-provided gateway liveness state", () => {
    writeFileSync(
      join(TEST_HOME, "gateway_state.json"),
      JSON.stringify({
        pid: 99999,
        gateway_state: "running",
        platforms: { telegram: { state: "connected" } },
      }),
    );

    expect(readLocalGatewayPlatformStates(undefined, true)).toMatchObject({
      telegram: { state: "connected" },
    });
  });

  it("returns live platform states and aliases known platform keys", () => {
    writeFileSync(
      join(TEST_HOME, "gateway_state.json"),
      JSON.stringify({
        pid: 12345,
        gateway_state: "running",
        platforms: {
          telegram: { state: "connected", updated_at: "now" },
          webhook: { state: "running" },
        },
      }),
    );

    expect(readLocalGatewayPlatformStates(undefined, true)).toMatchObject({
      telegram: { state: "connected", updated_at: "now" },
      webhook: { state: "running" },
      webhooks: { state: "running" },
    });
  });

  it("reads the root gateway state when the active profile is default", () => {
    writeFileSync(
      join(TEST_HOME, "gateway_state.json"),
      JSON.stringify({
        pid: 12345,
        gateway_state: "running",
        platforms: { telegram: { state: "connected" } },
      }),
    );

    expect(readLocalGatewayPlatformStates("default", true)).toMatchObject({
      telegram: { state: "connected" },
    });
  });
});
