import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { HERMES_HOME } from "./installer";
import { safeWriteFile, profilePaths } from "./utils";
import { hostDerivedEnvKeyForUrl } from "./host-derived-env";
import { customProviderEnvKey } from "../shared/url-key-map";
import DEFAULT_MODELS from "./default-models";

const MODELS_FILE = join(HERMES_HOME, "models.json");
const MODEL_DEFS_FILE = join(HERMES_HOME, "model-definitions.json");

/**
 * A persisted `models.json` row — a pure *attachment* of a model id to a
 * provider/endpoint. Shared metadata (display name default, context window,
 * capabilities) lives once in a {@link ModelDefinition} keyed by `model` id, so
 * the same model id attached to two providers shares one definition instead of
 * re-storing it per row. `name` is kept on the row because the runtime derives
 * a custom-provider env key from `providerLabel || name` ([[src/main/hermes.ts]]),
 * so it must remain resolvable from the raw store.
 */
export interface SavedModelRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiMode?: string | null;
  /** Display name of the custom provider this model belongs to (only set for
   *  user-added named custom providers). Groups a provider's models together in
   *  the UI and, crucially, keys its API key: the runtime resolves
   *  `customProviderEnvKey(providerLabel)` so every model under one provider
   *  shares that provider's key rather than the shared `CUSTOM_API_KEY`. */
  providerLabel?: string;
  createdAt: number;
}

/**
 * The public, read-time model shape: a {@link SavedModelRow} with its matching
 * {@link ModelDefinition} merged on. Every consumer (`resolveLibraryModelEntry`,
 * the chat/Providers pickers, the runtime spawn) sees this flat superset, so the
 * definitions layer is transparent to them.
 */
export interface SavedModel extends SavedModelRow {
  /** Optional manual context-window override (tokens), sourced from the shared
   *  {@link ModelDefinition}. When set, it's mirrored into config.yaml's
   *  `model.context_length` on activation — fixing the context gauge for
   *  providers that don't advertise `context_length` over /models, and driving
   *  the agent's auto-compaction threshold. */
  contextLength?: number;
  /** Model capabilities (e.g. "vision", "tools"), from the shared definition. */
  capabilities?: string[];
  /** Input/output modalities, from the shared definition. */
  modalities?: { input?: string[]; output?: string[] };
}

/**
 * Shared, per-model-id metadata. Defined once and merged onto every attachment
 * of that model id, so context window / display name / capabilities are entered
 * a single time and reused across providers. Stored in `model-definitions.json`;
 * local-only (like the per-row context override it replaces — the remote/SSH
 * library paths never carried it).
 */
export interface ModelDefinition {
  /** Canonical model id — the key. */
  model: string;
  /** Preferred display name (used when an attachment row has none). */
  name?: string;
  /** Manual context-window override (tokens). */
  contextLength?: number;
  capabilities?: string[];
  modalities?: { input?: string[]; output?: string[] };
  createdAt: number;
  updatedAt: number;
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

/**
 * Raw persisted attachment rows — a plain JSON read with no definition merge.
 * Writers (`addModel`/`updateModel`/`removeModel`/`seedDefaults`/migration) use
 * this so merged-only fields (`contextLength`, `capabilities`, …) are never
 * written back onto a row. Legacy rows may still carry `contextLength`; it's
 * hoisted out by {@link ensureModelDefinitionsMigrated} and otherwise ignored.
 */
export function readModelsRaw(): SavedModelRow[] {
  try {
    if (!existsSync(MODELS_FILE)) return [];
    return JSON.parse(readFileSync(MODELS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Public read: raw rows with their matching {@link ModelDefinition} merged on.
 * `contextLength` comes from the definition (source of truth); a row's own
 * `name` is never overwritten (`row.name ?? def.name ?? id`) so the runtime's
 * env-key derivation from `name` stays stable. Read-only — no writes here, so it
 * is safe on the per-spawn runtime hot path ([[src/main/hermes.ts]] uses the raw
 * store directly and doesn't need the merge, but callers via IPC do).
 */
export function readModels(): SavedModel[] {
  const rows = readModelsRaw();
  const defs = readModelDefinitions();
  return rows.map((row) => {
    const def = defs[row.model];
    const merged: SavedModel = {
      ...row,
      name: row.name || def?.name || row.model,
    };
    if (def?.contextLength !== undefined)
      merged.contextLength = def.contextLength;
    if (def?.capabilities) merged.capabilities = def.capabilities;
    if (def?.modalities) merged.modalities = def.modalities;
    return merged;
  });
}

function writeModels(models: SavedModelRow[]): void {
  safeWriteFile(MODELS_FILE, JSON.stringify(models, null, 2));
}

/** Read the definitions map (`{ [modelId]: ModelDefinition }`), tolerant of a
 *  missing/corrupt file. */
export function readModelDefinitions(): Record<string, ModelDefinition> {
  try {
    if (!existsSync(MODEL_DEFS_FILE)) return {};
    const parsed = JSON.parse(readFileSync(MODEL_DEFS_FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeModelDefinitions(defs: Record<string, ModelDefinition>): void {
  safeWriteFile(MODEL_DEFS_FILE, JSON.stringify(defs, null, 2));
}

export function listModelDefinitions(): ModelDefinition[] {
  return Object.values(readModelDefinitions());
}

export function getModelDefinition(model: string): ModelDefinition | null {
  return readModelDefinitions()[model] ?? null;
}

/**
 * Upsert a model definition (keyed by model id). A `contextLength` of `null`/`0`
 * clears the override; other patch fields set when provided. Bumps `updatedAt`.
 * Returns the resulting definition.
 */
export function setModelDefinition(
  model: string,
  patch: {
    name?: string;
    contextLength?: number | null;
    capabilities?: string[];
    modalities?: { input?: string[]; output?: string[] };
  },
): ModelDefinition {
  const defs = readModelDefinitions();
  const now = Date.now();
  const prev = defs[model];
  const next: ModelDefinition = prev
    ? { ...prev, updatedAt: now }
    : { model, createdAt: now, updatedAt: now };
  if (patch.name !== undefined) next.name = patch.name.trim() || undefined;
  if (patch.contextLength !== undefined) {
    const ctx = normalizeContextLength(patch.contextLength);
    if (ctx !== undefined) next.contextLength = ctx;
    else delete next.contextLength;
  }
  if (patch.capabilities !== undefined)
    next.capabilities = patch.capabilities.length
      ? patch.capabilities
      : undefined;
  if (patch.modalities !== undefined) next.modalities = patch.modalities;
  defs[model] = next;
  writeModelDefinitions(defs);
  return next;
}

export function removeModelDefinition(model: string): boolean {
  const defs = readModelDefinitions();
  if (!(model in defs)) return false;
  delete defs[model];
  writeModelDefinitions(defs);
  return true;
}

/**
 * One-time hoist of legacy per-row `contextLength` (and `name`) into shared
 * definitions. For each raw row carrying a positive `contextLength`, upsert
 * `defs[row.model]` keeping the larger context window (safer gauge/compaction
 * value) and a first-wins name, then strip `contextLength` off the row. Merges
 * into any existing definitions file and is idempotent — after it runs no row
 * has `contextLength`, so a re-run hoists nothing.
 */
export function ensureModelDefinitionsMigrated(): void {
  const rawRows = readModelsRaw() as Array<
    SavedModelRow & { contextLength?: number }
  >;
  const legacy = rawRows.filter(
    (r) => normalizeContextLength(r.contextLength) !== undefined,
  );
  if (legacy.length === 0) return;

  const defs = readModelDefinitions();
  const now = Date.now();
  for (const row of legacy) {
    const ctx = normalizeContextLength(row.contextLength)!;
    const prev = defs[row.model];
    defs[row.model] = {
      model: row.model,
      name:
        prev?.name ??
        (row.name && row.name !== row.model ? row.name : undefined),
      contextLength: Math.max(prev?.contextLength ?? 0, ctx),
      capabilities: prev?.capabilities,
      modalities: prev?.modalities,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
  }
  writeModelDefinitions(defs);

  // Strip the now-redundant field from every row.
  const stripped = rawRows.map((r) => {
    const { contextLength: _drop, ...rest } = r;
    void _drop;
    return rest as SavedModelRow;
  });
  writeModels(stripped);
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

function seedDefaults(profile?: string): SavedModelRow[] {
  const models: SavedModelRow[] = DEFAULT_MODELS.map((m) => ({
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
          const customPrefixKey = customProviderEnvKey(cp.name);
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
    seedDefaults();
  }
  // Hoist any legacy per-row context overrides into shared definitions before
  // the merged read. This is the renderer-facing entry point (Providers screen),
  // which already performs writes via seedDefaults; the runtime path uses
  // readModels() directly and never triggers this migration write.
  ensureModelDefinitionsMigrated();
  return readModels();
}

export function addModel(
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
  contextLength?: number,
  providerLabel?: string,
): SavedModel {
  const models = readModelsRaw();

  // A context-window override is shared metadata keyed by model id — persist it
  // to the definition, not onto this attachment row, so every provider serving
  // this model id reuses it.
  const ctx = normalizeContextLength(contextLength);
  if (ctx !== undefined) setModelDefinition(model, { contextLength: ctx });

  // Dedup: same model ID + provider + base URL. Base URL is part of the key so
  // the same model id can live under two different custom endpoints.
  const norm = (u: string): string =>
    (u || "").trim().replace(/\/+$/, "").toLowerCase();
  const existing = models.find(
    (m) =>
      m.model === model &&
      m.provider === provider &&
      norm(m.baseUrl) === norm(baseUrl),
  );
  if (existing)
    return {
      ...existing,
      ...(ctx !== undefined ? { contextLength: ctx } : {}),
    };

  const entry: SavedModelRow = {
    id: randomUUID(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    ...(providerLabel ? { providerLabel } : {}),
    createdAt: Date.now(),
  };
  models.push(entry);
  writeModels(models);
  return { ...entry, ...(ctx !== undefined ? { contextLength: ctx } : {}) };
}

export function removeModel(id: string): boolean {
  const models = readModelsRaw();
  const filtered = models.filter((m) => m.id !== id);
  if (filtered.length === models.length) return false;
  writeModels(filtered);
  return true;
}

export function updateModel(
  id: string,
  fields: Partial<
    Pick<SavedModelRow, "name" | "provider" | "model" | "baseUrl">
  > & { contextLength?: number | null },
): boolean {
  const models = readModelsRaw();
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;

  const { contextLength, ...rest } = fields;
  const next: SavedModelRow = { ...models[idx], ...rest };
  models[idx] = next;
  writeModels(models);

  // `contextLength` is shared metadata: route it to the definition keyed by the
  // (possibly updated) model id, not onto the row. A positive value sets the
  // override; anything else clears it.
  if (contextLength !== undefined) {
    setModelDefinition(next.model, { contextLength });
  }
  return true;
}
