import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  WalletPortfolioResult,
  WalletSyncResult,
} from "../../../../shared/wallets";
import type { OfficeAgent } from "./office3d/core/types";
import { REPRESENTATIVES } from "./office3d/interactions/registry";

// Pass-through i18n so the test asserts on stable keys, not translations.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {},
  }),
}));

import RepInteractionPanel from "./RepInteractionPanel";

const REP = REPRESENTATIVES[0];

function agent(id: string): OfficeAgent {
  return {
    id,
    name: id,
    status: "idle",
    color: "#123456",
    item: "desk",
  };
}

function walletResult(name: string): WalletSyncResult {
  return {
    status: "ok",
    wallets: [
      {
        id: `wal-${name}`,
        name,
        address: "0x1234567890abcdef1234567890abcdef12345678",
        network: "base",
        source: "cloud",
        createdAt: 1,
        canTransact: true,
      },
    ],
  };
}

function stubHermesAPI(opts: {
  syncWallets: (profile?: string) => Promise<WalletSyncResult>;
  getWalletPortfolio?: (
    profile?: string,
    walletId?: string,
  ) => Promise<WalletPortfolioResult>;
  // The signed-in Hermes account id the panel scopes its wallet cache to; null
  // models being signed out.
  accountId?: string | null;
}): void {
  const accountId = opts.accountId === undefined ? "acct-1" : opts.accountId;
  Object.defineProperty(window, "hermesAPI", {
    value: {
      syncWallets: opts.syncWallets,
      getWalletPortfolio:
        opts.getWalletPortfolio ??
        (async () => ({ status: "ok", totalUsd: 0, tokens: [] })),
      getAccount: async () =>
        accountId === null
          ? null
          : {
              apiUrl: "https://api.example",
              user: { id: accountId, email: null, name: null, avatarUrl: null },
            },
    },
    writable: true,
    configurable: true,
  });
}

describe("RepInteractionPanel", () => {
  // @lat: [[office-interactions#Tests#Panel follows the Office selection]]
  it("follows a changed Office selection while mounted", async () => {
    stubHermesAPI({ syncWallets: async () => walletResult("a") });
    const { rerender } = render(
      <RepInteractionPanel
        rep={REP}
        agents={[agent("a"), agent("b")]}
        initialAgentId="a"
        onClose={() => {}}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("a");

    // The Office selection moves to another agent while the panel is open.
    rerender(
      <RepInteractionPanel
        rep={REP}
        agents={[agent("a"), agent("b")]}
        initialAgentId="b"
        onClose={() => {}}
      />,
    );
    expect(select.value).toBe("b");

    // A cleared selection keeps the panel's current choice.
    rerender(
      <RepInteractionPanel
        rep={REP}
        agents={[agent("a"), agent("b")]}
        initialAgentId={null}
        onClose={() => {}}
      />,
    );
    expect(select.value).toBe("b");
  });

  // @lat: [[office-interactions#Tests#Drops stale action results]]
  it("drops an in-flight result when the agent changes mid-request", async () => {
    let resolveA: ((r: WalletSyncResult) => void) | null = null;
    stubHermesAPI({
      syncWallets: (profile) =>
        new Promise((resolve) => {
          if (profile === "a") resolveA = resolve;
          else resolve(walletResult("b"));
        }),
    });
    const { rerender } = render(
      <RepInteractionPanel
        rep={REP}
        agents={[agent("a"), agent("b")]}
        initialAgentId="a"
        onClose={() => {}}
      />,
    );
    // Start an action for agent a; its response hangs.
    fireEvent.click(screen.getByText("office.repActionAccountStatus"));
    expect(screen.getByText("office.repLoading")).toBeTruthy();

    // Selection moves to agent b before a's response arrives.
    rerender(
      <RepInteractionPanel
        rep={REP}
        agents={[agent("a"), agent("b")]}
        initialAgentId="b"
        onClose={() => {}}
      />,
    );
    // a's response lands late — it must not render under b.
    resolveA!(walletResult("a"));
    await waitFor(() => expect(screen.queryByText("wal-a")).toBeNull());
    expect(screen.queryByText("a", { selector: "span" })).toBeNull();

    // Running the action for b shows b's wallets.
    fireEvent.click(screen.getByText("office.repActionAccountStatus"));
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
  });

  // @lat: [[office-interactions#Tests#Wallet cache is account-scoped]]
  it("never hydrates cached wallet data across an account relink", async () => {
    const portfolio: WalletPortfolioResult = {
      status: "ok",
      totalUsd: 42,
      tokens: [],
    };
    // Account 1 loads agent a's balance, caching it under acct-1.
    stubHermesAPI({
      syncWallets: async () => walletResult("a"),
      getWalletPortfolio: async () => portfolio,
      accountId: "acct-1",
    });
    const { unmount } = render(
      <RepInteractionPanel
        rep={REP}
        agents={[agent("a")]}
        initialAgentId="a"
        onClose={() => {}}
      />,
    );
    // Let getAccount() resolve so the cache is written under acct-1.
    await act(async () => {});
    fireEvent.click(screen.getByText("office.repActionCheckBalance"));
    await waitFor(() => expect(screen.getByText("$42.00")).toBeTruthy());
    unmount();

    // The same local profile is relinked to a different Hermes account. The
    // module-level cache survives, but its key changed with the account, so
    // reopening must not surface account 1's cached balance.
    stubHermesAPI({
      syncWallets: async () => walletResult("a"),
      getWalletPortfolio: async () => portfolio,
      accountId: "acct-2",
    });
    render(
      <RepInteractionPanel
        rep={REP}
        agents={[agent("a")]}
        initialAgentId="a"
        onClose={() => {}}
      />,
    );
    await act(async () => {});
    expect(screen.queryByText("$42.00")).toBeNull();
    expect(screen.getByText("$—")).toBeTruthy();
  });

  // @lat: [[office-interactions#Tests#Account scope refreshes on re-show]]
  it("re-resolves the account when the tab is re-shown, panel still mounted", async () => {
    const portfolio: WalletPortfolioResult = {
      status: "ok",
      totalUsd: 42,
      tokens: [],
    };
    const panel = (visible: boolean): React.JSX.Element => (
      <RepInteractionPanel
        rep={REP}
        agents={[agent("v")]}
        initialAgentId="v"
        visible={visible}
        onClose={() => {}}
      />
    );
    stubHermesAPI({
      syncWallets: async () => walletResult("v"),
      getWalletPortfolio: async () => portfolio,
      accountId: "vis-1",
    });
    const { rerender } = render(panel(true));
    await act(async () => {});
    fireEvent.click(screen.getByText("office.repActionCheckBalance"));
    await waitFor(() => expect(screen.getByText("$42.00")).toBeTruthy());

    // The account changes elsewhere while the panel stays mounted (Office is
    // only hidden, never unmounted). Hiding then re-showing the tab must
    // re-resolve the account and drop the previous account's cached balance.
    stubHermesAPI({
      syncWallets: async () => walletResult("v"),
      getWalletPortfolio: async () => portfolio,
      accountId: "vis-2",
    });
    rerender(panel(false));
    await act(async () => {});
    rerender(panel(true));
    await act(async () => {});
    expect(screen.queryByText("$42.00")).toBeNull();
    expect(screen.getByText("$—")).toBeTruthy();
  });
});
