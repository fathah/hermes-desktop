export const BASE_NETWORK_ID = "base" as const;
export const BASE_NETWORK_LABEL = "Base" as const;

export interface ProfileWallet {
  id: string;
  name: string;
  address: string;
  network: typeof BASE_NETWORK_ID;
  createdAt: number;
  imported: boolean;
}

export interface CreateWalletInput {
  profile?: string;
  name?: string;
}

export interface ImportWalletInput {
  profile?: string;
  name?: string;
  recoveryPhrase: string;
}

export interface WalletMutationResult {
  success: boolean;
  wallet?: ProfileWallet;
  recoveryPhrase?: string;
  error?: string;
}

/**
 * A wallet as the pane renders it, from either origin. Local wallets come from
 * the per-profile `wallets.json`; cloud wallets are fetched live from the
 * backend for the profile's linked agent and are never persisted locally.
 */
export interface WalletView {
  id: string;
  name: string;
  address: string;
  network: typeof BASE_NETWORK_ID;
  source: "local" | "cloud";
  createdAt: number;
  /** Local only: whether the wallet was imported vs generated. */
  imported?: boolean;
  /** Cloud only: backend wallet kind ("bankr" | "local" | "external"). */
  kind?: string;
  /** Cloud only: address is receive-only (no custody on this device). */
  receiveOnly?: boolean;
  /** Cloud only: backend can move funds (has a stored transaction secret). */
  canTransact?: boolean;
}

/** Result of fetching the linked agent's cloud wallets. */
export interface WalletSyncResult {
  /** `foreign`: the profile's cloud link belongs to a different account. */
  status: "ok" | "signed-out" | "unlinked" | "foreign" | "error";
  /** Cloud wallets only; the renderer merges local wallets in separately. */
  wallets: WalletView[];
  error?: string;
}

/** One token row of a cloud wallet's portfolio (backend-normalised shape). */
export interface PortfolioTokenView {
  symbol: string;
  name: string;
  /** Human-readable amount (backend normalises decimals). */
  balance: number;
  balanceUsd: number;
}

/** Result of `GET /api/wallets/:id/portfolio` for a profile's cloud wallet. */
export interface WalletPortfolioResult {
  /** `foreign`: the profile's cloud link belongs to a different account. */
  status: "ok" | "signed-out" | "unlinked" | "foreign" | "error";
  totalUsd?: number;
  tokens?: PortfolioTokenView[];
  error?: string;
}

/** Result of provisioning a backend (Bankr) wallet for a profile's agent. */
export interface ProvisionWalletResult {
  /** `exists`: the agent already has a provisioned wallet (backend 409). */
  status: "ok" | "exists" | "signed-out" | "unlinked" | "foreign" | "error";
  wallet?: WalletView;
  error?: string;
}

/** Backend `serializeWallet` shape (the fields the desktop consumes). */
export interface CloudWalletRaw {
  id: string;
  kind: string;
  label: string | null;
  evmAddress: string | null;
  receiveOnly: boolean;
  canTransact: boolean;
  createdAt: string;
}
