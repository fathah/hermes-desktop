import type { SavedModel } from "../models";
import type { SshConfig } from "../ssh-tunnel";
import { sshReadFile, sshWriteFile } from "./core";

// ── Models library ─────────────────────────────────────────────────────────────

export async function sshListModels(config: SshConfig): Promise<SavedModel[]> {
  try {
    const raw = await sshReadFile(config, "$HOME/.hermes/models.json");
    if (raw.trim()) return JSON.parse(raw);
  } catch {
    // no models.json on remote yet
  }
  return [];
}

export async function sshSaveModels(
  config: SshConfig,
  models: SavedModel[],
): Promise<void> {
  await sshWriteFile(
    config,
    "$HOME/.hermes/models.json",
    JSON.stringify(models, null, 2),
  );
}

// Mirror the local CRUD helpers in models.ts against the remote
// ~/.hermes/models.json. Each operation does a full read/mutate/write so the
// SSH cost is the same as a manual edit — there is no remote API to call
// instead, and the file is small (a few KB at most).

function randomId(): string {
  // RFC4122-ish v4 UUID without pulling in crypto.randomUUID, which is fine
  // here because IDs only need to be unique within models.json.
  const hex = (n: number): string =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

export async function sshAddModel(
  config: SshConfig,
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
): Promise<SavedModel> {
  const models = await sshListModels(config);
  const existing = models.find(
    (m) => m.model === model && m.provider === provider,
  );
  if (existing) return existing;
  const entry: SavedModel = {
    id: randomId(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    createdAt: Date.now(),
  };
  await sshSaveModels(config, [...models, entry]);
  return entry;
}

export async function sshRemoveModel(
  config: SshConfig,
  id: string,
): Promise<boolean> {
  const models = await sshListModels(config);
  const filtered = models.filter((m) => m.id !== id);
  if (filtered.length === models.length) return false;
  await sshSaveModels(config, filtered);
  return true;
}

export async function sshUpdateModel(
  config: SshConfig,
  id: string,
  fields: Partial<Pick<SavedModel, "name" | "provider" | "model" | "baseUrl">>,
): Promise<boolean> {
  const models = await sshListModels(config);
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  models[idx] = { ...models[idx], ...fields };
  await sshSaveModels(config, models);
  return true;
}
