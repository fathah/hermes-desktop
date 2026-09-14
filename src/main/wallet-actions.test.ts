// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudWalletRaw } from "../shared/wallets";

// wallet-actions' deps are faked the same way as wallet-sync.test.ts: the
// tests drive the backend-call logic without a real account, keychain, or
// network.

const mockState = vi.hoisted(() => ({
  account: null as { apiUrl: string; token: string } | null,
  linkedAgentId: null as string | null,
  syncAgentsCalls: 0,
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
  // Link owner recorded in sync state — matches the mock account ("u1") so
  // actions proceed; the legacy/foreign paths are covered in wallet-sync tests.
  getLinkedAgentAccountId: () => "u1",
  syncAgents: vi.fn(async () => {
    mockState.syncAgentsCalls++;
    mockState.linkedAgentId = mockState.linkAfterSync;
    return { status: "ok", outcomes: [], finishedAt: Date.now() };
  }),
}));

interface StubCall {
  url: string;
  init?: RequestInit;
}

function stubFetch(body: unknown, ok = true, status = 200): StubCall[] {
  const calls: StubCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok, status, json: async () => body };
    }),
  );
  return calls;
}

function rawWallet(overrides: Partial<CloudWalletRaw> = {}): CloudWalletRaw {
  return {
    id: "wal-1",
    kind: "bankr",
    label: "Treasury",
    evmAddress: "0xabc",
    receiveOnly: false,
    canTransact: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

async function engine(): Promise<typeof import("./wallet-actions")> {
  return import("./wallet-actions");
}

beforeEach(() => {
  mockState.account = { apiUrl: "http://localhost:3002", token: "tok" };
  mockState.linkedAgentId = "agent-1";
  mockState.linkAfterSync = null;
  mockState.syncAgentsCalls = 0;
  vi.resetModules();
});

afterEach(() => vi.unstubAllGlobals());

describe("getWalletPortfolio", () => {
  it("reports signed-out without hitting the network", async () => {
    mockState.account = null;
    const calls = stubFetch({});
    const { getWalletPortfolio } = await engine();
    const result = await getWalletPortfolio("default", "wal-1");
    expect(result.status).toBe("signed-out");
    expect(calls).toHaveLength(0);
  });

  it("maps the backend portfolio to token views", async () => {
    const calls = stubFetch({
      portfolio: {
        totalUsd: 12.5,
        tokens: [
          {
            symbol: "HD",
            name: "Hermes Desktop",
            balance: 100,
            balanceUsd: 2.5,
          },
          { symbol: "ETH", name: "Ether", balance: 0.004, balanceUsd: 10 },
        ],
      },
    });
    const { getWalletPortfolio } = await engine();
    const result = await getWalletPortfolio("default", "wal-1");
    expect(result.status).toBe("ok");
    expect(result.totalUsd).toBe(12.5);
    expect(result.tokens?.map((t) => t.symbol)).toEqual(["HD", "ETH"]);
    expect(calls[0].url).toBe(
      "http://localhost:3002/api/wallets/wal-1/portfolio",
    );
  });

  it("defaults malformed token rows instead of crashing", async () => {
    stubFetch({ portfolio: { tokens: [{}] } });
    const { getWalletPortfolio } = await engine();
    const result = await getWalletPortfolio("default", "wal-1");
    expect(result.status).toBe("ok");
    expect(result.tokens).toEqual([
      { symbol: "?", name: "Token", balance: 0, balanceUsd: 0 },
    ]);
  });

  it("surfaces the backend error string on HTTP failure", async () => {
    stubFetch({ error: "encryption_unconfigured" }, false, 503);
    const { getWalletPortfolio } = await engine();
    const result = await getWalletPortfolio("default", "wal-1");
    expect(result.status).toBe("error");
    expect(result.error).toBe("encryption_unconfigured");
  });

  it("surfaces a network failure as an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const { getWalletPortfolio } = await engine();
    const result = await getWalletPortfolio("default", "wal-1");
    expect(result.status).toBe("error");
    expect(result.error).toContain("boom");
  });
});

describe("provisionAgentWallet", () => {
  it("provisions a bankr wallet for the linked agent", async () => {
    const calls = stubFetch({ wallet: rawWallet() }, true, 201);
    const { provisionAgentWallet } = await engine();
    const result = await provisionAgentWallet("default");
    expect(result.status).toBe("ok");
    expect(result.wallet?.address).toBe("0xabc");
    expect(calls[0].url).toBe("http://localhost:3002/api/wallets");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      agentId: "agent-1",
      kind: "bankr",
    });
  });

  it("maps the backend's 409 to status exists", async () => {
    stubFetch({ error: "already_provisioned" }, false, 409);
    const { provisionAgentWallet } = await engine();
    const result = await provisionAgentWallet("default");
    expect(result.status).toBe("exists");
  });

  it("stays unlinked when even a sync can't link the profile", async () => {
    mockState.linkedAgentId = null;
    mockState.linkAfterSync = null;
    const calls = stubFetch({});
    const { provisionAgentWallet } = await engine();
    const result = await provisionAgentWallet("default");
    expect(mockState.syncAgentsCalls).toBe(1);
    expect(result.status).toBe("unlinked");
    expect(calls).toHaveLength(0);
  });

  it("surfaces an HTTP error", async () => {
    stubFetch({}, false, 500);
    const { provisionAgentWallet } = await engine();
    const result = await provisionAgentWallet("default");
    expect(result.status).toBe("error");
    expect(result.error).toContain("500");
  });
});
