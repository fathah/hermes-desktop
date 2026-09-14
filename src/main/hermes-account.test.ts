// @vitest-environment node
// @lat: [[hermes-account-login#Tests]]

import { afterEach, describe, expect, it, vi } from "vitest";

// account-store (imported transitively) pulls in electron + installer; stub them
// so this suite can focus on the pure polling logic.
vi.mock("./installer", () => ({
  get HERMES_HOME() {
    return "/tmp/hermes-noop";
  },
}));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (v: string) => Buffer.from(v),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

import {
  apiHeaders,
  getApiUrl,
  interpretTokenResponse,
} from "./hermes-account";

describe("interpretTokenResponse", () => {
  it("returns success with a normalized user when a token is present", () => {
    const action = interpretTokenResponse(true, 200, {
      access_token: "tok",
      user: { id: "u1", email: "a@b.com", name: "Ada" },
    });
    expect(action).toEqual({
      kind: "success",
      accessToken: "tok",
      user: { id: "u1", email: "a@b.com", name: "Ada", avatarUrl: null },
    });
  });

  it("keeps polling on authorization_pending", () => {
    expect(
      interpretTokenResponse(false, 400, { error: "authorization_pending" }),
    ).toEqual({ kind: "pending" });
  });

  it("backs off on slow_down", () => {
    expect(interpretTokenResponse(false, 400, { error: "slow_down" })).toEqual({
      kind: "slow_down",
    });
  });

  it("surfaces denial and expiry as terminal errors", () => {
    expect(
      interpretTokenResponse(false, 400, { error: "access_denied" }).kind,
    ).toBe("error");
    expect(
      interpretTokenResponse(false, 400, { error: "expired_token" }).kind,
    ).toBe("error");
  });

  it("treats an unknown error as terminal", () => {
    const action = interpretTokenResponse(false, 500, { error: "boom" });
    expect(action.kind).toBe("error");
    if (action.kind === "error") expect(action.error).toContain("boom");
  });
});

describe("getApiUrl", () => {
  const original = process.env.HERMES_API_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.HERMES_API_URL;
    else process.env.HERMES_API_URL = original;
    vi.unstubAllEnvs();
  });

  it("defaults to the local Nitro dev server", () => {
    delete process.env.HERMES_API_URL;
    expect(getApiUrl()).toBe("http://localhost:3002");
  });

  it("uses HERMES_API_URL when set, trimming trailing slashes", () => {
    process.env.HERMES_API_URL = "https://api.hermes.example/";
    expect(getApiUrl()).toBe("https://api.hermes.example");
  });

  it("reads MAIN_VITE_HERMES_API_URL from the environment, trimming slashes", () => {
    delete process.env.HERMES_API_URL;
    // stubEnv sets both process.env (dev/.env) and import.meta.env (baked).
    vi.stubEnv("MAIN_VITE_HERMES_API_URL", "https://api.hermesone.org/");
    expect(getApiUrl()).toBe("https://api.hermesone.org");

    // The explicit HERMES_API_URL override still wins.
    process.env.HERMES_API_URL = "http://localhost:9999";
    expect(getApiUrl()).toBe("http://localhost:9999");
  });

  it("upgrades a remote http:// URL to https:// but leaves localhost alone", () => {
    // Remote http → https: else the http→https redirect strips the bearer and
    // authenticated sync calls 401 (device login survives, being anonymous).
    process.env.HERMES_API_URL = "http://api.hermesone.org";
    expect(getApiUrl()).toBe("https://api.hermesone.org");

    // Localhost dev backend stays http.
    process.env.HERMES_API_URL = "http://localhost:3002";
    expect(getApiUrl()).toBe("http://localhost:3002");
    process.env.HERMES_API_URL = "http://127.0.0.1:3002/";
    expect(getApiUrl()).toBe("http://127.0.0.1:3002");
  });
});

describe("apiHeaders", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("omits x-api-key when no client key is configured", () => {
    expect(apiHeaders()).toEqual({ "content-type": "application/json" });
    expect(apiHeaders(false)).toEqual({});
  });

  it("sends the baked client key as x-api-key", () => {
    vi.stubEnv("MAIN_VITE_HERMES_API_KEY", "client-key");
    expect(apiHeaders(false)).toEqual({ "x-api-key": "client-key" });
  });
});
