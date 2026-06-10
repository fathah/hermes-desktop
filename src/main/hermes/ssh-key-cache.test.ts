import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 1.4 — prove the SSH-remote API key cache empties on clear, so a key
// fetched for one connection is never reused after a mode change / teardown.
//
// gateway-process.ts reads the connection mode from ../config; mock it to "ssh"
// so getRemoteAuthHeader reflects the cached key. The module opens no native
// deps, so this is vitest-safe.
vi.mock("../config", () => ({
  getConnectionConfig: () => ({ mode: "ssh" }),
  getApiServerKey: () => "",
  readEnv: () => ({}),
}));

vi.mock("../ssh-tunnel", () => ({
  getSshTunnelUrl: () => "http://127.0.0.1:9999",
}));

import {
  setSshRemoteApiKey,
  clearSshRemoteApiKey,
  getRemoteAuthHeader,
} from "./gateway-process";

describe("ssh-remote api key cache lifecycle", () => {
  beforeEach(() => {
    clearSshRemoteApiKey();
  });

  it("sends the cached key as a bearer header while set", () => {
    setSshRemoteApiKey("secret-key");
    expect(getRemoteAuthHeader()).toEqual({
      Authorization: "Bearer secret-key",
    });
  });

  it("stops sending the key after clear (mode change / teardown)", () => {
    setSshRemoteApiKey("secret-key");
    clearSshRemoteApiKey();
    expect(getRemoteAuthHeader()).toEqual({});
  });
});
