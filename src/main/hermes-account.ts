// @lat: [[hermes-account-login#Device login client]]
import { hostname } from "os";
import { saveAccount, type AccountUser } from "./account-store";
import { normalizeApiUrl } from "./api-url";

// Signs the desktop app into a Hermes account using the OAuth 2.0 Device
// Authorization Grant (RFC 8628) served by hermes-one-backend: request a code,
// have the user approve it in the browser, then poll until a bearer token can be
// redeemed. The browser is opened by the IPC layer (mirrors hermes-auth.ts);
// this module owns the network + polling + secure storage.

const DEFAULT_API_URL = "http://localhost:3002";

/**
 * Backend base URL, resolved fresh on every call so switching backends is just
 * an env edit + app restart (no rebuild). Order:
 *   1. `HERMES_API_URL` — explicit runtime override
 *   2. `MAIN_VITE_HERMES_API_URL` from the environment — in dev this comes from
 *      the project `.env` (loaded into process.env at startup by load-env.ts),
 *      so editing `.env` and relaunching points the app at a real backend.
 *   3. the build-time baked `import.meta.env.MAIN_VITE_HERMES_API_URL` — this is
 *      what packaged/CI builds carry (the release workflow injects it).
 *   4. the local Nitro dev server default.
 * `import.meta.env` is inlined at BUILD time, so on its own it can't reflect a
 * `.env` change without a rebuild — the runtime `process.env` reads above are
 * what make the endpoint truly env-driven. The resolved value is normalized
 * (see {@link normalizeApiUrl}) so a remote `http://` URL can't strip the auth
 * header via an http→https redirect.
 */
export function getApiUrl(): string {
  const fromEnv =
    process.env.HERMES_API_URL?.trim() ||
    process.env.MAIN_VITE_HERMES_API_URL?.trim() ||
    (import.meta.env.MAIN_VITE_HERMES_API_URL as string | undefined)?.trim();
  return fromEnv ? normalizeApiUrl(fromEnv) : DEFAULT_API_URL;
}

/**
 * Optional client API key sent as `x-api-key` on backend calls, resolved with
 * the same runtime-first order as {@link getApiUrl} (`HERMES_API_KEY` →
 * `MAIN_VITE_HERMES_API_KEY` from env/`.env` → build-time baked value). Empty
 * when none is set (the backend doesn't require it yet). Note a key shipped
 * inside a desktop binary is extractable — it can rate-limit casual abuse, but
 * it is not a real secret.
 */
export function getApiKey(): string {
  return (
    process.env.HERMES_API_KEY?.trim() ||
    process.env.MAIN_VITE_HERMES_API_KEY?.trim() ||
    (import.meta.env.MAIN_VITE_HERMES_API_KEY as string | undefined)?.trim() ||
    ""
  );
}

/** Headers for backend API calls: content type plus the client key when set. */
export function apiHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["content-type"] = "application/json";
  const key = getApiKey();
  if (key) headers["x-api-key"] = key;
  return headers;
}

/** A human label for this machine, shown on the browser approval page. */
function deviceName(): string {
  try {
    return hostname() || "Unknown device";
  } catch {
    return "Unknown device";
  }
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface AccountLoginResult {
  success: boolean;
  user?: AccountUser;
  error?: string;
}

interface TokenResponse {
  access_token?: string;
  user?: Partial<AccountUser> & { id?: string };
  error?: string;
}

export type PollAction =
  | { kind: "success"; accessToken: string; user: AccountUser }
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "error"; error: string };

function normalizeUser(user: TokenResponse["user"]): AccountUser {
  return {
    id: typeof user?.id === "string" ? user.id : "",
    email: typeof user?.email === "string" ? user.email : null,
    name: typeof user?.name === "string" ? user.name : null,
    avatarUrl: typeof user?.avatarUrl === "string" ? user.avatarUrl : null,
  };
}

/**
 * Pure interpretation of a `/api/device/token` response into the next polling
 * action. Kept separate from the loop so the RFC 8628 branch logic is unit
 * testable without a live server.
 */
export function interpretTokenResponse(
  ok: boolean,
  status: number,
  data: TokenResponse,
): PollAction {
  if (ok && data.access_token) {
    return {
      kind: "success",
      accessToken: data.access_token,
      user: normalizeUser(data.user),
    };
  }
  switch (data.error) {
    case "authorization_pending":
      return { kind: "pending" };
    case "slow_down":
      return { kind: "slow_down" };
    case "access_denied":
      return { kind: "error", error: "Sign-in was denied in the browser." };
    case "expired_token":
      return { kind: "error", error: "The code expired. Please try again." };
    default:
      return {
        kind: "error",
        error: data.error
          ? `Sign-in failed: ${data.error}`
          : `Sign-in failed (HTTP ${status}).`,
      };
  }
}

// Single-flight: one interactive login at a time, matching the renderer's single
// modal. Tracked so the renderer can cancel a flow the user abandoned.
let activeLogin: { cancelled: boolean } | null = null;

export function isAccountLoginActive(): boolean {
  return activeLogin !== null;
}

function sleep(ms: number, state: { cancelled: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const step = 200;
    let waited = 0;
    const timer = setInterval(() => {
      waited += step;
      if (state.cancelled || waited >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, step);
  });
}

/**
 * Run the full device-login flow for `profile`. Calls `onCode` once the code is
 * issued (so the browser can be opened and the code shown), streams human
 * progress to `emit`, and on success persists the encrypted session before
 * resolving.
 */
export async function startDeviceLogin(
  profile: string | undefined,
  handlers: {
    onCode: (info: DeviceCodeInfo) => void;
    emit: (chunk: string) => void;
  },
): Promise<AccountLoginResult> {
  if (activeLogin) {
    return { success: false, error: "Another sign-in is already in progress." };
  }
  const state = { cancelled: false };
  activeLogin = state;
  const apiUrl = getApiUrl();

  try {
    // Send the machine hostname so the approval page can show which device is
    // signing in (the backend also records the request IP).
    const codeRes = await fetch(`${apiUrl}/api/device/code`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ device_name: deviceName() }),
    });
    if (!codeRes.ok) {
      return {
        success: false,
        error: `Couldn't start sign-in (HTTP ${codeRes.status}).`,
      };
    }
    const code = (await codeRes.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
      expires_in: number;
      interval: number;
    };

    handlers.onCode({
      userCode: code.user_code,
      verificationUri: code.verification_uri,
      verificationUriComplete: code.verification_uri_complete,
      expiresIn: code.expires_in,
      interval: code.interval,
    });
    handlers.emit(
      `Enter code ${code.user_code} at ${code.verification_uri} to sign in.\n` +
        `Opening your browser…\n`,
    );

    let intervalMs = Math.max(1, code.interval) * 1000;
    const deadline = Date.now() + Math.max(0, code.expires_in) * 1000;

    while (!state.cancelled) {
      await sleep(intervalMs, state);
      if (state.cancelled) break;
      if (Date.now() > deadline) {
        return { success: false, error: "The code expired. Please try again." };
      }

      let action: PollAction;
      try {
        const tokRes = await fetch(`${apiUrl}/api/device/token`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({ device_code: code.device_code }),
        });
        const data = (await tokRes.json().catch(() => ({}))) as TokenResponse;
        action = interpretTokenResponse(tokRes.ok, tokRes.status, data);
      } catch (err) {
        // Transient network blip while polling: keep trying until the deadline.
        handlers.emit(`Waiting… (${(err as Error).message})\n`);
        continue;
      }

      if (action.kind === "success") {
        saveAccount(profile, {
          apiUrl,
          accessToken: action.accessToken,
          user: action.user,
        });
        const who = action.user.email ?? action.user.name ?? action.user.id;
        handlers.emit(`Signed in as ${who}.\n`);
        return { success: true, user: action.user };
      }
      if (action.kind === "slow_down") {
        intervalMs += 5000;
        continue;
      }
      if (action.kind === "error") {
        return { success: false, error: action.error };
      }
      // pending → keep polling
    }

    return { success: false, error: "Sign-in cancelled." };
  } catch (err) {
    return {
      success: false,
      error: `Sign-in error: ${(err as Error).message}`,
    };
  } finally {
    activeLogin = null;
  }
}

/** Cancel an in-flight device login, if any. */
export function cancelDeviceLogin(): boolean {
  if (!activeLogin) return false;
  activeLogin.cancelled = true;
  return true;
}
