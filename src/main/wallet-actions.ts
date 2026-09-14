// @lat: [[office-interactions#Backend Wallet Actions]]
import { apiHeaders } from "./hermes-account";
import { mapCloudWallet, resolveLinkedAgent } from "./wallet-sync";
import type {
  CloudWalletRaw,
  PortfolioTokenView,
  ProvisionWalletResult,
  WalletPortfolioResult,
} from "../shared/wallets";

// Backend-driven wallet operations for the Office's space representatives
// (bank receptionist). Everything goes through the hermes-one backend — the
// desktop holds no keys and reads no chain state locally for these flows.

/** Raw token row from the backend portfolio (provider-normalised). */
interface PortfolioTokenRaw {
  symbol?: string;
  name?: string;
  balance?: number;
  balanceUsd?: number;
}

/**
 * Token balances for one of the profile's cloud wallets, via
 * `GET /api/wallets/:id/portfolio`. Requires a transactable wallet (the
 * backend authenticates reads with the wallet's stored key); receive-only
 * wallets surface the backend's error string.
 */
export async function getWalletPortfolio(
  profile: string | undefined,
  walletId: string,
): Promise<WalletPortfolioResult> {
  const resolved = await resolveLinkedAgent(profile);
  if (resolved.status !== "ok") return { status: resolved.status };
  const { apiUrl, token } = resolved;

  try {
    const res = await fetch(
      `${apiUrl}/api/wallets/${encodeURIComponent(walletId)}/portfolio`,
      { headers: { ...apiHeaders(false), authorization: `Bearer ${token}` } },
    );
    const data = (await res.json().catch(() => ({}))) as {
      portfolio?: { totalUsd?: number; tokens?: PortfolioTokenRaw[] };
      error?: string;
    };
    if (!res.ok) {
      return {
        status: "error",
        error: data.error || `Portfolio unavailable (HTTP ${res.status}).`,
      };
    }
    const tokens: PortfolioTokenView[] = (data.portfolio?.tokens ?? []).map(
      (t) => ({
        symbol: t.symbol || "?",
        name: t.name || t.symbol || "Token",
        balance: typeof t.balance === "number" ? t.balance : 0,
        balanceUsd: typeof t.balanceUsd === "number" ? t.balanceUsd : 0,
      }),
    );
    return {
      status: "ok",
      totalUsd: data.portfolio?.totalUsd ?? 0,
      tokens,
    };
  } catch (err) {
    return {
      status: "error",
      error: `Couldn't reach ${apiUrl}: ${(err as Error).message}`,
    };
  }
}

/**
 * Provision a backend (Bankr) wallet for the profile's linked agent, via
 * `POST /api/wallets`. Idempotent on the backend — a second create returns
 * 409, which surfaces as `status: "exists"` so the UI can say "this agent
 * already has an account" instead of erroring.
 */
export async function provisionAgentWallet(
  profile?: string,
): Promise<ProvisionWalletResult> {
  const resolved = await resolveLinkedAgent(profile);
  if (resolved.status !== "ok") return { status: resolved.status };
  const { apiUrl, token, agentId } = resolved;

  try {
    const res = await fetch(`${apiUrl}/api/wallets`, {
      method: "POST",
      headers: {
        ...apiHeaders(false),
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ agentId, kind: "bankr" }),
    });
    if (res.status === 409) return { status: "exists" };
    const data = (await res.json().catch(() => ({}))) as {
      wallet?: CloudWalletRaw;
      error?: string;
    };
    if (!res.ok || !data.wallet) {
      return {
        status: "error",
        error: data.error || `Wallet creation failed (HTTP ${res.status}).`,
      };
    }
    return { status: "ok", wallet: mapCloudWallet(data.wallet) ?? undefined };
  } catch (err) {
    return {
      status: "error",
      error: `Couldn't reach ${apiUrl}: ${(err as Error).message}`,
    };
  }
}
