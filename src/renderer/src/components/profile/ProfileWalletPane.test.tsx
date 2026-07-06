import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TokenBalancesResponse } from "../../../../shared/tokens";
import type { ProfileWallet } from "../../../../shared/wallets";

// Pass-through i18n so the test asserts on stable markup, not translations.
vi.mock("../useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {},
  }),
}));

// AppModal pulls in a Radix portal; the pane only needs it for create/delete
// flows, which this test doesn't exercise. Stub it to keep the render focused
// on the balance chips.
vi.mock("../modal/AppModal", () => ({
  AppModal: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AppModalTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import ProfileWalletPane from "./ProfileWalletPane";

const WALLET: ProfileWallet = {
  id: "w1",
  name: "Primary",
  address: "0x1234567890abcdef1234567890abcdef12345678",
  network: "base",
  createdAt: 1,
  imported: false,
};

/** One token with a known icon ("hd") and one without ("xyz"), so the test
 *  covers both render branches. */
const BALANCES: TokenBalancesResponse = {
  address: WALLET.address,
  fetchedAt: Date.now(),
  balances: [
    {
      tokenId: "hd",
      symbol: "HD",
      raw: "1",
      formatted: "1",
      formattedFull: "1",
    },
    {
      tokenId: "xyz",
      symbol: "XYZ",
      raw: "2",
      formatted: "2",
      formattedFull: "2",
    },
  ],
};

function installApi(): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      listWallets: vi.fn().mockResolvedValue([WALLET]),
      getTokenBalances: vi.fn().mockResolvedValue(BALANCES),
      copyToClipboard: vi.fn().mockResolvedValue(undefined),
    },
  });
}

describe("ProfileWalletPane balance chips", () => {
  it("renders the symbol label exactly once per token and the icon only when known", async () => {
    installApi();
    const view = render(<ProfileWalletPane profile="default" />);

    await waitFor(() => {
      expect(
        view.container.querySelectorAll(".profile-wallet-balance"),
      ).toHaveLength(2);
    });

    // Regression guard: the symbol label must appear once per token (2 total),
    // never duplicated for the no-icon fallback.
    expect(
      view.container.querySelectorAll(".profile-wallet-balance-symbol"),
    ).toHaveLength(2);

    // Only the known "hd" token has an icon; "xyz" must not render one.
    const icons = view.container.querySelectorAll(
      ".profile-wallet-balance-icon",
    );
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute("alt")).toBe("HD");

    // Each chip carries exactly one symbol label.
    for (const chip of view.container.querySelectorAll(
      ".profile-wallet-balance",
    )) {
      expect(
        chip.querySelectorAll(".profile-wallet-balance-symbol"),
      ).toHaveLength(1);
    }
  });
});
