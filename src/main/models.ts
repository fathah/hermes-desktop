import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { HERMES_HOME } from "./installer";
import { safeWriteFile, profilePaths } from "./utils";
import DEFAULT_MODELS from "./default-models";

const MODELS_FILE = join(HERMES_HOME, "models.json");

export interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiMode?: string | null;
  createdAt: number;
}

export function readModels(): SavedModel[] {
  try {
    if (!existsSync(MODELS_FILE)) return [];
    return JSON.parse(readFileSync(MODELS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeModels(models: SavedModel[]): void {
  safeWriteFile(MODELS_FILE, JSON.stringify(models, null, 2));
}

interface CustomProviderEntry {
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  apiMode?: string;
}

function loadCustomProviders(profile?: string): CustomProviderEntry[] {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return [];
  const content = readFileSync(configFile, "utf-8");
  const result: CustomProviderEntry[] = [];
  const lines = content.split("\n");
  let inCustom = false;
  let current: CustomProviderEntry | null = null;
  for (const line of lines) {
    if (/^\s*custom_providers\s*:/.test(line)) {
      inCustom = true;
      continue;
    }
    if (inCustom) {
      if (/^\s*-\s*name\s*:/.test(line)) {
        if (current && current.model && current.baseUrl) result.push(current);
        const m = line.match(/name\s*:\s*["']?([^"'\n#]+)["']?/);
        current = {
          name: m ? m[1].trim() : "Custom",
          provider: "custom",
          model: "",
          baseUrl: "",
        };
      } else if (current) {
        const bm = line.match(/base_url\s*:\s*["']?([^"'\n#]+)["']?/);
        if (bm) current.baseUrl = bm[1].trim();
        const mm = line.match(/^\s*model\s*:\s*["']?([^"'\n#]+)["']?/);
        if (mm) current.model = mm[1].trim();
        const am = line.match(/api_key\s*:\s*["']?([^"'\n#]+)["']?/);
        if (am) current.apiKey = am[1].trim();
        const apim = line.match(/api_mode\s*:\s*["']?([^"'\n#]+)["']?/);
        if (apim) current.apiMode = apim[1].trim();
      }
      if (
        /^[a-z]/.test(line) &&
        !/^\s/.test(line) &&
        !/^\s*-\s*name/.test(line)
      ) {
        if (current && current.model && current.baseUrl) result.push(current);
        inCustom = false;
        current = null;
      }
    }
  }
  if (current && current.model && current.baseUrl) result.push(current);
  return result;
}

function seedDefaults(profile?: string): SavedModel[] {
  const models: SavedModel[] = DEFAULT_MODELS.map((m) => ({
    id: randomUUID(),
    name: m.name,
    provider: m.provider,
    model: m.model,
    baseUrl: m.baseUrl,
    createdAt: Date.now(),
  }));
  try {
    const { envFile } = profilePaths(profile);
    const cpModels = loadCustomProviders(profile);
    for (const cp of cpModels) {
      models.push({
        id: randomUUID(),
        name: cp.name,
        provider: cp.provider,
        model: cp.model,
        baseUrl: cp.baseUrl,
        apiMode: cp.apiMode || null,
        createdAt: Date.now(),
      });
      if (cp.apiKey) {
        try {
          let envContent = existsSync(envFile)
            ? readFileSync(envFile, "utf-8")
            : "";
          const envKey =
            "CUSTOM_PROVIDER_" +
            cp.name.replace(/[^A-Za-z0-9]/g, "_").toUpperCase() +
            "_KEY";
          const keyRegex = new RegExp(
            "^" + envKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=.*$",
            "m",
          );
          if (!keyRegex.test(envContent)) {
            envContent =
              envContent.trimEnd() + "\n" + envKey + "=" + cp.apiKey + "\n";
            safeWriteFile(envFile, envContent);
          }
        } catch {
          /* best-effort */
        }
      }
    }
  } catch (e) {
    console.error("Failed to load custom providers:", e);
  }
  writeModels(models);
  return models;
}

export function listModels(): SavedModel[] {
  if (!existsSync(MODELS_FILE)) {
    return seedDefaults();
  }
  return readModels();
}

export function addModel(
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
): SavedModel {
  const models = readModels();

  // Dedup: if same model ID + provider exists, return existing
  const existing = models.find(
    (m) => m.model === model && m.provider === provider,
  );
  if (existing) return existing;

  const entry: SavedModel = {
    id: randomUUID(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    createdAt: Date.now(),
  };
  models.push(entry);
  writeModels(models);
  return entry;
}

export function removeModel(id: string): boolean {
  const models = readModels();
  const filtered = models.filter((m) => m.id !== id);
  if (filtered.length === models.length) return false;
  writeModels(filtered);
  return true;
}

export function updateModel(
  id: string,
  fields: Partial<Pick<SavedModel, "name" | "provider" | "model" | "baseUrl">>,
): boolean {
  const models = readModels();
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  models[idx] = { ...models[idx], ...fields };
  writeModels(models);
  return true;
}
