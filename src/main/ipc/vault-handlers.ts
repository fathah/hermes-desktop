import { ipcMain } from "electron";
import {
  addCredential,
  credentialBelongsToProfile,
  getCredentials,
  updateCredential,
  removeCredential,
  getCredentialAuditLog,
  initVault,
  vaultIsPopulated,
} from "../vault/service";
import { isEncryptionAvailable, initVaultWithPassword } from "../vault/keychain";
import { isRemoteOnlyMode } from "../hermes";
import { unsupportedInRemoteMode } from "./unsupported";
import { isValidProfileName } from "../utils";

function unsupportedInRemote(): ReturnType<typeof unsupportedInRemoteMode> {
  return unsupportedInRemoteMode("Vault");
}

function invalid(error: string): { success: false; error: string } {
  return { success: false, error };
}

function validProfile(profile: unknown): profile is string {
  return typeof profile === "string" && isValidProfileName(profile);
}

function validId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
}

export function registerVaultHandlers(): void {
  ipcMain.handle(
    "vault-add-credential",
    (_event, profile: string, provider: string, label: string, value: string) => {
      if (isRemoteOnlyMode()) return unsupportedInRemote();
      if (!validProfile(profile)) return invalid("Invalid profile name.");
      if (typeof provider !== "string" || !provider.trim()) return invalid("Provider is required.");
      if (typeof label !== "string") return invalid("Label must be a string.");
      if (typeof value !== "string" || !value) return invalid("Credential value is required.");
      return addCredential(profile, provider, label, value);
    },
  );

  ipcMain.handle("vault-get-credentials", (_event, profile: string) => {
    if (isRemoteOnlyMode()) return unsupportedInRemote();
    if (!validProfile(profile)) return invalid("Invalid profile name.");
    return getCredentials(profile);
  });

  ipcMain.handle(
    "vault-update-credential",
    (_event, profile: string, id: string, updates: { label?: string; value?: string }) => {
      if (isRemoteOnlyMode()) return unsupportedInRemote();
      if (!validProfile(profile)) return invalid("Invalid profile name.");
      if (!validId(id)) return invalid("Invalid credential id.");
      if (!credentialBelongsToProfile(id, profile)) return invalid("Credential not found for profile.");
      if (
        !updates ||
        (updates.label !== undefined && typeof updates.label !== "string") ||
        (updates.value !== undefined && typeof updates.value !== "string")
      ) {
        return invalid("Invalid credential update.");
      }
      updateCredential(id, updates);
      return { success: true };
    },
  );

  ipcMain.handle("vault-delete-credential", (_event, profile: string, id: string) => {
    if (isRemoteOnlyMode()) return unsupportedInRemote();
    if (!validProfile(profile)) return invalid("Invalid profile name.");
    if (!validId(id)) return invalid("Invalid credential id.");
    if (!credentialBelongsToProfile(id, profile)) return invalid("Credential not found for profile.");
    removeCredential(id);
    return { success: true };
  });

  ipcMain.handle("vault-get-audit-log", (_event, profile: string) => {
    if (isRemoteOnlyMode()) return unsupportedInRemote();
    if (!validProfile(profile)) return invalid("Invalid profile name.");
    return getCredentialAuditLog(profile);
  });

  ipcMain.handle("vault-is-populated", () => {
    if (isRemoteOnlyMode()) return false;
    return vaultIsPopulated();
  });

  ipcMain.handle("vault-encryption-available", () => {
    return isEncryptionAvailable();
  });

  ipcMain.handle("vault-init-with-password", (_event, password: string) => {
    if (isRemoteOnlyMode()) return unsupportedInRemote();
    if (typeof password !== "string" || password.length < 8) {
      return invalid("Password must be at least 8 characters.");
    }
    initVaultWithPassword(password);
    initVault();
    return { success: true };
  });
}
