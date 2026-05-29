import { existsSync, readFileSync, renameSync, rmSync, cpSync, mkdirSync } from "fs";
import { join } from "path";
import type { StepValidationResult, WizardCreateResult, WizardState } from "../../shared/wizard";
import { getTemplate } from "./templates";
import { createProfile, deleteProfile } from "../profiles";
import { setModelConfig, setPlatformEnabled } from "../config";
import { writeSoul } from "../soul";
import { setToolsetEnabled, getToolsets } from "../tools";
import {
  addCredential,
  activateProfile as vaultActivate,
  removeProfileSecrets,
  copyProfileSecrets,
} from "../vault/service";
import { profileHome, safeWriteFile, isValidNamedProfileName } from "../utils";
import { HERMES_HOME } from "../installer";
import { startGateway, isGatewayRunning, restartGateway, waitForGatewayReady } from "../hermes";
import { setActiveProfile } from "../profiles";

const ALL_TOOLSET_KEYS = [
  "web", "browser", "terminal", "file", "code_execution", "vision",
  "image_gen", "tts", "skills", "memory", "session_search", "clarify",
  "delegation",
];

export function validateWizardStep(step: number, state: WizardState): StepValidationResult {
  const errors: string[] = [];

  if (step === 1) {
    if (!state.profileName?.trim()) errors.push("Profile name is required");
    if (state.profileName?.match(/[^a-zA-Z0-9-_]/)) {
      errors.push("Profile name can only contain letters, numbers, hyphens, and underscores");
    }
    if (!state.templateId) errors.push("Template selection is required");
  }

  if (step === 2) {
    if (!state.primaryProvider) errors.push("Primary provider is required");
    if (!state.primaryApiKey?.trim()) errors.push("Primary API key is required");
    if (state.primaryApiKey && state.primaryApiKey.length < 8) {
      errors.push("Invalid API key format (too short)");
    }
    if (state.fallbackProvider && !state.fallbackApiKey?.trim()) {
      errors.push("Fallback API key is required when fallback provider is selected");
    }
    if (!state.selectedModels?.length) errors.push("At least one model must be selected");
  }

  if (step === 3) {
    const enabledTools = state.toolsets?.filter((t) => t.enabled).map((t) => t.key) || [];
    if (enabledTools.length === 0) errors.push("At least one toolset must be enabled");
    const webEnabled = enabledTools.includes("web");
    if (webEnabled && !state.firecrawlApiKey?.trim()) {
      errors.push("Firecrawl API key is required for web tools");
    }
  }

  if (step === 5) {
    const enabledChannels = state.channels?.filter((c) => c.enabled) || [];
    for (const channel of enabledChannels) {
      if (!channel.token?.trim()) {
        errors.push(`${channel.name} token is required when enabled`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateWizardState(state: WizardState): StepValidationResult {
  for (const step of [1, 2, 3, 5]) {
    const result = validateWizardStep(step, state);
    if (!result.valid) return result;
  }
  return { valid: true, errors: [] };
}

function atomicWrite(path: string, content: string): void {
  const temp = `${path}.tmp`;
  safeWriteFile(temp, content);
  renameSync(temp, path);
}

function writeModelSettings(profile: string, settings?: { temperature?: number; max_tokens?: number }): void {
  if (!settings) return;
  const configFile = join(profileHome(profile), "config.yaml");
  let content = existsSync(configFile) ? readFileSync(configFile, "utf-8") : "";
  const lines: string[] = [];
  if (settings.temperature !== undefined) {
    lines.push(`  temperature: ${settings.temperature}`);
  }
  if (settings.max_tokens !== undefined) {
    lines.push(`  max_tokens: ${settings.max_tokens}`);
  }
  if (lines.length === 0) return;

  if (content.includes("model:")) {
    const modelBlock = content.match(/^model:[^\n]*\n((?:  .+\n)*)/m);
    if (modelBlock) {
      let block = modelBlock[0];
      for (const line of lines) {
        const key = line.trim().split(":")[0];
        if (new RegExp(`^  ${key}:`).test(block)) {
          block = block.replace(new RegExp(`^  ${key}:.*$`, "m"), line);
        } else {
          block = block.trimEnd() + "\n" + line + "\n";
        }
      }
      content = content.replace(modelBlock[0], block);
    }
  }
  atomicWrite(configFile, content);
}

function configureToolsets(profile: string, toolsets: WizardState["toolsets"]): void {
  const enabled = new Set(toolsets.filter((t) => t.enabled).map((t) => t.key));
  for (const key of ALL_TOOLSET_KEYS) {
    setToolsetEnabled(key, enabled.has(key), profile);
  }
}

function storeSecrets(state: WizardState, profile: string): void {
  addCredential(profile, state.primaryProvider, "Primary provider", state.primaryApiKey);
  if (state.fallbackProvider && state.fallbackApiKey) {
    addCredential(profile, state.fallbackProvider, "Fallback provider", state.fallbackApiKey);
  }
  if (state.firecrawlApiKey?.trim()) {
    addCredential(profile, "firecrawl", "Firecrawl", state.firecrawlApiKey.trim());
  }
  if (state.falApiKey?.trim()) {
    addCredential(profile, "fal", "FAL", state.falApiKey.trim());
  }
  if (state.browserbaseApiKey?.trim()) {
    addCredential(profile, "browserbase", "Browserbase", state.browserbaseApiKey.trim());
  }
  for (const ch of state.channels.filter((c) => c.enabled && c.token)) {
    addCredential(profile, ch.name, `${ch.name} channel`, ch.token!);
  }
}

export async function createProfileFromWizard(state: WizardState): Promise<WizardCreateResult> {
  const validation = validateWizardState(state);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join("; ") };
  }

  const name = state.profileName.trim().toLowerCase();
  if (!isValidNamedProfileName(name)) {
    return { success: false, error: "Invalid profile name" };
  }

  const template = getTemplate(state.templateId);
  const backupDir = join(HERMES_HOME, "desktop", "wizard-backup", `${name}-${Date.now()}`);

  try {
    const createResult = createProfile(name, false);
    if (!createResult.success) {
      return { success: false, error: createResult.error };
    }

    const primaryModel = state.selectedModels[0] || "";
    setModelConfig(
      state.primaryProvider,
      primaryModel,
      state.primaryBaseUrl,
      name,
    );

    if (state.fallbackProvider && state.fallbackBaseUrl) {
      // Store fallback in config as comment block — Hermes uses credential pool for fallback
    }

    writeModelSettings(name, template?.configOverrides?.model);
    configureToolsets(name, state.toolsets);
    writeSoul(state.soulContent, name);
    storeSecrets(state, name);

    for (const ch of state.channels.filter((c) => c.enabled)) {
      setPlatformEnabled(ch.name, true, name);
    }

    if (state.activateAfterCreate) {
      await activateProfileWithRollback(name);
    }

    return { success: true, profilePath: profileHome(name) };
  } catch (err) {
    try {
      if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
      deleteProfile(name);
      removeProfileSecrets(name);
    } catch {
      // best effort rollback
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function activateProfileWithRollback(profile: string): Promise<void> {
  const home = profileHome(profile);
  mkdirSync(join(HERMES_HOME, "desktop", "activation-backup"), { recursive: true });
  const backupDir = join(HERMES_HOME, "desktop", "activation-backup", `${profile}-${Date.now()}`);

  try {
    mkdirSync(backupDir, { recursive: true });
    for (const file of [".env", "auth.json", "config.yaml", "SOUL.md"]) {
      const src = join(home, file);
      if (existsSync(src)) cpSync(src, join(backupDir, file));
    }

    vaultActivate(profile);
    setActiveProfile(profile);

    const restarting = isGatewayRunning();
    if (restarting) {
      restartGateway(profile);
    } else {
      startGateway(profile);
    }

    const ready = await waitForGatewayReady(30_000, { afterRestart: restarting });
    if (!ready) {
      throw new Error("Gateway failed to start within 30 seconds");
    }
  } catch (err) {
    for (const file of [".env", "auth.json", "config.yaml", "SOUL.md"]) {
      const backup = join(backupDir, file);
      if (existsSync(backup)) {
        cpSync(backup, join(home, file));
      }
    }
    throw err;
  }
}

export function cloneProfileWithVault(
  sourceProfile: string,
  newName: string,
): WizardCreateResult {
  const createResult = createProfile(newName, true);
  if (!createResult.success) {
    return { success: false, error: createResult.error };
  }
  try {
    copyProfileSecrets(sourceProfile, newName);
  } catch (err) {
    removeProfileSecrets(newName);
    deleteProfile(newName);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { success: true, profilePath: profileHome(newName) };
}

export function initialWizardState(templateId: string): WizardState {
  const template = getTemplate(templateId) || getTemplate("research")!;
  return {
    profileName: "",
    templateId: template.id,
    primaryProvider: template.defaultProvider.name,
    primaryBaseUrl: template.defaultProvider.baseUrl,
    primaryApiKey: "",
    fallbackProvider: template.fallbackProvider?.name,
    fallbackBaseUrl: template.fallbackProvider?.baseUrl,
    fallbackApiKey: "",
    selectedModels: [],
    toolsets: getToolsets().map((t) => ({
      key: t.key,
      enabled: template.toolsets.includes(t.key),
    })),
    soulContent: template.soulTemplate,
    channels: [
      { name: "telegram", enabled: false },
      { name: "discord", enabled: false },
      { name: "slack", enabled: false },
    ],
    activateAfterCreate: true,
  };
}
