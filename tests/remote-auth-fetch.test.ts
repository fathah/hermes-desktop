import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFetch: vi.fn(),
  cookieGet: vi.fn(),
  conn: { current: {} as Record<string, unknown> },
}));

vi.mock("electron", () => ({
  app: { isReady: () => true },
  BrowserWindow: class {},
  net: { request: vi.fn() },
  session: {
    fromPartition: () => ({
      fetch: mocks.sessionFetch,
      cookies: { get: mocks.cookieGet },
    }),
  },
}));
vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => mocks.conn.current,
}));

import { remoteAuthFetch } from "../src/main/remote-oauth";

const URL_ = "http://dash:9119/api/skills";

describe("remoteAuthFetch", () => {
  const globalFetch = vi.fn();

  beforeEach(() => {
    mocks.sessionFetch.mockReset().mockResolvedValue(new Response("oauth"));
    mocks.cookieGet.mockReset();
    globalFetch.mockReset().mockResolvedValue(new Response("plain"));
    vi.stubGlobal("fetch", globalFetch);
  });

  it("runs in the OAuth cookie partition, including credentials, for OAuth remotes", async () => {
    mocks.conn.current = {
      mode: "remote",
      remoteAuthMode: "oauth",
      remoteUrl: "http://dash:9119",
    };
    const res = await remoteAuthFetch(URL_, { method: "POST" });
    expect(await res.text()).toBe("oauth");
    expect(mocks.sessionFetch).toHaveBeenCalledWith(
      URL_,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("uses plain fetch with the caller's headers for token remotes", async () => {
    mocks.conn.current = {
      mode: "remote",
      remoteAuthMode: "token",
      remoteUrl: "http://dash:9119",
    };
    await remoteAuthFetch(URL_, { headers: { Authorization: "Bearer t" } });
    expect(globalFetch).toHaveBeenCalledWith(URL_, {
      headers: { Authorization: "Bearer t" },
    });
    expect(mocks.sessionFetch).not.toHaveBeenCalled();
  });

  it("uses plain fetch outside direct Remote mode", async () => {
    mocks.conn.current = { mode: "local" };
    await remoteAuthFetch(URL_);
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(mocks.sessionFetch).not.toHaveBeenCalled();
  });

  it("in auto mode picks the OAuth session only when signed in", async () => {
    mocks.conn.current = {
      mode: "remote",
      remoteAuthMode: "auto",
      remoteUrl: "http://dash:9119",
    };
    mocks.cookieGet.mockResolvedValueOnce([{ name: "hermes_session_at" }]);
    await remoteAuthFetch(URL_);
    expect(mocks.sessionFetch).toHaveBeenCalledTimes(1);

    mocks.cookieGet.mockResolvedValueOnce([]);
    await remoteAuthFetch(URL_);
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });
});
