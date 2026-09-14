// @lat: [[hermes-account-login#Hermes One account login#Auto-provisioned inference key and credits]]
import { hostname } from "os";
import {
  findAccountProfile,
  getAccessToken,
  getAccount,
} from "./account-store";
import { apiHeaders } from "./hermes-account";
import { readEnv, setEnvValue } from "./config";

/**
 * Convenience layer over the signed-in Hermes One account: users get model
 * access through Hermes One Inference without hand-copying an API key from the
 * console. On login (and whenever the Providers screen finds the key missing)
 * the desktop asks the backend to issue a gateway key and stores it as
 * `HERMESONE_API_KEY` — which by itself makes the Hermes One provider card and
 * active-model picker entry appear, since both are keyed off that env var.
 *
 * The backend endpoints are session-gated and accept the device-login bearer
 * token (`hermes-one-backend/server/api/credits/keys.ts` + `balance.get.ts`);
 * the raw `hs-live-…` key is returned exactly once and never re-readable, so
 * an existing local key is always kept rather than re-issued.
 */

export interface EnsureHermesOneKeyResult {
  status: "created" | "exists" | "signed-out" | "error";
  error?: string;
}

export interface HermesOneCreditsResult {
  /** USD-denominated AI-credit balance (1 credit = $1). */
  balance: number | null;
  error?: string;
}

function accountSession(): { apiUrl: string; token: string } | null {
  const accountProfile = findAccountProfile();
  if (accountProfile === null) return null;
  const account = getAccount(accountProfile);
  const token = getAccessToken(accountProfile);
  if (!account || !token) return null;
  return { apiUrl: account.apiUrl, token };
}

// Single-flight **per profile**: the post-login hook and the Providers screen
// can both ask at once; issuing two backend keys for one gap would leave an
// orphan. Keyed by profile because provisioning writes that profile's `.env` —
// a global latch would let profile B piggyback on profile A's run and report
// `created` without ever receiving a key.
const ensureInFlight = new Map<string, Promise<EnsureHermesOneKeyResult>>();

/**
 * Make sure the profile has a `HERMESONE_API_KEY`: keep an existing one,
 * otherwise issue a fresh gateway key from the signed-in account and persist
 * it to the profile's `.env`.
 */
export function ensureHermesOneApiKey(
  profile?: string,
): Promise<EnsureHermesOneKeyResult> {
  const key = profile?.trim() || "default";
  let flight = ensureInFlight.get(key);
  if (!flight) {
    flight = doEnsure(profile).finally(() => {
      ensureInFlight.delete(key);
    });
    ensureInFlight.set(key, flight);
  }
  return flight;
}

async function doEnsure(profile?: string): Promise<EnsureHermesOneKeyResult> {
  try {
    const existing = (readEnv(profile)["HERMESONE_API_KEY"] || "").trim();
    if (existing) return { status: "exists" };
  } catch {
    // Unreadable .env — treat as missing and let the write surface an error.
  }

  const session = accountSession();
  if (!session) return { status: "signed-out" };

  let res: Response;
  try {
    res = await fetch(`${session.apiUrl}/api/credits/keys`, {
      method: "POST",
      headers: {
        ...apiHeaders(),
        authorization: `Bearer ${session.token}`,
      },
      // The console's key list shows this name, so the user can tell where
      // the key came from.
      body: JSON.stringify({ name: `Hermes Desktop (${hostname()})` }),
    });
  } catch (err) {
    return {
      status: "error",
      error: `Couldn't reach the Hermes One backend: ${(err as Error).message}`,
    };
  }
  if (!res.ok) {
    return {
      status: "error",
      error: `Key provisioning failed (HTTP ${res.status}).`,
    };
  }

  const data = (await res.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof data.key === "string" ? data.key.trim() : "";
  if (!key) {
    return { status: "error", error: "Backend returned no key." };
  }

  try {
    setEnvValue("HERMESONE_API_KEY", key, profile);
  } catch (err) {
    return {
      status: "error",
      error: `Couldn't save the key: ${(err as Error).message}`,
    };
  }
  return { status: "created" };
}

/** The signed-in account's AI-credit balance, for the Providers account card. */
export async function fetchHermesOneCredits(): Promise<HermesOneCreditsResult> {
  const session = accountSession();
  if (!session) return { balance: null, error: "signed-out" };

  try {
    const res = await fetch(`${session.apiUrl}/api/credits/balance?limit=1`, {
      headers: {
        ...apiHeaders(false),
        authorization: `Bearer ${session.token}`,
      },
    });
    if (!res.ok) {
      return { balance: null, error: `HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { balance?: unknown };
    const balance = Number(data.balance);
    if (!Number.isFinite(balance)) {
      return { balance: null, error: "Malformed balance." };
    }
    return { balance };
  } catch (err) {
    return { balance: null, error: (err as Error).message };
  }
}
