// @vitest-environment node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileInfo } from "./profiles";

// The sync engine's fs/profile/config surface is faked so the tests exercise
// the reconciliation logic (linking, part decisions, state files) without a
// real HERMES_HOME, CLI, or keychain.

const mockState = vi.hoisted(() => ({
  home: "",
  failHistoryWrite: false,
  deleteFailure: false,
  deletedProfiles: [] as string[],
  colorPending: null as Promise<void> | null,
  colorFailure: false,
  profiles: [] as unknown[],
  souls: new Map<string, string>(),
  memories: new Map<string, string>(),
  models: new Map<
    string,
    { model: string; provider: string; baseUrl: string }
  >(),
  account: null as { apiUrl: string; token: string; userId?: string } | null,
  createdProfiles: [] as string[],
  writtenSouls: [] as Array<{ profile: string; content: string }>,
  writtenMemories: [] as Array<{ profile: string; content: string }>,
  writtenColors: [] as Array<{ profile: string; color: string }>,
  writtenModels: [] as Array<{
    profile?: string;
    model: string;
    provider: string;
  }>,
}));

vi.mock("./utils", () => ({
  isValidNamedProfileName: (name: unknown) =>
    typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name),
  profileHome: (profile?: string) =>
    !profile || profile === "default"
      ? mockState.home
      : join(mockState.home, "profiles", profile),
  safeWriteFile: (path: string, content: string) => {
    if (mockState.failHistoryWrite && path.endsWith("cloud-sync-deleted.json"))
      throw new Error("disk full");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
  },
}));

vi.mock("./account-store", () => ({
  findAccountProfile: () => (mockState.account ? "default" : null),
  getAccount: () =>
    mockState.account
      ? {
          apiUrl: mockState.account.apiUrl,
          user: {
            id: mockState.account.userId ?? "u1",
            email: "a@b.com",
            name: null,
            avatarUrl: null,
          },
        }
      : null,
  getAccessToken: () => mockState.account?.token ?? null,
}));

vi.mock("./profiles", () => ({
  listProfiles: async () => mockState.profiles,
  deleteProfile: (name: string) => {
    mockState.deletedProfiles.push(name);
    if (mockState.deleteFailure)
      return { success: false, error: "profile is busy" };
    rmSync(join(mockState.home, "profiles", name), {
      recursive: true,
      force: true,
    });
    mockState.profiles = (mockState.profiles as ProfileInfo[]).filter(
      (p) => p.id !== name,
    );
    return { success: true };
  },
  // Mirror the real createProfile: derive a slug id from the display name and
  // return it; on-disk sync keys off that id, not the name.
  createProfile: (name: string) => {
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    mockState.createdProfiles.push(id);
    return { success: true, id };
  },
}));

vi.mock("./profile-meta", () => ({
  readProfileMeta: async () => ({}),
  defaultColorForName: () => "#123456",
  setProfileColor: async (profile: string, color: string) => {
    if (mockState.colorPending) await mockState.colorPending;
    if (mockState.colorFailure)
      return { success: false, error: "color write failed" };
    mockState.writtenColors.push({ profile, color });
    return { success: true };
  },
}));

vi.mock("./soul", () => ({
  readSoul: (profile?: string) =>
    mockState.souls.get(profile ?? "default") ?? "",
  writeSoul: (content: string, profile?: string) => {
    mockState.writtenSouls.push({ profile: profile ?? "default", content });
    return true;
  },
}));

vi.mock("./memory", () => ({
  readMemoryRaw: (profile?: string) =>
    mockState.memories.get(profile ?? "default") ?? "",
  writeMemoryRaw: (content: string, profile?: string) => {
    mockState.writtenMemories.push({ profile: profile ?? "default", content });
    return { success: true };
  },
}));

vi.mock("./config", () => ({
  getModelConfig: (profile?: string) =>
    mockState.models.get(profile ?? "default") ?? {
      model: "",
      provider: "auto",
      baseUrl: "",
    },
  setModelConfig: (
    provider: string,
    model: string,
    _baseUrl: string,
    profile?: string,
  ) => {
    mockState.writtenModels.push({ profile, model, provider });
  },
}));

function fakeProfile(name: string, color = "#123456", id = name): ProfileInfo {
  return {
    id,
    name,
    // The on-disk directory is keyed by the stable id, not the display name.
    path:
      id === "default" ? mockState.home : join(mockState.home, "profiles", id),
    isDefault: id === "default",
    isActive: false,
    model: "",
    provider: "auto",
    hasEnv: false,
    hasSoul: true,
    skillCount: 0,
    gatewayRunning: false,
    color,
    avatar: null,
  };
}

type RemoteAgent = {
  id: string;
  name: string;
  color: string;
  systemPrompt: string | null;
  memory: string | null;
  model: string;
  provider: string;
  updatedAt: string;
};

function remoteAgent(
  overrides: Partial<RemoteAgent> & { id: string; name: string },
): RemoteAgent {
  return {
    color: "#123456",
    systemPrompt: null,
    memory: null,
    model: "anthropic/claude-opus-4.6",
    provider: "auto",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** fetch stub recording calls; GET list returns `agents`, writes echo back. */
function stubFetch(
  agents: RemoteAgent[],
): Array<{ method: string; path: string; body?: unknown }> {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = new URL(url).pathname;
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, path, body });
      let payload: unknown = {};
      if (method === "GET") payload = { agents };
      if (method === "POST")
        payload = {
          agent: remoteAgent({
            id: "new-id",
            name: (body as { name: string }).name,
            ...body,
          }),
        };
      if (method === "PATCH") payload = { agent: {} };
      return {
        ok: true,
        status: method === "POST" ? 201 : 200,
        json: async () => payload,
      };
    }),
  );
  return calls;
}

async function engine(): Promise<typeof import("./agent-sync")> {
  return import("./agent-sync");
}

beforeEach(() => {
  mockState.home = mkdtempSync(join(tmpdir(), "hermes-sync-"));
  mockState.profiles = [];
  mockState.deletedProfiles = [];
  mockState.failHistoryWrite = false;
  mockState.deleteFailure = false;
  mockState.colorPending = null;
  mockState.colorFailure = false;
  mockState.souls = new Map();
  mockState.memories = new Map();
  mockState.models = new Map();
  mockState.account = { apiUrl: "http://localhost:3002", token: "tok" };
  mockState.createdProfiles = [];
  mockState.writtenSouls = [];
  mockState.writtenMemories = [];
  mockState.writtenColors = [];
  mockState.writtenModels = [];
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(mockState.home, { recursive: true, force: true });
});

describe("decidePartAction", () => {
  // @lat: [[agent-sync#Tests#Part decision matrix]]
  it("covers the base/local/remote matrix", async () => {
    const { decidePartAction } = await engine();
    // Identical content is always a no-op, base or not.
    expect(decidePartAction("b", "x", "x", 5, 1)).toBe("none");
    expect(decidePartAction(undefined, "x", "x", 1, 5)).toBe("none");
    // Only one side moved off the base: that side wins.
    expect(decidePartAction("b", "l", "b", 1, 5)).toBe("push");
    expect(decidePartAction("b", "b", "r", 5, 1)).toBe("pull");
    // Both moved (or never synced): last writer wins.
    expect(decidePartAction("b", "l", "r", 5, 1)).toBe("push");
    expect(decidePartAction("b", "l", "r", 1, 5)).toBe("pull");
    expect(decidePartAction(undefined, "l", "r", 5, 1)).toBe("push");
    expect(decidePartAction(undefined, "l", "r", 1, 5)).toBe("pull");
  });
});

describe("buildPushBody", () => {
  const values = {
    color: "#abcdef",
    soul: "persona",
    memory: "notes",
    config: { model: "m1", provider: "openai" },
  };

  // @lat: [[agent-sync#Tests#Push bodies stay within limits]]
  it("maps parts to backend fields and nothing else", async () => {
    const { buildPushBody } = await engine();
    const { body, skipped } = buildPushBody(
      ["color", "soul", "memory", "config"],
      values,
    );
    expect(body).toEqual({
      color: "#abcdef",
      systemPrompt: "persona",
      memory: "notes",
      model: "m1",
      provider: "openai",
    });
    expect(skipped).toEqual([]);
  });

  it("skips oversize parts and unset models instead of truncating", async () => {
    const { buildPushBody } = await engine();
    const { body, skipped } = buildPushBody(["soul", "memory", "config"], {
      ...values,
      soul: "x".repeat(20001),
      memory: "y".repeat(40001),
      config: { model: "", provider: "auto" },
    });
    expect(body).toEqual({});
    expect(skipped).toHaveLength(3);
  });
});

describe("syncAgents", () => {
  it("reports signed-out without touching the network", async () => {
    mockState.account = null;
    const fetchSpy = stubFetch([]);
    const { syncAgents } = await engine();
    const result = await syncAgents();
    expect(result.status).toBe("signed-out");
    expect(fetchSpy).toHaveLength(0);
  });

  // @lat: [[agent-sync#Tests#Backs up new local profiles]]
  it("creates a cloud agent for a never-synced local profile", async () => {
    mockState.profiles = [fakeProfile("alpha")];
    mockState.souls.set("alpha", "soul-a");
    mockState.memories.set("alpha", "mem-a");
    mockState.models.set("alpha", {
      model: "m1",
      provider: "auto",
      baseUrl: "",
    });
    const calls = stubFetch([]);

    const { syncAgents } = await engine();
    const result = await syncAgents();

    expect(result.status).toBe("ok");
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        profile: "alpha",
        action: "created-remote",
        agentId: "new-id",
      }),
    ]);
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({
      name: "alpha",
      systemPrompt: "soul-a",
      memory: "mem-a",
      model: "m1",
      color: "#123456",
    });
    // Mapping persisted next to the profile.
    const state = JSON.parse(
      readFileSync(
        join(mockState.home, "profiles", "alpha", "cloud-sync.json"),
        "utf-8",
      ),
    );
    expect(state.agentId).toBe("new-id");
  });

  // @lat: [[agent-sync#Tests#Keys on-disk work off the stable id]]
  it("uses the profile id (not the display name) for all on-disk sync work", async () => {
    // A renamed profile: stable id "hello-agent", display name "Hello Agent".
    mockState.profiles = [fakeProfile("Hello Agent", "#123456", "hello-agent")];
    mockState.souls.set("hello-agent", "soul-h");
    mockState.models.set("hello-agent", {
      model: "m1",
      provider: "auto",
      baseUrl: "",
    });
    const calls = stubFetch([]);

    const { syncAgents } = await engine();
    const result = await syncAgents();

    expect(result.status).toBe("ok");
    // On-disk identity is the id …
    expect(result.outcomes[0]).toMatchObject({
      profile: "hello-agent",
      action: "created-remote",
    });
    const state = JSON.parse(
      readFileSync(
        join(mockState.home, "profiles", "hello-agent", "cloud-sync.json"),
        "utf-8",
      ),
    );
    expect(state.agentId).toBe("new-id");
    // … but the cloud agent's human label is the display name.
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({
      name: "Hello Agent",
      systemPrompt: "soul-h",
    });
  });

  // @lat: [[agent-sync#Tests#Links by name and pulls the newer side]]
  it("links an unmapped profile to its namesake and pulls newer cloud parts", async () => {
    mockState.profiles = [fakeProfile("alpha")];
    mockState.souls.set("alpha", "old-soul");
    mockState.models.set("alpha", {
      model: "m1",
      provider: "auto",
      baseUrl: "",
    });
    // No local files exist → local mtimes are 0 → cloud (newer) wins first sync.
    stubFetch([
      remoteAgent({
        id: "agent-1",
        name: "alpha",
        systemPrompt: "cloud-soul",
        memory: "cloud-mem",
        model: "m1",
      }),
    ]);

    const { syncAgents } = await engine();
    const result = await syncAgents();

    expect(result.status).toBe("ok");
    expect(result.outcomes[0]).toMatchObject({
      profile: "alpha",
      agentId: "agent-1",
      action: "pulled",
    });
    expect(mockState.writtenSouls).toContainEqual({
      profile: "alpha",
      content: "cloud-soul",
    });
    expect(mockState.writtenMemories).toContainEqual({
      profile: "alpha",
      content: "cloud-mem",
    });
  });

  // @lat: [[agent-sync#Tests#Pull-creates cloud-only agents]]
  it("creates a local profile for a cloud-only agent", async () => {
    mockState.profiles = [];
    stubFetch([
      remoteAgent({
        id: "agent-2",
        name: "Console Agent",
        systemPrompt: "persona",
        color: "#00ff00",
        model: "m2",
      }),
    ]);

    const { syncAgents } = await engine();
    const result = await syncAgents();

    expect(result.status).toBe("ok");
    expect(mockState.createdProfiles).toEqual(["console-agent"]);
    expect(result.outcomes[0]).toMatchObject({
      profile: "console-agent",
      agentId: "agent-2",
      action: "created-local",
    });
    expect(mockState.writtenSouls).toContainEqual({
      profile: "console-agent",
      content: "persona",
    });
    expect(mockState.writtenColors).toContainEqual({
      profile: "console-agent",
      color: "#00ff00",
    });
  });

  // @lat: [[agent-sync#Tests#Unlinks deleted cloud agents]]
  it("unlinks a profile whose cloud agent was deleted, keeping the profile", async () => {
    mockState.profiles = [fakeProfile("beta")];
    const stateFile = join(
      mockState.home,
      "profiles",
      "beta",
      "cloud-sync.json",
    );
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify({
        version: 1,
        agentId: "gone",
        // Provably this account's link — only then is a missing agent a
        // console deletion rather than an account switch.
        accountId: "u1",
        remoteName: "beta",
        base: {},
      }),
    );
    const calls = stubFetch([]);

    const { syncAgents } = await engine();
    const result = await syncAgents();

    expect(result.outcomes[0]).toMatchObject({
      profile: "beta",
      action: "unlinked",
    });
    expect(existsSync(stateFile)).toBe(false);
    // No delete request went out; the pass also re-backed-up nothing since
    // "beta" became unlinked only this pass — it is created remotely again on
    // the *next* pass, never deleted.
    expect(calls.every((c) => c.method !== "DELETE")).toBe(true);
  });

  // @lat: [[agent-sync#Tests#Skips foreign-linked profiles]]
  it("skips a profile linked to a different account — no unlink, no push", async () => {
    mockState.profiles = [fakeProfile("beta")];
    const stateFile = join(
      mockState.home,
      "profiles",
      "beta",
      "cloud-sync.json",
    );
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify({
        version: 1,
        agentId: "a-owned-elsewhere",
        accountId: "other-user",
        remoteName: "beta",
        base: {},
      }),
    );
    const calls = stubFetch([]);

    const { syncAgents } = await engine();
    const result = await syncAgents();

    expect(result.outcomes[0]).toMatchObject({
      profile: "beta",
      action: "skipped",
    });
    // The link survives for when its account signs back in, and nothing was
    // uploaded to the current account.
    expect(existsSync(stateFile)).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  // @lat: [[agent-sync#Tests#Leaves ambiguous legacy links alone]]
  it("leaves a legacy link alone when its agent is missing (ambiguous owner)", async () => {
    mockState.profiles = [fakeProfile("beta")];
    const stateFile = join(
      mockState.home,
      "profiles",
      "beta",
      "cloud-sync.json",
    );
    mkdirSync(dirname(stateFile), { recursive: true });
    // Pre-account-tagging state: no accountId recorded.
    writeFileSync(
      stateFile,
      JSON.stringify({
        version: 1,
        agentId: "gone",
        remoteName: "beta",
        base: {},
      }),
    );
    const calls = stubFetch([]);

    const { syncAgents } = await engine();
    const result = await syncAgents();

    expect(result.outcomes[0]).toMatchObject({
      profile: "beta",
      action: "skipped",
    });
    expect(existsSync(stateFile)).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  // @lat: [[agent-sync#Tests#Records the owning account]]
  it("stamps the account id on sync, adopting legacy links whose agent exists", async () => {
    mockState.profiles = [fakeProfile("beta")];
    const stateFile = join(
      mockState.home,
      "profiles",
      "beta",
      "cloud-sync.json",
    );
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify({
        version: 1,
        agentId: "a1",
        remoteName: "beta",
        base: {},
      }),
    );
    stubFetch([remoteAgent({ id: "a1", name: "beta" })]);

    const { syncAgents } = await engine();
    const result = await syncAgents();

    expect(result.status).toBe("ok");
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(state.accountId).toBe("u1");
  });
});

function linkedProfile(overrides: Record<string, unknown> = {}): string {
  mockState.profiles = [fakeProfile("Renamed Agent", "#123456", "alpha")];
  const file = join(mockState.home, "profiles", "alpha", "cloud-sync.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      agentId: "a1",
      accountId: "u1",
      apiUrl: "http://localhost:3002",
      remoteName: "old-name",
      base: {},
      ...overrides,
    }),
  );
  return file;
}

describe("local deletion and cloud sync", () => {
  // @lat: [[agent-sync#Tests#Keeps deleted profiles deleted after restart]]
  it("persists exclusion outside the renamed profile and skips recreation after restart", async () => {
    const file = linkedProfile();
    const calls = stubFetch([
      remoteAgent({ id: "a1", name: "new-cloud-name" }),
    ]);
    const { deleteProfileWithSync } = await engine();
    expect(await deleteProfileWithSync("alpha")).toEqual({ success: true });
    expect(existsSync(file)).toBe(false);
    vi.resetModules();
    const { syncAgents } = await engine();
    expect((await syncAgents()).status).toBe("ok");
    expect(mockState.createdProfiles).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("excludes only the deleted identity and never matches its old name to a fresh profile", async () => {
    linkedProfile();
    const e = await engine();
    await e.deleteProfileWithSync("alpha");
    mockState.profiles = [fakeProfile("old-name")];
    const calls = stubFetch([
      remoteAgent({ id: "a1", name: "old-name" }),
      remoteAgent({ id: "another", name: "another" }),
    ]);
    await e.syncAgents();
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      name: "old-name",
    });
    expect(mockState.createdProfiles).toEqual(["another"]);
  });

  // @lat: [[agent-sync#Tests#Preserves deletion ownership]]
  it.each([
    { userId: "u2", apiUrl: "http://localhost:3002" },
    { userId: "u1", apiUrl: "http://localhost:9999" },
  ])(
    "does not suppress the same id in a different account/backend: %j",
    async (account) => {
      linkedProfile();
      const e = await engine();
      await e.deleteProfileWithSync("alpha");
      mockState.account = { ...account, token: "tok" };
      stubFetch([remoteAgent({ id: "a1", name: "alpha" })]);
      await e.syncAgents();
      expect(mockState.createdProfiles).toEqual(["alpha"]);
    },
  );

  it("can delete offline without assigning a foreign link to the current account", async () => {
    linkedProfile({ accountId: "u2" });
    mockState.account = null;
    const calls = stubFetch([remoteAgent({ id: "a1", name: "alpha" })]);
    const e = await engine();
    expect((await e.deleteProfileWithSync("alpha")).success).toBe(true);
    expect(calls).toEqual([]);
    mockState.account = {
      userId: "u2",
      apiUrl: "http://localhost:3002",
      token: "tok",
    };
    await e.syncAgents();
    expect(mockState.createdProfiles).toEqual([]);
  });

  it("retains exact-id exclusions for legacy links without inventing an owner", async () => {
    linkedProfile({ accountId: undefined, apiUrl: undefined });
    const e = await engine();
    await e.deleteProfileWithSync("alpha");
    const history = JSON.parse(
      readFileSync(join(mockState.home, "cloud-sync-deleted.json"), "utf-8"),
    );
    expect(history.links).toEqual([{ agentId: "a1" }]);
    stubFetch([
      remoteAgent({ id: "a1", name: "alpha" }),
      remoteAgent({ id: "fresh-id", name: "beta" }),
    ]);
    await e.syncAgents();
    expect(mockState.createdProfiles).toEqual(["beta"]);
  });

  // @lat: [[agent-sync#Tests#Fails safely when deletion persistence fails]]
  it("does not invoke the CLI when exclusion persistence fails, and can retry", async () => {
    const file = linkedProfile();
    const e = await engine();
    mockState.failHistoryWrite = true;
    expect(await e.deleteProfileWithSync("alpha")).toMatchObject({
      success: false,
      error: "disk full",
    });
    expect(mockState.deletedProfiles).toEqual([]);
    expect(existsSync(file)).toBe(true);
    mockState.failHistoryWrite = false;
    expect((await e.deleteProfileWithSync("alpha")).success).toBe(true);
  });

  it.each([
    "{",
    JSON.stringify({ version: 2, links: [] }),
    JSON.stringify({ version: 1, links: [{ agentId: "" }] }),
  ])(
    "refuses a corrupt deletion history without recreating or deleting profiles",
    async (content) => {
      linkedProfile();
      const path = join(mockState.home, "cloud-sync-deleted.json");
      writeFileSync(path, content);
      const calls = stubFetch([remoteAgent({ id: "a1", name: "alpha" })]);
      const e = await engine();
      expect((await e.deleteProfileWithSync("alpha")).success).toBe(false);
      expect((await e.syncAgents()).status).toBe("error");
      expect(mockState.deletedProfiles).toEqual([]);
      expect(mockState.createdProfiles).toEqual([]);
      expect(calls).toEqual([]);
      expect(readFileSync(path, "utf-8")).toBe(content);
    },
  );

  it("refuses unreadable or corrupt profile links before invoking the CLI", async () => {
    const file = linkedProfile();
    writeFileSync(file, "{");
    const e = await engine();
    expect((await e.deleteProfileWithSync("alpha")).success).toBe(false);
    expect(mockState.deletedProfiles).toEqual([]);
  });

  it("retains the exclusion on CLI failure and a subsequent retry succeeds", async () => {
    linkedProfile();
    mockState.deleteFailure = true;
    const e = await engine();
    expect(await e.deleteProfileWithSync("alpha")).toMatchObject({
      success: false,
      error: "profile is busy",
    });
    expect(existsSync(join(mockState.home, "cloud-sync-deleted.json"))).toBe(
      true,
    );
    mockState.deleteFailure = false;
    expect((await e.deleteProfileWithSync("alpha")).success).toBe(true);
    stubFetch([remoteAgent({ id: "a1", name: "alpha" })]);
    await e.syncAgents();
    expect(mockState.createdProfiles).toEqual([]);
  });

  it.each(["default", "../escape", "", undefined])(
    "refuses invalid deletion target %j before accessing files",
    async (name) => {
      const e = await engine();
      expect((await e.deleteProfileWithSync(name as string)).success).toBe(
        false,
      );
      expect(mockState.deletedProfiles).toEqual([]);
    },
  );

  // @lat: [[agent-sync#Tests#Serializes deletion with in-flight sync]]
  it("waits for an async metadata pull before deleting and prevents subsequent restore", async () => {
    linkedProfile();
    let release!: () => void;
    mockState.colorPending = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubFetch([remoteAgent({ id: "a1", name: "alpha", color: "#abcdef" })]);
    const e = await engine();
    const sync = e.syncAgents();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const deletion = e.deleteProfileWithSync("alpha");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockState.deletedProfiles).toEqual([]);
    release();
    await sync;
    expect((await deletion).success).toBe(true);
    expect(mockState.writtenColors).toEqual([
      { profile: "alpha", color: "#abcdef" },
    ]);
    mockState.colorPending = null;
    await e.syncAgents();
    expect(mockState.createdProfiles).toEqual([]);
    expect(existsSync(join(mockState.home, "profiles", "alpha"))).toBe(false);
  });

  it("keeps consecutive deletion records when requests overlap", async () => {
    linkedProfile();
    const otherFile = join(
      mockState.home,
      "profiles",
      "beta",
      "cloud-sync.json",
    );
    mkdirSync(dirname(otherFile), { recursive: true });
    writeFileSync(
      otherFile,
      JSON.stringify({ version: 1, agentId: "a2", accountId: "u1", base: {} }),
    );
    const e = await engine();
    await Promise.all([
      e.deleteProfileWithSync("alpha"),
      e.deleteProfileWithSync("beta"),
    ]);
    const history = JSON.parse(
      readFileSync(join(mockState.home, "cloud-sync-deleted.json"), "utf-8"),
    );
    expect(history.links.map((l: { agentId: string }) => l.agentId)).toEqual([
      "a1",
      "a2",
    ]);
  });
});

describe("sync failures during deletion coordination", () => {
  // @lat: [[agent-sync#Tests#Does not infer deletion from invalid responses]]
  it.each([null, {}, { agents: null }, { agents: [{ name: "alpha" }] }])(
    "does not unlink profiles on malformed successful list %j",
    async (data) => {
      const stateFile = linkedProfile();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue({ ok: true, status: 200, json: async () => data }),
      );
      const e = await engine();
      expect((await e.syncAgents()).status).toBe("error");
      expect(existsSync(stateFile)).toBe(true);
      expect(mockState.createdProfiles).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("releases a queued deletion when reading a successful response is interrupted", async () => {
    linkedProfile();
    let reject!: (reason: Error) => void;
    const body = new Promise<never>((_resolve, rejectBody) => {
      reject = rejectBody;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => body }),
    );
    const e = await engine();
    const sync = e.syncAgents();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const deletion = e.deleteProfileWithSync("alpha");
    reject(new Error("response timed out"));
    expect((await sync).status).toBe("error");
    expect((await deletion).success).toBe(true);
    stubFetch([remoteAgent({ id: "a1", name: "alpha" })]);
    await e.syncAgents();
    expect(mockState.createdProfiles).toEqual([]);
  });

  it("retries a failed initial pull without uploading empty local defaults", async () => {
    mockState.colorFailure = true;
    const calls = stubFetch([
      remoteAgent({
        id: "a1",
        name: "alpha",
        color: "#abcdef",
        systemPrompt: "cloud persona",
        memory: "cloud memory",
      }),
    ]);
    const e = await engine();
    await e.syncAgents();
    mockState.profiles = [fakeProfile("alpha")];
    mockState.colorFailure = false;
    const result = await e.syncAgents();
    expect(result.outcomes[0]).toMatchObject({
      action: "pulled",
      agentId: "a1",
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(mockState.writtenSouls).toContainEqual({
      profile: "alpha",
      content: "cloud persona",
    });
    expect(mockState.writtenMemories).toContainEqual({
      profile: "alpha",
      content: "cloud memory",
    });
  });

  // @lat: [[agent-sync#Tests#Retains the identity after a failed import]]
  it("retains a new cloud import's identity when metadata fails so deletion stays permanent", async () => {
    mockState.colorFailure = true;
    stubFetch([remoteAgent({ id: "a1", name: "alpha" })]);
    const e = await engine();
    const result = await e.syncAgents();
    expect(result.outcomes[0]).toMatchObject({
      action: "error",
      warnings: ["color write failed"],
    });
    expect(e.getLinkedAgentId("alpha")).toBe("a1");
    expect((await e.deleteProfileWithSync("alpha")).success).toBe(true);
    mockState.createdProfiles = [];
    mockState.colorFailure = false;
    await e.syncAgents();
    expect(mockState.createdProfiles).toEqual([]);
  });
});

describe("complete cloud agent validation", () => {
  // @lat: [[agent-sync#Tests#Validates all reconciliation fields]]
  it.each([
    "id",
    "name",
    "color",
    "systemPrompt",
    "memory",
    "model",
    "provider",
    "updatedAt",
  ])(
    "rejects an agent missing %s before changing any linked profile",
    async (field) => {
      const file = linkedProfile();
      const original = readFileSync(file, "utf-8");
      const agent = remoteAgent({
        id: "a1",
        name: "alpha",
      }) as unknown as Record<string, unknown>;
      delete agent[field];
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ agents: [agent] }),
        }),
      );
      const result = await (await engine()).syncAgents();
      expect(result.status).toBe("error");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(readFileSync(file, "utf-8")).toBe(original);
      expect(mockState.writtenSouls).toEqual([]);
      expect(mockState.writtenColors).toEqual([]);
    },
  );

  it.each([
    { updatedAt: "not a date" },
    { color: "invalid" },
    { systemPrompt: 42 },
    { memory: {} },
    { model: 42 },
    { provider: null },
  ])("rejects invalid reconciliation values %j", async (invalid) => {
    const file = linkedProfile();
    const agent = { ...remoteAgent({ id: "a1", name: "alpha" }), ...invalid };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ agents: [agent] }),
      }),
    );
    expect((await (await engine()).syncAgents()).status).toBe("error");
    expect(existsSync(file)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("accepts backend-supported empty model/provider values without clearing the local model", async () => {
  linkedProfile();
  mockState.models.set("alpha", {
    model: "local-model",
    provider: "auto",
    baseUrl: "",
  });
  stubFetch([
    remoteAgent({ id: "a1", name: "alpha", model: "", provider: "" }),
  ]);
  expect((await (await engine()).syncAgents()).status).toBe("ok");
  expect(mockState.writtenModels).toEqual([]);
});

// @lat: [[agent-sync#Tests#Waits for ownership adoption already in progress]]
it("waits for the active sync before resolving a legacy wallet link", async () => {
  linkedProfile({ apiUrl: undefined });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await pending;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          agents: [remoteAgent({ id: "a1", name: "alpha" })],
        }),
      };
    }),
  );
  const e = await engine();
  const pass = e.syncAgents();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  const { resolveLinkedAgent } = await import("./wallet-sync");
  let settled = false;
  const wallet = resolveLinkedAgent("alpha").then((result) => {
    settled = true;
    return result;
  });
  // Flush promise reactions while the list response is still pending.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const settledEarly = settled;
  release();
  await pass;
  const result = await wallet;
  expect(settledEarly).toBe(false);
  expect(result).toMatchObject({
    status: "ok",
    apiUrl: "http://localhost:3002",
    agentId: "a1",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(e.getAgentSyncStatus().running).toBe(false);
});
