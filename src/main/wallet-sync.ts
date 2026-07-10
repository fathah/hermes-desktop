// @lat: [[wallet-token-balances#Wallet Sync]]
import {
  findAccountProfile,
  getAccount,
  getAccessToken,
} from "./account-store";
import { apiHeaders } from "./hermes-account";
import { getLinkedAgentId, syncAgents } from "./agent-sync";
import { BASE_NETWORK_ID } from "../shared/wallets";
import type {
  CloudWalletRaw,
  WalletSyncResult,
  WalletView,
} from "../shared/wallets";

// Fetches the wallets the backend has provisioned for a profile's linked cloud
// agent (GET /api/wallets?agentId=…), so the desktop can show them read-only
// instead of minting wallets locally. Wallets are attached to a cloud agent —
// the same link agent-sync stores in cloud-sync.json — so a profile must be
// synced first (we auto-sync when it isn't). No wallet secret ever reaches the
// device; these are receive/tracked addresses.

/**
 * Map a backend wallet row to the pane's view model, or null when it has no
 * EVM address to show (kept pure for unit tests, mirroring agent-sync.ts).
 */
export function mapCloudWallet(raw: CloudWalletRaw): WalletView | null {
  if (!raw.evmAddress) return null;
  return {
    id: raw.id,
    name: raw.label || "Wallet",
    address: raw.evmAddress,
    network: BASE_NETWORK_ID,
    source: "cloud",
    createdAt: Date.parse(raw.createdAt) || 0,
    kind: raw.kind,
    receiveOnly: raw.receiveOnly,
    canTransact: raw.canTransact,
  };
}

/**
 * Cloud wallets for `profile`'s linked agent. Signed out → no wallets; a
 * profile that has never synced triggers one agent sync first (so it gets an
 * agent id), then the fetch. Errors (network/401) surface as `status: "error"`.
 */
export async function syncWalletsForProfile(
  profile?: string,
): Promise<WalletSyncResult> {
  const name = profile || "default";
  const accountProfile = findAccountProfile();
  const account = accountProfile ? getAccount(accountProfile) : null;
  const token = accountProfile ? getAccessToken(accountProfile) : null;
  if (!account || !token) return { status: "signed-out", wallets: [] };

  let agentId = getLinkedAgentId(name);
  if (!agentId) {
    // Never synced: create/link the cloud agent, then read its id.
    await syncAgents();
    agentId = getLinkedAgentId(name);
  }
  if (!agentId) return { status: "unlinked", wallets: [] };

  try {
    const res = await fetch(
      `${account.apiUrl}/api/wallets?agentId=${encodeURIComponent(agentId)}`,
      { headers: { ...apiHeaders(false), authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      return {
        status: "error",
        wallets: [],
        error: `Cloud wallets unavailable (HTTP ${res.status}).`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as {
      wallets?: CloudWalletRaw[];
    };
    const wallets = (data.wallets ?? [])
      .map(mapCloudWallet)
      .filter((w): w is WalletView => w !== null);
    return { status: "ok", wallets };
  } catch (err) {
    return {
      status: "error",
      wallets: [],
      error: `Couldn't reach ${account.apiUrl}: ${(err as Error).message}`,
    };
  }
}
