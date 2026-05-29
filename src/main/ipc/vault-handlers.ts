import { ipcMain } from "electron";
import {
  addCredential,
  getCredentials,
  updateCredential,
  removeCredential,
  getCredentialAuditLog,
  rotateMasterKey,
  exportVaultBlob,
  initVault,
  vaultIsPopulated,
} from "../vault/service";
import { isEncryptionAvailable, initVaultWithPassword } from "../vault/keychain";

export function registerVaultHandlers(): void {
  ipcMain.handle(
    "vault-add-credential",
    (_event, profile: string, provider: string, label: string, value: string) => {
      return addCredential(profile, provider, label, value);
    },
  );

  ipcMain.handle("vault-get-credentials", (_event, profile: string) => {
    return getCredentials(profile);
  });

  ipcMain.handle(
    "vault-update-credential",
    (_event, id: string, updates: { label?: string; value?: string }) => {
      updateCredential(id, updates);
      return { success: true };
    },
  );

  ipcMain.handle("vault-delete-credential", (_event, id: string) => {
    removeCredential(id);
    return { success: true };
  });

  ipcMain.handle("vault-get-audit-log", (_event, profile: string) => {
    return getCredentialAuditLog(profile);
  });

  ipcMain.handle("vault-rotate-master-key", () => {
    return rotateMasterKey();
  });

  ipcMain.handle("vault-export", () => {
    const blob = exportVaultBlob();
    return blob.toString("base64");
  });

  ipcMain.handle("vault-is-populated", () => {
    return vaultIsPopulated();
  });

  ipcMain.handle("vault-encryption-available", () => {
    return isEncryptionAvailable();
  });

  ipcMain.handle("vault-init-with-password", (_event, password: string) => {
    initVaultWithPassword(password);
    initVault();
    return { success: true };
  });
}
