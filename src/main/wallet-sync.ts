// @lat: [[wallet-token-balances#Wallet Sync]]
import {
  findAccountProfile,
  getAccount,
  getAccessToken,
} from "./account-store";
import { apiHeaders } from "./hermes-account";
import {
  getLinkedAgentAccountId,
  getLinkedAgentId,
  syncAgents,
} from "./agent-sync";
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

/** Everything a backend wallet call needs for a profile's linked agent. */
export type LinkedAgentResolution =
  | { status: "signed-out" | "unlinked" | "foreign" }
  | { status: "ok"; apiUrl: string; token: string; agentId: string };

/**
 * Resolve the signed-in account and the profile's linked cloud-agent id, the
 * common preamble of every backend wallet call. A profile that has never
 * synced triggers one agent sync first (so it gets an agent id). A profile
 * whose link is owned by a different account resolves as `foreign` — wallet
 * actions must not act on another account's agent (the backend enforces
 * ownership too; this makes the refusal explicit client-side).
 */
export async function resolveLinkedAgent(
  profile?: string,
): Promise<LinkedAgentResolution> {
  const name = profile || "default";
  const accountProfile = findAccountProfile();
  const account = accountProfile ? getAccount(accountProfile) : null;
  const token = accountProfile ? getAccessToken(accountProfile) : null;
  if (!account || !token) return { status: "signed-out" };

  let agentId = getLinkedAgentId(name);
  if (!agentId) {
    // Never synced: create/link the cloud agent, then read its id.
    await syncAgents();
    agentId = getLinkedAgentId(name);
  }
  if (!agentId) return { status: "unlinked" };

  let owner = getLinkedAgentAccountId(name);
  if (!owner) {
    // Legacy link with no recorded owner. Run one sync pass: it stamps the
    // current account onto links whose agent belongs to this account and
    // leaves foreign/ambiguous ones untagged. Without this, a stale agent id
    // from a previously signed-in account would be sent under the new
    // account's token and surface as a generic error.
    await syncAgents();
    agentId = getLinkedAgentId(name);
    if (!agentId) return { status: "unlinked" };
    owner = getLinkedAgentAccountId(name);
  }
  if (owner !== account.user.id) return { status: "foreign" };
  return { status: "ok", apiUrl: account.apiUrl, token, agentId };
}

/**
 * Cloud wallets for `profile`'s linked agent. Signed out → no wallets.
 * Errors (network/401) surface as `status: "error"`.
 */
export async function syncWalletsForProfile(
  profile?: string,
): Promise<WalletSyncResult> {
  const resolved = await resolveLinkedAgent(profile);
  if (resolved.status !== "ok") {
    return { status: resolved.status, wallets: [] };
  }
  const { apiUrl, token, agentId } = resolved;

  try {
    const res = await fetch(
      `${apiUrl}/api/wallets?agentId=${encodeURIComponent(agentId)}`,
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
      error: `Couldn't reach ${apiUrl}: ${(err as Error).message}`,
    };
  }
}
