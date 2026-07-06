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
