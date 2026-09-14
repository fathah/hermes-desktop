// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for the Hermes One convenience layer: auto-provisioning the
// HERMESONE_API_KEY from the signed-in account and reading the credit
// balance. Account store, env store, and fetch are all faked — no real
// HERMES_HOME or network.

const state = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  accountProfile: "default" as string | null,
  apiUrl: "https://backend.test",
  token: "session-token" as string | null,
  envWrites: [] as Array<{ key: string; value: string; profile?: string }>,
}));

vi.mock("./account-store", () => ({
  findAccountProfile: () => state.accountProfile,
  getAccount: () =>
    state.accountProfile !== null
      ? { apiUrl: state.apiUrl, user: { id: "u1" } }
      : null,
  getAccessToken: () => state.token,
}));

vi.mock("./hermes-account", () => ({
  apiHeaders: (json = true) =>
    json ? { "content-type": "application/json" } : {},
}));

vi.mock("./config", () => ({
  readEnv: () => state.env,
  setEnvValue: (key: string, value: string, profile?: string) => {
    state.envWrites.push({ key, value, profile });
    state.env[key] = value;
  },
}));

const fetchMock = vi.fn();

async function mod(): Promise<typeof import("./hermesone-provision")> {
  return import("./hermesone-provision");
}

describe("hermesone provisioning", () => {
  beforeEach(() => {
    state.env = {};
    state.accountProfile = "default";
    state.token = "session-token";
    state.envWrites = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // @lat: [[hermes-account-login#Hermes One account login#Auto-provisioned inference key and credits#Issues a key only when missing]]
  it("keeps an existing HERMESONE_API_KEY without touching the backend", async () => {
    state.env["HERMESONE_API_KEY"] = "hs-live-already";
    const m = await mod();
    expect(await m.ensureHermesOneApiKey("default")).toEqual({
      status: "exists",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.envWrites).toEqual([]);
  });

  it("reports signed-out (and stays offline) with no account", async () => {
    state.accountProfile = null;
    const m = await mod();
    expect(await m.ensureHermesOneApiKey("default")).toEqual({
      status: "signed-out",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // @lat: [[hermes-account-login#Hermes One account login#Auto-provisioned inference key and credits#Provisions and persists a fresh key]]
  it("issues a key from the backend and persists it to the profile env", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ key: "hs-live-fresh" }), { status: 200 }),
    );
    const m = await mod();
    expect(await m.ensureHermesOneApiKey("coder")).toEqual({
      status: "created",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://backend.test/api/credits/keys");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer session-token",
    );
    // The console key list shows this name so users know its origin.
    expect(JSON.parse(String(init.body)).name).toMatch(/^Hermes Desktop /);

    expect(state.envWrites).toEqual([
      { key: "HERMESONE_API_KEY", value: "hs-live-fresh", profile: "coder" },
    ]);
  });

  it("surfaces backend failures without writing anything", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const m = await mod();
    const result = await m.ensureHermesOneApiKey("default");
    expect(result.status).toBe("error");
    expect(state.envWrites).toEqual([]);
  });

  // @lat: [[hermes-account-login#Hermes One account login#Auto-provisioned inference key and credits#Single-flight provisioning]]
  it("coalesces concurrent ensure calls into one backend key", async () => {
    let resolveFetch!: (r: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const m = await mod();
    const a = m.ensureHermesOneApiKey("default");
    const b = m.ensureHermesOneApiKey("default");
    resolveFetch(
      new Response(JSON.stringify({ key: "hs-live-once" }), { status: 200 }),
    );
    expect(await a).toEqual({ status: "created" });
    expect(await b).toEqual({ status: "created" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.envWrites).toHaveLength(1);
  });

  it("does not share a flight across profiles — each gets its own key", async () => {
    // Review regression: a global single-flight latch let profile B piggyback
    // on profile A's provisioning and report `created` while only A's `.env`
    // received a key.
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ key: `hs-live-${fetchMock.mock.calls.length}` }),
          { status: 200 },
        ),
    );
    const m = await mod();
    const [a, b] = await Promise.all([
      m.ensureHermesOneApiKey("alpha"),
      m.ensureHermesOneApiKey("beta"),
    ]);
    expect(a).toEqual({ status: "created" });
    expect(b).toEqual({ status: "created" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.envWrites.map((w) => w.profile).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  // @lat: [[hermes-account-login#Hermes One account login#Auto-provisioned inference key and credits#Credits for the account card]]
  it("fetches the credit balance for the signed-in account", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ balance: 12.5 }), { status: 200 }),
    );
    const m = await mod();
    expect(await m.fetchHermesOneCredits()).toEqual({ balance: 12.5 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://backend.test/api/credits/balance?limit=1");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer session-token",
    );
  });

  it("returns a null balance when signed out or on bad payloads", async () => {
    state.accountProfile = null;
    const m = await mod();
    expect((await m.fetchHermesOneCredits()).balance).toBe(null);

    state.accountProfile = "default";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ balance: "not-a-number" }), {
        status: 200,
      }),
    );
    vi.resetModules();
    const m2 = await mod();
    expect((await m2.fetchHermesOneCredits()).balance).toBe(null);
  });
});
