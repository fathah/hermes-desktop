// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudWalletRaw } from "../shared/wallets";

// wallet-sync's deps are faked so the tests drive the fetch/link logic without
// a real account, keychain, or network (pattern from agent-sync.test.ts).

const mockState = vi.hoisted(() => ({
  account: null as { apiUrl: string; token: string } | null,
  linkedAgentId: null as string | null,
  syncAgentsCalls: 0,
  // A value the auto-sync "creates" — returned by getLinkedAgentId after sync.
  linkAfterSync: null as string | null,
}));

vi.mock("./account-store", () => ({
  findAccountProfile: () => (mockState.account ? "default" : null),
  getAccount: () =>
    mockState.account
      ? {
          apiUrl: mockState.account.apiUrl,
          user: { id: "u1", email: null, name: null, avatarUrl: null },
        }
      : null,
  getAccessToken: () => mockState.account?.token ?? null,
}));

vi.mock("./hermes-account", () => ({
  apiHeaders: (json = true) =>
    json ? { "content-type": "application/json" } : {},
}));

vi.mock("./agent-sync", () => ({
  getLinkedAgentId: () => mockState.linkedAgentId,
  syncAgents: vi.fn(async () => {
    mockState.syncAgentsCalls++;
    mockState.linkedAgentId = mockState.linkAfterSync;
    return { status: "ok", outcomes: [], finishedAt: Date.now() };
  }),
}));

function stubFetch(
  wallets: CloudWalletRaw[],
  ok = true,
  status = 200,
): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      return { ok, status, json: async () => ({ wallets }) };
    }),
  );
  return calls;
}

function rawWallet(overrides: Partial<CloudWalletRaw> = {}): CloudWalletRaw {
  return {
    id: "wal-1",
    kind: "local",
    label: "Treasury",
    evmAddress: "0xabc",
    receiveOnly: true,
    canTransact: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

async function engine(): Promise<typeof import("./wallet-sync")> {
  return import("./wallet-sync");
}

beforeEach(() => {
  mockState.account = { apiUrl: "http://localhost:3002", token: "tok" };
  mockState.linkedAgentId = null;
  mockState.linkAfterSync = null;
  mockState.syncAgentsCalls = 0;
  vi.resetModules();
});

afterEach(() => vi.unstubAllGlobals());

describe("mapCloudWallet", () => {
  it("maps a backend wallet row to the view model", async () => {
    const { mapCloudWallet } = await engine();
    expect(mapCloudWallet(rawWallet())).toEqual({
      id: "wal-1",
      name: "Treasury",
      address: "0xabc",
      network: "base",
      source: "cloud",
      createdAt: Date.parse("2026-07-01T00:00:00.000Z"),
      kind: "local",
      receiveOnly: true,
      canTransact: false,
    });
  });

  it("defaults the name when the label is null", async () => {
    const { mapCloudWallet } = await engine();
    expect(mapCloudWallet(rawWallet({ label: null }))?.name).toBe("Wallet");
  });

  it("drops rows without an EVM address", async () => {
    const { mapCloudWallet } = await engine();
    expect(mapCloudWallet(rawWallet({ evmAddress: null }))).toBeNull();
  });
});

describe("syncWalletsForProfile", () => {
  it("reports signed-out without hitting the network", async () => {
    mockState.account = null;
    const calls = stubFetch([]);
    const { syncWalletsForProfile } = await engine();
    const result = await syncWalletsForProfile("default");
    expect(result.status).toBe("signed-out");
    expect(calls).toHaveLength(0);
  });

  it("fetches wallets for an already-linked agent", async () => {
    mockState.linkedAgentId = "agent-1";
    const calls = stubFetch([
      rawWallet(),
      rawWallet({ id: "wal-2", evmAddress: null }),
    ]);
    const { syncWalletsForProfile } = await engine();
    const result = await syncWalletsForProfile("default");
    expect(result.status).toBe("ok");
    // The addressless row is dropped.
    expect(result.wallets.map((w) => w.id)).toEqual(["wal-1"]);
    expect(calls[0]).toContain("agentId=agent-1");
    expect(mockState.syncAgentsCalls).toBe(0);
  });

  it("auto-syncs first when the profile has no linked agent", async () => {
    mockState.linkedAgentId = null;
    mockState.linkAfterSync = "agent-new";
    const calls = stubFetch([rawWallet()]);
    const { syncWalletsForProfile } = await engine();
    const result = await syncWalletsForProfile("default");
    expect(mockState.syncAgentsCalls).toBe(1);
    expect(result.status).toBe("ok");
    expect(calls[0]).toContain("agentId=agent-new");
  });

  it("stays unlinked when even a sync can't link the profile", async () => {
    mockState.linkedAgentId = null;
    mockState.linkAfterSync = null;
    const calls = stubFetch([]);
    const { syncWalletsForProfile } = await engine();
    const result = await syncWalletsForProfile("default");
    expect(mockState.syncAgentsCalls).toBe(1);
    expect(result.status).toBe("unlinked");
    expect(calls).toHaveLength(0);
  });

  it("surfaces an HTTP error", async () => {
    mockState.linkedAgentId = "agent-1";
    stubFetch([], false, 401);
    const { syncWalletsForProfile } = await engine();
    const result = await syncWalletsForProfile("default");
    expect(result.status).toBe("error");
    expect(result.error).toContain("401");
  });
});
