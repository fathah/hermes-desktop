import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WalletSyncResult } from "../../../../shared/wallets";
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

function stubHermesAPI(
  syncWallets: (profile?: string) => Promise<WalletSyncResult>,
): void {
  Object.defineProperty(window, "hermesAPI", {
    value: { syncWallets },
    writable: true,
    configurable: true,
  });
}

describe("RepInteractionPanel", () => {
  // @lat: [[office-interactions#Tests#Panel follows the Office selection]]
  it("follows a changed Office selection while mounted", async () => {
    stubHermesAPI(async () => walletResult("a"));
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
    stubHermesAPI(
      (profile) =>
        new Promise((resolve) => {
          if (profile === "a") resolveA = resolve;
          else resolve(walletResult("b"));
        }),
    );
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
});
