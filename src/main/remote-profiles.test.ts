import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";
const state = vi.hoisted(() => ({
  connection: {} as ConnectionConfig,
  request: vi.fn(),
  probe: vi.fn(),
  meta: vi.fn(),
  config: {} as Record<string, unknown>,
  write: vi.fn(),
}));
vi.mock("./config", () => ({
  getConnectionConfig: () => state.connection,
  readDesktopConfig: () => state.config,
  writeDesktopConfig: (data: Record<string, unknown>) => {
    state.write(data);
    state.config = data;
  },
}));
vi.mock("./remote-oauth", () => ({ probeRemoteAuthMode: state.probe }));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: state.request }));
vi.mock("./profile-meta", () => ({ readProfileMeta: state.meta }));
import { remoteCreateProfile, remoteListProfiles } from "./remote-profiles";
import {
  getRemoteSelectedProfile,
  setRemoteSelectedProfile,
} from "./remote-profile-selection";
import {
  beginProviderAuthChange,
  finishProviderAuthChange,
} from "./provider-request-target";

beforeEach(() => {
  state.connection = {
    mode: "remote",
    remoteUrl: "https://a.test",
    remoteAuthMode: "token",
    apiKey: "secret-a",
  } as ConnectionConfig;
  state.request.mockReset();
  state.probe.mockReset();
  state.meta.mockReset();
  state.config = { otherPreference: true };
  state.write.mockReset();
  vi.unstubAllGlobals();
});
describe("Remote profile contract", () => {
  // @lat: [[remote-profiles#Tests#Server profiles stay separate from local metadata]]
  it("maps the server's list and never reads a same-named desktop profile", async () => {
    state.request.mockResolvedValue({
      profiles: [
        { name: "default", is_default: true, skill_count: 3 },
        { name: "work", display_name: "Remote Work", gateway_running: true },
      ],
    });
    const profiles = await remoteListProfiles("work");
    expect(profiles.map((p) => [p.id, p.isActive, p.isDefault])).toEqual([
      ["default", false, true],
      ["work", true, false],
    ]);
    expect(profiles[1]).toMatchObject({
      name: "Remote Work",
      avatar: null,
      gatewayRunning: true,
    });
    expect(state.meta).not.toHaveBeenCalled();
  });
  // @lat: [[remote-profiles#Tests#Creation acknowledgement and input validation]]
  it("requires an exact server acknowledgement and validates both profile names", async () => {
    state.request.mockResolvedValue({ ok: true, name: "new-one" });
    expect(await remoteCreateProfile("new-one", "default")).toEqual({
      success: true,
      id: "new-one",
    });
    expect(state.request.mock.calls[0][2]).toEqual({
      method: "POST",
      body: { name: "new-one", clone_from: "default" },
    });
    state.request.mockClear();
    expect((await remoteCreateProfile("../x", null)).success).toBe(false);
    expect((await remoteCreateProfile("valid", "../source")).success).toBe(
      false,
    );
    expect(state.request).not.toHaveBeenCalled();
    state.request.mockResolvedValue({ ok: true });
    expect((await remoteCreateProfile("valid", null)).success).toBe(false);
  });
  // @lat: [[remote-profiles#Tests#Missing saved selections stay unresolved]]
  it("rejects invalid lists and leaves all profiles inactive when the saved selection disappears", async () => {
    state.request.mockResolvedValue({
      profiles: [{ name: "default" }, { name: "work" }],
    });
    expect((await remoteListProfiles("gone")).map((p) => p.isActive)).toEqual([
      false,
      false,
    ]);
    expect(state.write).not.toHaveBeenCalled();
    state.request.mockResolvedValue({ success: true });
    await expect(remoteListProfiles("default")).rejects.toThrow("invalid");
  });
  // @lat: [[remote-profiles#Tests#Captured authentication admission]]
  it("keeps an admitted request on its immutable target and rejects an account change during auto probing", async () => {
    let resolve!: (value: unknown) => void;
    state.connection.remoteAuthMode = "auto";
    state.probe.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const captured = structuredClone(state.connection);
    const request = remoteCreateProfile("new-one", null, captured);
    state.connection.remoteUrl = "https://b.test";
    beginProviderAuthChange(captured.remoteUrl);
    finishProviderAuthChange(captured.remoteUrl);
    resolve({ authMode: "oauth" });
    expect((await request).success).toBe(false);
    expect(state.request).not.toHaveBeenCalled();
    state.request.mockResolvedValue({ profiles: [{ name: "work" }] });
    captured.remoteAuthMode = "token";
    await remoteListProfiles("work", captured);
    expect(state.request.mock.calls[0][0].remoteUrl).toBe("https://a.test");
  });
  // @lat: [[remote-profiles#Tests#Anonymous dashboard boundary]]
  it("supports explicitly anonymous dashboards without converting malformed successful HTML into creation", async () => {
    state.connection.apiKey = "";
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, name: "work" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect((await remoteCreateProfile("work", null)).success).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe("https://a.test/api/profiles");
    fetcher.mockResolvedValue(
      new Response("<html>login</html>", { status: 200 }),
    );
    expect((await remoteCreateProfile("work", null)).success).toBe(false);
    state.connection.remoteAuthMode = "oauth";
    state.request.mockResolvedValue({ profiles: [{ name: "work" }] });
    await remoteListProfiles("work");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  // @lat: [[remote-profiles#Tests#Desktop preference ownership]]
  it("persists the Remote selection by connection and URL while preserving other desktop preferences", () => {
    setRemoteSelectedProfile("a", state.connection, "work");
    expect(getRemoteSelectedProfile("a", state.connection)).toBe("work");
    expect(getRemoteSelectedProfile("b", state.connection)).toBe("default");
    expect(
      getRemoteSelectedProfile("a", {
        ...state.connection,
        remoteUrl: "https://b.test",
      }),
    ).toBe("default");
    expect(state.config.otherPreference).toBe(true);
    expect(() =>
      setRemoteSelectedProfile("a", state.connection, "../x"),
    ).toThrow();
    expect(state.write).toHaveBeenCalledTimes(1);
  });
  // @lat: [[remote-profiles#Tests#Anonymous URL normalization]]
  it.each([
    "https://a.test/v1",
    "https://a.test/api",
    "https://a.test?old=1#view",
  ])(
    "normalizes anonymous profile GET and POST requests for %s",
    async (remoteUrl) => {
      state.connection.apiKey = "";
      state.connection.remoteUrl = remoteUrl;
      const fetcher = vi
        .fn()
        .mockImplementation(async (_url, options) =>
          Response.json(
            options.method === "GET"
              ? { profiles: [{ name: "default" }] }
              : { ok: true, name: "work" },
          ),
        );
      vi.stubGlobal("fetch", fetcher);
      await remoteListProfiles("default");
      expect(await remoteCreateProfile("work", null)).toMatchObject({
        success: true,
      });
      expect(
        fetcher.mock.calls.map((call) => [call[0], call[1].method]),
      ).toEqual([
        ["https://a.test/api/profiles", "GET"],
        ["https://a.test/api/profiles", "POST"],
      ]);
    },
  );
  // @lat: [[remote-profiles#Tests#Anonymous reverse proxy authentication]]
  it("preserves encoded Basic proxy credentials without putting userinfo in fetch URLs", async () => {
    state.connection.apiKey = "";
    state.connection.remoteUrl =
      "https://proxy%20user:p%40ss%3Aword@a.test/api?old=1";
    const fetcher = vi.fn().mockImplementation(async (url, options) => {
      // Node fetch rejects URL userinfo before sending the request.
      const parsed = new URL(url);
      expect(parsed.username).toBe("");
      expect(parsed.password).toBe("");
      expect(options.headers.Authorization).toBe(
        `Basic ${Buffer.from("proxy user:p@ss:word").toString("base64")}`,
      );
      return Response.json(
        options.method === "GET"
          ? { profiles: [{ name: "default" }] }
          : { ok: true, name: "work" },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await remoteListProfiles("default");
    expect(await remoteCreateProfile("work", null)).toMatchObject({
      success: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
