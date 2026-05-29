import { ipcMain } from "electron";
import { existsSync, readFileSync, writeFileSync, renameSync, cpSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  createProfileFromWizard,
  activateProfileWithRollback,
  cloneProfileWithVault,
  initialWizardState,
  validateWizardStep,
} from "../profiles/wizard";
import { listTemplates } from "../profiles/templates";
import type { WizardState } from "../../shared/wizard";
import { deleteProfile } from "../profiles";
import {
  deactivateProfile,
  removeProfileSecrets,
  migratePlaintextEnv,
  parseEnvFile,
  vaultIsPopulated,
} from "../vault/service";
import { profileHome, profilePaths } from "../utils";
import { HERMES_HOME } from "../installer";
import { getActiveProfileNameSync } from "../utils";

export function registerProfileHandlers(): void {
  ipcMain.handle("profile-list-templates", () => listTemplates());

  ipcMain.handle("profile-initial-wizard-state", (_event, templateId: string) =>
    initialWizardState(templateId),
  );

  ipcMain.handle(
    "profile-validate-wizard-step",
    (_event, step: number, state: WizardState) => validateWizardStep(step, state),
  );

  ipcMain.handle("profile-create-from-wizard", async (_event, state: WizardState) =>
    createProfileFromWizard(state),
  );

  ipcMain.handle("profile-activate", async (_event, profile: string) => {
    try {
      await activateProfileWithRollback(profile);
      return { success: true, profile, status: "connected" as const };
    } catch (err) {
      return {
        success: false,
        profile,
        status: "disconnected" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    "profile-deactivate",
    (_event, profile: string, wipe?: boolean) => {
      deactivateProfile(profile, wipe ?? false);
      return { success: true };
    },
  );

  ipcMain.handle(
    "profile-delete",
    (_event, profile: string, archive: boolean) => {
      if (getActiveProfileNameSync() === profile) {
        return { success: false, error: "Cannot delete active profile. Switch first." };
      }
      const home = profileHome(profile);
      if (archive) {
        const dest = join(HERMES_HOME, "archived-profiles", profile);
        mkdirSync(join(HERMES_HOME, "archived-profiles"), { recursive: true });
        if (existsSync(home)) {
          cpSync(home, dest, { recursive: true });
        }
      }
      removeProfileSecrets(profile);
      return deleteProfile(profile);
    },
  );

  ipcMain.handle("profile-clone",
    (_event, sourceProfile: string, newName: string) =>
      cloneProfileWithVault(sourceProfile, newName),
  );

  ipcMain.handle("profile-detect-migration", () => {
    if (vaultIsPopulated()) return [];

    const results: Array<{ name: string; keyCount: number; envPath: string }> = [];

    function scanProfile(name: string, home: string): void {
      const envPath = join(home, ".env");
      if (!existsSync(envPath)) return;
      const content = readFileSync(envPath, "utf-8");
      const keys = Object.keys(parseEnvFile(content));
      if (keys.length > 0) {
        results.push({ name, keyCount: keys.length, envPath });
      }
    }

    scanProfile("default", HERMES_HOME);
    const profilesDir = join(HERMES_HOME, "profiles");
    if (existsSync(profilesDir)) {
      for (const name of readdirSync(profilesDir)) {
        if (name.startsWith(".")) continue;
        const p = join(profilesDir, name);
        if (statSync(p).isDirectory()) scanProfile(name, p);
      }
    }
    return results;
  });

  ipcMain.handle(
    "profile-migrate-secrets",
    (_event, profiles: string[]) => {
      const migrated: Array<{ name: string; imported: boolean; vaultEntries: number; error?: string }> = [];

      for (const name of profiles) {
        try {
          const { envFile } = profilePaths(name === "default" ? undefined : name);
          if (!existsSync(envFile)) {
            migrated.push({ name, imported: false, vaultEntries: 0, error: "No .env file" });
            continue;
          }
          const content = readFileSync(envFile, "utf-8");
          const backupPath = `${envFile}.backup`;
          cpSync(envFile, backupPath);
          const count = migratePlaintextEnv(name, content);
          safeWriteManagedEnv(envFile);
          migrated.push({ name, imported: true, vaultEntries: count });
        } catch (err) {
          migrated.push({
            name,
            imported: false,
            vaultEntries: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return migrated;
    },
  );
}

function safeWriteManagedEnv(envFile: string): void {
  const content =
    "# Managed by Hermes Workspace — secrets encrypted in vault.db\n" +
    "# Original backed up to .env.backup\n";
  const temp = `${envFile}.tmp`;
  writeFileSync(temp, content, "utf-8");
  renameSync(temp, envFile);
}
