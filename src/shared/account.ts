// Shared shapes for the Hermes account (device-login) surface, used across the
// main process, preload bridge, and renderer.

export interface HermesAccountUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface HermesAccount {
  apiUrl: string;
  user: HermesAccountUser;
}

/** Outcome of the auto-provisioned Hermes One Inference key check. */
export interface EnsureHermesOneKeyResult {
  status: "created" | "exists" | "signed-out" | "error";
  error?: string;
}

/** The signed-in account's AI-credit balance (USD-denominated; null when
 *  signed out or unavailable). */
export interface HermesOneCreditsResult {
  balance: number | null;
  error?: string;
}

/** Emitted once the backend issues a device code, so the modal can show it. */
export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}
