import { ipcMain } from "electron";
import {
  createProfileFromWizard,
  initialWizardState,
  validateWizardStep,
  activateProfileWithRollback,
} from "../profiles/wizard";
import { listTemplates } from "../profiles/templates";
import type { WizardState } from "../../shared/wizard";
import { deleteProfile } from "../profiles";
import {
  detectAllProfileMigrations,
  detectProfileMigration,
  migratePlaintextEnv,
  removeProfileSecrets,
} from "../vault/service";
import {
  getActiveProfileNameSync,
  isValidNamedProfileName,
  isValidProfileName,
} from "../utils";
import { isRemoteOnlyMode } from "../hermes";
import { unsupportedInRemoteMode } from "./unsupported";

function validProfile(profile: unknown): profile is string {
  return typeof profile === "string" && isValidProfileName(profile);
}

export function registerProfileHandlers(): void {
  ipcMain.handle("profile-list-templates", () => listTemplates());

  ipcMain.handle("profile-initial-wizard-state", (_event, templateId: string) =>
    initialWizardState(templateId),
  );

  ipcMain.handle(
    "profile-validate-wizard-step",
    (_event, step: number, state: WizardState) => validateWizardStep(step, state),
  );

  ipcMain.handle("profile-create-from-wizard", async (_event, state: WizardState) => {
    if (isRemoteOnlyMode()) return unsupportedInRemoteMode("Profile wizard");
    return createProfileFromWizard(state);
  });

  ipcMain.handle("profile-activate", async (_event, profile: string) => {
    if (isRemoteOnlyMode()) return unsupportedInRemoteMode("Profile activation");
    if (!validProfile(profile)) {
      return { success: false, error: "Invalid profile name" };
    }
    try {
      await activateProfileWithRollback(profile);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("profile-detect-migration", () => {
    if (isRemoteOnlyMode()) return unsupportedInRemoteMode("Profile migration");
    return { success: true, profiles: detectAllProfileMigrations() };
  });

  ipcMain.handle("profile-migrate-env", (_event, profile: string) => {
    if (isRemoteOnlyMode()) return unsupportedInRemoteMode("Profile migration");
    if (!validProfile(profile)) {
      return { success: false, error: "Invalid profile name" };
    }
    const count = migratePlaintextEnv(profile);
    return { success: true, migratedCount: count, remainingKeys: detectProfileMigration(profile) };
  });

  ipcMain.handle("profile-delete", (_event, profile: string, archive: boolean) => {
    if (isRemoteOnlyMode()) return unsupportedInRemoteMode("Profile deletion");
    if (!validProfile(profile) || (profile !== "default" && !isValidNamedProfileName(profile))) {
      return { success: false, error: "Invalid profile name" };
    }
    if (archive) {
      return {
        success: false,
        error: "Archive-on-delete is disabled while plaintext secret retention is being hardened.",
      };
    }
    if (getActiveProfileNameSync() === profile) {
      return { success: false, error: "Cannot delete active profile. Switch first." };
    }
    removeProfileSecrets(profile);
    return deleteProfile(profile);
  });
}
