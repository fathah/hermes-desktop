import type { SavedModel } from "./models";
import { remoteRequestJson, type RemoteSessionConfig } from "./remote-sessions";

type RemoteRecord = Record<string, unknown>;
const REMOTE_MODEL_OPTIONS_TIMEOUT_MS = 60_000;
const REMOTE_MODEL_LIBRARY_TIMEOUT_MS = 20_000;

function asRecord(value: unknown): RemoteRecord {
  return value && typeof value === "object" ? (value as RemoteRecord) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function shortModelLabel(model: string): string {
  return model.split("/").pop() || model;
}

function savedModelFromRemoteOption(
  provider: string,
  providerName: string,
  model: string,
  index: number,
  baseUrl = "",
): SavedModel {
  return {
    id: `remote:${provider}:${index}:${model}`,
    name: shortModelLabel(model) || providerName || model,
    provider,
    model,
    baseUrl,
    createdAt: 0,
  };
}

function normalizeRemoteSavedModel(
  raw: unknown,
  index: number,
): SavedModel | null {
  const row = asRecord(raw);
  const provider = asString(row.provider).trim();
  const model = asString(row.model).trim();
  if (!provider || !model) return null;
  const baseUrl = asString(row.baseUrl, asString(row.base_url)).trim();
  return {
    id:
      asString(row.id).trim() || `remote:library:${provider}:${index}:${model}`,
    name: asString(row.name).trim() || shortModelLabel(model) || provider,
    provider,
    model,
    baseUrl,
    createdAt:
      typeof row.createdAt === "number" && Number.isFinite(row.createdAt)
        ? row.createdAt
        : 0,
  };
}

function dedupeModels(models: SavedModel[]): SavedModel[] {
  const seen = new Set<string>();
  const result: SavedModel[] = [];
  for (const model of models) {
    const key = [
      model.provider.trim().toLowerCase(),
      model.model.trim().toLowerCase(),
      (model.baseUrl || "").trim().replace(/\/+$/, "").toLowerCase(),
    ].join("\n");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }
  return result;
}

async function remoteModelLibraryRows(
  config: RemoteSessionConfig,
): Promise<SavedModel[] | null> {
  try {
    const response = await remoteRequestJson(config, "/api/model/library", {
      timeoutMs: REMOTE_MODEL_LIBRARY_TIMEOUT_MS,
    });
    const rows = asRecord(response).models;
    if (!Array.isArray(rows)) return [];
    return dedupeModels(
      rows
        .map((row, index) => normalizeRemoteSavedModel(row, index))
        .filter((row): row is SavedModel => row !== null),
    );
  } catch {
    return null;
  }
}

function shouldIncludeRemoteOptionProvider(row: RemoteRecord): boolean {
  const source = asString(row.source).trim();
  return (
    row.is_current === true ||
    row.is_user_defined === true ||
    source === "user-config" ||
    source === "custom"
  );
}

function modelsFromRemoteOptions(response: unknown): SavedModel[] {
  const record = asRecord(response);
  const providers = Array.isArray(record.providers)
    ? (record.providers as unknown[])
    : [];

  const models: SavedModel[] = [];
  const currentProvider = asString(record.provider).trim();
  const currentModel = asString(record.model).trim();
  if (currentProvider && currentModel) {
    const current = currentProviderRow(response);
    models.push(
      savedModelFromRemoteOption(
        current.provider || currentProvider,
        current.provider || currentProvider,
        currentModel,
        -1,
        current.baseUrl,
      ),
    );
  }

  for (const rawProvider of providers) {
    const row = asRecord(rawProvider);
    if (!shouldIncludeRemoteOptionProvider(row)) continue;
    const provider = asString(row.slug, asString(row.provider)).trim();
    if (!provider) continue;
    const providerName = asString(row.name, provider);
    const baseUrl = asString(
      row.api_url,
      asString(row.base_url, asString(row.baseUrl)),
    ).trim();
    const modelIds = asStringArray(row.models);
    modelIds.forEach((model, index) => {
      if (model.trim()) {
        models.push(
          savedModelFromRemoteOption(
            provider,
            providerName,
            model,
            index,
            baseUrl,
          ),
        );
      }
    });
  }

  return dedupeModels(models);
}

function currentProviderRow(response: unknown): {
  baseUrl: string;
  provider: string;
} {
  const record = asRecord(response);
  const currentProvider = asString(record.provider).trim();
  const providers = Array.isArray(record.providers)
    ? (record.providers as unknown[])
    : [];
  for (const rawProvider of providers) {
    const row = asRecord(rawProvider);
    const slug = asString(row.slug, asString(row.provider)).trim();
    if (!slug || slug !== currentProvider) continue;
    return {
      provider: slug,
      baseUrl: asString(
        row.api_url,
        asString(row.base_url, asString(row.baseUrl)),
      ),
    };
  }
  return { provider: currentProvider, baseUrl: "" };
}

export async function remoteListModels(
  config: RemoteSessionConfig,
): Promise<SavedModel[]> {
  const libraryRows = await remoteModelLibraryRows(config);
  if (libraryRows) return libraryRows;

  // Older Hermes Agent dashboards do not expose the configured model
  // library yet. Fall back to a narrow picker-derived view instead of
  // flattening the whole authenticated provider catalog.
  const response = await remoteRequestJson(config, "/api/model/options", {
    timeoutMs: REMOTE_MODEL_OPTIONS_TIMEOUT_MS,
  });
  return modelsFromRemoteOptions(response);
}

export async function remoteGetModelConfig(
  config: RemoteSessionConfig,
): Promise<{ provider: string; model: string; baseUrl: string }> {
  const libraryRows = await remoteModelLibraryRows(config);
  const active = libraryRows?.find((row) =>
    row.id.startsWith("remote:active:"),
  );
  if (active) {
    return {
      provider: active.provider,
      model: active.model,
      baseUrl: active.baseUrl || "",
    };
  }

  const response = await remoteRequestJson(config, "/api/model/options", {
    timeoutMs: REMOTE_MODEL_OPTIONS_TIMEOUT_MS,
  });
  const record = asRecord(response);
  const current = currentProviderRow(response);
  return {
    provider: current.provider || "auto",
    model: asString(record.model),
    baseUrl: current.baseUrl,
  };
}

export async function remoteSetModelConfig(
  config: RemoteSessionConfig,
  provider: string,
  model: string,
  baseUrl = "",
): Promise<boolean> {
  await remoteRequestJson(config, "/api/model/set", {
    method: "POST",
    body: {
      scope: "main",
      provider,
      model,
      base_url: provider === "custom" ? baseUrl : "",
    },
    timeoutMs: 15_000,
  });
  const deadline = Date.now() + 5000;
  let last: { provider: string; model: string; baseUrl: string } | null = null;
  while (Date.now() <= deadline) {
    last = await remoteGetModelConfig(config);
    if (
      last.provider === provider &&
      last.model === model &&
      (provider !== "custom" ||
        (last.baseUrl || "").replace(/\/+$/, "") ===
          (baseUrl || "").replace(/\/+$/, ""))
    ) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Remote Hermes dashboard did not switch to ${provider}/${model}; active model is ${last?.provider || "unknown"}/${last?.model || "unknown"}`,
  );
}

export async function remoteAddModel(
  config: RemoteSessionConfig,
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
): Promise<SavedModel> {
  const response = await remoteRequestJson(config, "/api/model/library", {
    method: "POST",
    body: { name, provider, model, baseUrl },
    timeoutMs: REMOTE_MODEL_LIBRARY_TIMEOUT_MS,
  });
  const saved = normalizeRemoteSavedModel(response, 0);
  if (!saved) throw new Error("Remote Hermes returned an invalid model row.");
  return saved;
}

export async function remoteRemoveModel(
  config: RemoteSessionConfig,
  id: string,
): Promise<boolean> {
  const response = await remoteRequestJson(
    config,
    `/api/model/library/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      timeoutMs: REMOTE_MODEL_LIBRARY_TIMEOUT_MS,
    },
  );
  return asRecord(response).ok === true;
}

export async function remoteUpdateModel(
  config: RemoteSessionConfig,
  id: string,
  fields: Partial<Pick<SavedModel, "name" | "provider" | "model" | "baseUrl">>,
): Promise<boolean> {
  const response = await remoteRequestJson(
    config,
    `/api/model/library/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: fields,
      timeoutMs: REMOTE_MODEL_LIBRARY_TIMEOUT_MS,
    },
  );
  return asRecord(response).ok === true;
}
