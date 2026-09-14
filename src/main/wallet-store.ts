// @lat: [[wallet-token-balances#Wallet Store]]
import { safeStorage } from "electron";
import { existsSync, readFileSync } from "fs";
import { randomBytes, randomUUID } from "crypto";
import { join } from "path";
import { Mnemonic, Wallet } from "ethers";
import {
  BASE_NETWORK_ID,
  type ImportWalletInput,
  type ProfileWallet,
  type WalletMutationResult,
} from "../shared/wallets";
import { isValidProfileName, profileHome, safeWriteFile } from "./utils";

const WALLET_FILE = "wallets.json";
const MAX_WALLETS_PER_PROFILE = 10;
const DEFAULT_WALLET_NAME = "Base wallet";
const GENERIC_CREATE_ERROR = "Couldn't add wallet for this profile.";

interface StoredWallet extends ProfileWallet {
  encryptedRecoveryPhrase: string;
}

interface WalletFile {
  version: 1;
  wallets: StoredWallet[];
}

function walletPath(profile?: string): string {
  return join(profileHome(profile), WALLET_FILE);
}

function publicWallet(wallet: StoredWallet): ProfileWallet {
  const { encryptedRecoveryPhrase: _encryptedRecoveryPhrase, ...safeWallet } =
    wallet;
  return safeWallet;
}

function normalizeName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed.slice(0, 80) || DEFAULT_WALLET_NAME;
}

function normalizeRecoveryPhrase(phrase: unknown): string {
  if (typeof phrase !== "string") return "";
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

function randomEntropyHex(bytes = 16): string {
  return Array.from(randomBytes(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function encryptRecoveryPhrase(phrase: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure wallet storage is not available on this device.");
  }
  return safeStorage.encryptString(phrase).toString("base64");
}

function readWalletFile(profile?: string): WalletFile {
  const file = walletPath(profile);
  if (!existsSync(file)) return { version: 1, wallets: [] };
  const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<WalletFile>;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.wallets)) {
    return { version: 1, wallets: [] };
  }
  return {
    version: 1,
    wallets: parsed.wallets.filter(isStoredWallet),
  };
}

function writeWalletFile(profile: string | undefined, data: WalletFile): void {
  safeWriteFile(walletPath(profile), JSON.stringify(data, null, 2));
}

function isStoredWallet(value: unknown): value is StoredWallet {
  const wallet = value as Partial<StoredWallet>;
  return (
    !!wallet &&
    typeof wallet.id === "string" &&
    typeof wallet.name === "string" &&
    typeof wallet.address === "string" &&
    wallet.network === BASE_NETWORK_ID &&
    typeof wallet.createdAt === "number" &&
    typeof wallet.imported === "boolean" &&
    typeof wallet.encryptedRecoveryPhrase === "string"
  );
}

function validateProfile(profile?: string): string | undefined {
  const normalized =
    profile === "" || profile === "default" ? undefined : profile;
  if (normalized !== undefined && !isValidProfileName(normalized)) {
    throw new Error("Invalid profile name.");
  }
  return normalized;
}

function canAddWallet(data: WalletFile): boolean {
  return data.wallets.length < MAX_WALLETS_PER_PROFILE;
}

export function listWallets(profile?: string): ProfileWallet[] {
  const normalizedProfile = validateProfile(profile);
  return readWalletFile(normalizedProfile).wallets.map(publicWallet);
}

export function createWallet(
  profile?: string,
  name?: string,
): WalletMutationResult {
  try {
    const normalizedProfile = validateProfile(profile);
    const data = readWalletFile(normalizedProfile);
    if (!canAddWallet(data)) {
      return { success: false, error: GENERIC_CREATE_ERROR };
    }

    const recoveryPhrase = Mnemonic.entropyToPhrase(`0x${randomEntropyHex()}`);
    const wallet = Wallet.fromPhrase(recoveryPhrase);

    const stored: StoredWallet = {
      id: randomUUID(),
      name: normalizeName(name),
      address: wallet.address,
      network: BASE_NETWORK_ID,
      createdAt: Date.now(),
      imported: false,
      encryptedRecoveryPhrase: encryptRecoveryPhrase(recoveryPhrase),
    };

    data.wallets.push(stored);
    writeWalletFile(normalizedProfile, data);
    return {
      success: true,
      wallet: publicWallet(stored),
      recoveryPhrase,
    };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || GENERIC_CREATE_ERROR,
    };
  }
}

export function importWallet(input: ImportWalletInput): WalletMutationResult {
  let normalizedProfile: string | undefined;
  try {
    normalizedProfile = validateProfile(input.profile);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  // Phrase validation is the only failure that should surface as "invalid
  // phrase". Storage/encryption failures past this point are reported with
  // their own message so the user isn't told a valid phrase is wrong.
  const recoveryPhrase = normalizeRecoveryPhrase(input.recoveryPhrase);
  let wallet: ReturnType<typeof Wallet.fromPhrase> | null = null;
  try {
    wallet = Wallet.fromPhrase(recoveryPhrase);
  } catch {
    return { success: false, error: "Enter a valid recovery phrase." };
  }

  try {
    const data = readWalletFile(normalizedProfile);
    if (!canAddWallet(data)) {
      return { success: false, error: GENERIC_CREATE_ERROR };
    }
    if (
      data.wallets.some(
        (existing) =>
          existing.address.toLowerCase() === wallet.address.toLowerCase(),
      )
    ) {
      return { success: false, error: "This wallet is already added." };
    }

    const stored: StoredWallet = {
      id: randomUUID(),
      name: normalizeName(input.name),
      address: wallet.address,
      network: BASE_NETWORK_ID,
      createdAt: Date.now(),
      imported: true,
      encryptedRecoveryPhrase: encryptRecoveryPhrase(recoveryPhrase),
    };

    data.wallets.push(stored);
    writeWalletFile(normalizedProfile, data);
    return {
      success: true,
      wallet: publicWallet(stored),
      recoveryPhrase,
    };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || GENERIC_CREATE_ERROR,
    };
  }
}

export function renameWallet(
  profile: string | undefined,
  id: string,
  name: string,
): { success: boolean; error?: string } {
  try {
    const normalizedProfile = validateProfile(profile);
    const data = readWalletFile(normalizedProfile);
    const wallet = data.wallets.find((item) => item.id === id);
    if (!wallet) return { success: false, error: "Wallet not found." };
    wallet.name = normalizeName(name);
    writeWalletFile(normalizedProfile, data);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function deleteWallet(
  profile: string | undefined,
  id: string,
): { success: boolean; error?: string } {
  try {
    const normalizedProfile = validateProfile(profile);
    const data = readWalletFile(normalizedProfile);
    const nextWallets = data.wallets.filter((wallet) => wallet.id !== id);
    if (nextWallets.length === data.wallets.length) {
      return { success: false, error: "Wallet not found." };
    }
    writeWalletFile(normalizedProfile, { ...data, wallets: nextWallets });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
