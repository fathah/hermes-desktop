import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { HERMES_HOME } from "./installer";
import { safeWriteFile, profilePaths } from "./utils";
import { hostDerivedEnvKeyForUrl } from "./host-derived-env";
import DEFAULT_MODELS from "./default-models";

const MODELS_FILE = join(HERMES_HOME, "models.json");

export interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiMode?: string | null;
  /** Optional manual context-window override (tokens). When set, it's mirrored
   *  into config.yaml's `model.context_length` on activation — fixing the
   *  context gauge for providers that don't advertise `context_length` over
   *  /models, and driving the agent's auto-compaction threshold. */
  contextLength?: number;
  createdAt: number;
}

/** Coerce an arbitrary value to a positive integer token count, or undefined. */
function normalizeContextLength(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseInt(value.trim(), 10)
        : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
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
      if (cp.apiKey && cp.apiKey !== "no-key-required") {
        try {
          let envContent = existsSync(envFile)
            ? readFileSync(envFile, "utf-8")
            : "";
          // Names to persist for this custom-provider key:
          //   1. CUSTOM_PROVIDER_<NAME>_KEY — the historical desktop
          //      contract; the runtime spawn in `hermes.ts` reads it
          //      via the models.json baseUrl match.
          //   2. <VENDOR>_API_KEY when the URL matches a known vendor
          //      host (e.g. api.deepseek.com → DEEPSEEK_API_KEY) —
          //      required for dual-engine compat: upstream-main's
          //      `_host_derived_api_key()` won't accept the custom-
          //      prefix form. Old engine (≤ v2026.5.16) doesn't have
          //      the host-derive resolver and ignores this extra var,
          //      so writing both is additive and safe.
          // The gateway path in `hermes.ts:startGateway` ingests ALL
          // profile env vars at spawn, so the host-derived form has
          // to live in .env (not just be set at chat-time) for the
          // long-running gateway flow to work on the new engine.
          const customPrefixKey =
            "CUSTOM_PROVIDER_" +
            cp.name.replace(/[^A-Za-z0-9]/g, "_").toUpperCase() +
            "_KEY";
          const namesToWrite: string[] = [customPrefixKey];
          const hostKey = hostDerivedEnvKeyForUrl(cp.baseUrl);
          // Don't shadow real OPENAI / ANTHROPIC keys via this path —
          // those belong to a separately-configured provider, not a
          // custom-provider key. The persistence guard mirrors the
          // runtime guard in `hermes.ts`.
          if (
            hostKey &&
            hostKey !== "OPENAI_API_KEY" &&
            hostKey !== "ANTHROPIC_API_KEY" &&
            hostKey !== customPrefixKey
          ) {
            namesToWrite.push(hostKey);
          }
          let modified = false;
          for (const envKey of namesToWrite) {
            const keyRegex = new RegExp(
              "^" + envKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=.*$",
              "m",
            );
            if (!keyRegex.test(envContent)) {
              envContent =
                envContent.trimEnd() + "\n" + envKey + "=" + cp.apiKey + "\n";
              modified = true;
            }
          }
          if (modified) {
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
  contextLength?: number,
): SavedModel {
  const models = readModels();

  // Dedup: if same model ID + provider exists, return existing
  const existing = models.find(
    (m) => m.model === model && m.provider === provider,
  );
  if (existing) return existing;

  const ctx = normalizeContextLength(contextLength);
  const entry: SavedModel = {
    id: randomUUID(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    ...(ctx !== undefined ? { contextLength: ctx } : {}),
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
  fields: Partial<
    Pick<SavedModel, "name" | "provider" | "model" | "baseUrl">
  > & { contextLength?: number | null },
): boolean {
  const models = readModels();
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;

  // `contextLength` is handled out-of-band: a positive value sets the
  // override, anything else (null / 0 / undefined-but-present) clears it.
  const { contextLength, ...rest } = fields;
  const next: SavedModel = { ...models[idx], ...rest };
  if (contextLength !== undefined) {
    const ctx = normalizeContextLength(contextLength);
    if (ctx !== undefined) next.contextLength = ctx;
    else delete next.contextLength;
  }
  models[idx] = next;
  writeModels(models);
  return true;
}
