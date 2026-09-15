// @lat: [[agent-sync#Sync engine]]
import { createHash } from "crypto";
import { readFileSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import {
  findAccountProfile,
  getAccount,
  getAccessToken,
} from "./account-store";
import { apiHeaders } from "./hermes-account";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  type ProfileInfo,
} from "./profiles";
import {
  setProfileColor,
  readProfileMeta,
  defaultColorForName,
} from "./profile-meta";
import { readSoul, writeSoul } from "./soul";
import { readMemoryRaw, writeMemoryRaw } from "./memory";
import { getModelConfig, setModelConfig } from "./config";
import { isValidNamedProfileName, profileHome, safeWriteFile } from "./utils";
import { normalizeApiUrl } from "./api-url";
import type {
  AgentSyncOutcome,
  AgentSyncResult,
  AgentSyncStatus,
} from "../shared/agent-sync";

// Syncs desktop profiles (the app's "agents") with the signed-in Hermes One
// account's cloud agents (backend /api/agents CRUD, bearer-authenticated with
// the device-login token). Phase 1 scope — the free parts from the backend's
// docs/agent-sync.md: color, persona (SOUL.md ↔ systemPrompt), memory
// (memories/MEMORY.md ↔ memory), and config basics (model/provider). Names are
// used to link and create, never to rename. Deletions never propagate: a cloud
// agent deleted in the console just unlinks the local profile.
//
// Per part we keep the content hash from the last sync ("base") in the
// profile's cloud-sync.json. base vs local vs remote decides push / pull /
// no-op; when both sides changed, last-writer-wins by timestamp.

// Backend field limits (parseAgentInput in hermes-one-backend). Oversize parts
// are skipped with a warning rather than truncated — truncating and later
// pulling back would destroy local content.
const MAX_SOUL_CHARS = 20000;
const MAX_MEMORY_CHARS = 40000;
const MAX_NAME_CHARS = 80;

export type SyncPart = "color" | "soul" | "memory" | "config";
const PARTS: SyncPart[] = ["color", "soul", "memory", "config"];

const STATE_FILE = "cloud-sync.json";

interface SyncState {
  version: 1;
  agentId: string;
  /**
   * Backend user id the link belongs to. A device can see several accounts
   * over time (sign out, sign in as someone else); sync must never push one
   * account's agents to another, so every pass records the owner and skips
   * links owned by a different account. Absent in legacy state files written
   * before account switching was handled.
   */
  accountId?: string;
  /** Backend that owns the link; absent in older state files. */
  apiUrl?: string;
  /** Cloud-side name at last sync — display/diagnostics only; linkage is by id. */
  remoteName: string;
  /** Content hash per part at the last successful sync (the common base). */
  base: Partial<Record<SyncPart, string>>;
}

/** Cloud agent as serialized by the backend (serializeAgent). */
interface RemoteAgent {
  id: string;
  name: string;
  color: string;
  systemPrompt: string | null;
  memory: string | null;
  model: string;
  provider: string;
  updatedAt: string;
}

function isRemoteAgent(value: unknown): value is RemoteAgent {
  if (!value || typeof value !== "object") return false;
  const agent = value as Partial<RemoteAgent>;
  return (
    typeof agent.id === "string" &&
    agent.id.length > 0 &&
    typeof agent.name === "string" &&
    agent.name.trim().length > 0 &&
    typeof agent.color === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(agent.color) &&
    (agent.systemPrompt === null || typeof agent.systemPrompt === "string") &&
    (agent.memory === null || typeof agent.memory === "string") &&
    typeof agent.model === "string" &&
    typeof agent.provider === "string" &&
    typeof agent.updatedAt === "string" &&
    Number.isFinite(Date.parse(agent.updatedAt))
  );
}

interface PartValues {
  color: string;
  soul: string;
  memory: string;
  config: { model: string; provider: string };
}

// ── Pure core (unit-tested without fs/network) ─────────────────────────────

/** Stable content hash for a part value. */
export function hashPart(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type PartAction = "none" | "push" | "pull";

/**
 * Decide what to do with one part given the last-sync base hash and both
 * sides' current hashes. When only one side moved off the base, that side
 * wins; when both moved (or there is no base yet), last-writer-wins by
 * timestamp. Equal content is always a no-op.
 */
export function decidePartAction(
  base: string | undefined,
  local: string,
  remote: string,
  localMtimeMs: number,
  remoteUpdatedAtMs: number,
): PartAction {
  if (local === remote) return "none";
  if (base !== undefined) {
    if (local === base) return "pull";
    if (remote === base) return "push";
  }
  return localMtimeMs > remoteUpdatedAtMs ? "push" : "pull";
}

/**
 * Build the JSON body for a create/patch from the parts being pushed.
 * Enforces backend limits by omitting oversize parts (returned in `skipped`)
 * and never includes anything beyond the four synced parts — in particular no
 * config.yaml content other than the model/provider strings.
 */
export function buildPushBody(
  parts: SyncPart[],
  values: PartValues,
): { body: Record<string, unknown>; skipped: string[] } {
  const body: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const part of parts) {
    switch (part) {
      case "color":
        body.color = values.color;
        break;
      case "soul":
        if (values.soul.length > MAX_SOUL_CHARS) {
          skipped.push(
            `persona (SOUL.md) is ${values.soul.length} chars — over the ${MAX_SOUL_CHARS} cloud limit, not pushed`,
          );
        } else {
          body.systemPrompt = values.soul || null;
        }
        break;
      case "memory":
        if (values.memory.length > MAX_MEMORY_CHARS) {
          skipped.push(
            `memory (MEMORY.md) is ${values.memory.length} chars — over the ${MAX_MEMORY_CHARS} cloud limit, not pushed`,
          );
        } else {
          body.memory = values.memory || null;
        }
        break;
      case "config":
        // An unset local model would clobber the cloud value with "" on PATCH.
        if (values.config.model) {
          body.model = values.config.model;
          body.provider = values.config.provider || "auto";
        } else {
          skipped.push("model is not configured locally — config not pushed");
        }
        break;
    }
  }
  return { body, skipped };
}

// ── Local profile snapshot ──────────────────────────────────────────────────

function statePath(profile: string): string {
  return join(profileHome(profile), STATE_FILE);
}

function readSyncState(profile: string, strict = false): SyncState | null {
  const file = statePath(profile);
  try {
    const parsed = JSON.parse(
      readFileSync(file, "utf-8"),
    ) as Partial<SyncState>;
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.agentId === "string" &&
      parsed.agentId.length > 0 &&
      parsed.base &&
      typeof parsed.base === "object" &&
      !Array.isArray(parsed.base) &&
      (parsed.accountId === undefined ||
        (typeof parsed.accountId === "string" &&
          parsed.accountId.length > 0)) &&
      (parsed.apiUrl === undefined ||
        (typeof parsed.apiUrl === "string" && parsed.apiUrl.length > 0))
    ) {
      return {
        version: 1,
        agentId: parsed.agentId,
        accountId:
          typeof parsed.accountId === "string" ? parsed.accountId : undefined,
        apiUrl:
          typeof parsed.apiUrl === "string"
            ? normalizeApiUrl(parsed.apiUrl)
            : undefined,
        remoteName:
          typeof parsed.remoteName === "string" ? parsed.remoteName : "",
        base: parsed.base,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (strict)
      throw new Error(
        "Could not read this profile's cloud link; profile was not deleted.",
      );
    // Normal sync retains its legacy recovery by name.
  }
  if (strict) throw new Error("Invalid cloud link; profile was not deleted.");
  return null;
}

function writeSyncState(profile: string, state: SyncState): void {
  safeWriteFile(statePath(profile), JSON.stringify(state, null, 2));
}

/**
 * The cloud agent id a profile is linked to (from its cloud-sync.json), or null
 * if it has never synced. Used by wallet sync to fetch the agent's wallets.
 */
export function getLinkedAgentId(profile: string): string | null {
  return readSyncState(profile)?.agentId ?? null;
}

/**
 * The backend user id that owns a profile's cloud link, or null when the
 * profile has never synced or its state predates account tagging. Wallet
 * flows use it to refuse acting on an agent linked to a different account
 * than the one currently signed in.
 */
export function getLinkedAgentAccountId(profile: string): string | null {
  return readSyncState(profile)?.accountId ?? null;
}

/** Backend ownership used by wallet reads and mutations as well as sync. */
export function getLinkedAgentApiUrl(profile: string): string | null {
  return readSyncState(profile)?.apiUrl ?? null;
}

function clearSyncState(profile: string): void {
  try {
    unlinkSync(statePath(profile));
  } catch {
    // Already gone.
  }
}

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function localPartValues(
  profile: Pick<ProfileInfo, "id" | "color">,
): PartValues {
  // On-disk lookups key off the stable id (the directory slug), not the
  // editable display name — a renamed profile keeps the same id/directory.
  const cfg = getModelConfig(profile.id);
  return {
    color: profile.color,
    soul: readSoul(profile.id),
    memory: readMemoryRaw(profile.id),
    config: { model: cfg.model, provider: cfg.provider || "auto" },
  };
}

function localPartMtimes(profile: ProfileInfo): Record<SyncPart, number> {
  const home = profile.path;
  return {
    color: mtimeMs(join(home, "profile-meta.json")),
    soul: mtimeMs(join(home, "SOUL.md")),
    memory: mtimeMs(join(home, "memories", "MEMORY.md")),
    config: mtimeMs(join(home, "config.yaml")),
  };
}

function remotePartValues(agent: RemoteAgent): PartValues {
  return {
    color: agent.color,
    soul: agent.systemPrompt ?? "",
    memory: agent.memory ?? "",
    config: { model: agent.model, provider: agent.provider || "auto" },
  };
}

function partHashes(values: PartValues): Record<SyncPart, string> {
  return {
    color: hashPart(values.color),
    soul: hashPart(values.soul),
    memory: hashPart(values.memory),
    config: hashPart(values.config),
  };
}

// ── Backend client ──────────────────────────────────────────────────────────

async function api(
  apiUrl: string,
  token: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...apiHeaders(body !== undefined),
      authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch((error) => {
    if (res.ok) throw error;
    return {};
  })) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

// @lat: [[agent-sync#Local deletion exclusions]]
type DeletedLink = Pick<SyncState, "agentId" | "accountId" | "apiUrl">;

function deletedLinksPath(): string {
  // Must outlive any named profile, including the profile holding the login.
  return join(profileHome("default"), "cloud-sync-deleted.json");
}

function readDeletedLinks(): DeletedLink[] {
  try {
    const data = JSON.parse(readFileSync(deletedLinksPath(), "utf-8"));
    if (
      data?.version !== 1 ||
      !Array.isArray(data.links) ||
      !data.links.every(
        (link: DeletedLink) =>
          link &&
          typeof link.agentId === "string" &&
          link.agentId.length > 0 &&
          (link.accountId === undefined ||
            (typeof link.accountId === "string" &&
              link.accountId.length > 0)) &&
          (link.apiUrl === undefined ||
            (typeof link.apiUrl === "string" && link.apiUrl.length > 0)),
      )
    ) {
      throw new Error("Invalid deletion history");
    }
    return data.links;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      "Could not read cloud sync deletion history. Repair cloud-sync-deleted.json before syncing or deleting profiles.",
    );
  }
}

function excludesAgent(
  links: DeletedLink[],
  agentId: string,
  accountId: string,
  apiUrl: string,
): boolean {
  return links.some(
    (link) =>
      link.agentId === agentId &&
      (!link.accountId || link.accountId === accountId) &&
      (!link.apiUrl ||
        normalizeApiUrl(link.apiUrl) === normalizeApiUrl(apiUrl)),
  );
}

// All local sync writes and deletion run in order. In particular a PATCH or
// async metadata pull must finish before the CLI removes its profile directory.
let profileOperations: Promise<unknown> = Promise.resolve();
function withProfileOperation<T>(operation: () => T | Promise<T>): Promise<T> {
  const result = profileOperations.then(operation);
  profileOperations = result.catch(() => undefined);
  return result;
}

export async function deleteProfileWithSync(
  name: string,
): Promise<{ success: boolean; error?: string }> {
  if (name === "default" || !isValidNamedProfileName(name)) {
    return {
      success: false,
      error: "Only a valid named profile can be deleted.",
    };
  }
  return withProfileOperation(() => {
    try {
      const state = readSyncState(name, true);
      if (state) {
        const links = readDeletedLinks();
        const link: DeletedLink = {
          agentId: state.agentId,
          accountId: state.accountId,
          apiUrl: state.apiUrl,
        };
        if (
          !links.some(
            (entry) =>
              entry.agentId === link.agentId &&
              entry.accountId === link.accountId &&
              entry.apiUrl === link.apiUrl,
          )
        ) {
          // Persist before invoking the CLI, so failure cannot lose the only
          // mapping. On a partial CLI failure keep the exclusion for retry.
          safeWriteFile(
            deletedLinksPath(),
            JSON.stringify({ version: 1, links: [...links, link] }, null, 2),
          );
        }
      }
      return deleteProfile(name);
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}

// ── Sync pass ───────────────────────────────────────────────────────────────

// Single-flight: overlapping runs (auto-on-mount + manual click) would race on
// the state files, so a second request just reports the pass already running.
let running = false;
let lastResult: AgentSyncResult | null = null;

export function getAgentSyncStatus(): AgentSyncStatus {
  const accountProfile = findAccountProfile();
  const account = accountProfile ? getAccount(accountProfile) : null;
  return {
    signedIn: account !== null,
    accountLabel: account
      ? (account.user.email ?? account.user.name ?? account.user.id)
      : null,
    running,
    lastResult,
  };
}

async function applyPull(
  profileName: string,
  part: SyncPart,
  remote: PartValues,
): Promise<void> {
  switch (part) {
    case "color": {
      const result = await setProfileColor(profileName, remote.color);
      if (!result.success)
        throw new Error(result.error || "Could not sync profile color.");
      break;
    }
    case "soul":
      if (!writeSoul(remote.soul, profileName))
        throw new Error("Could not sync profile persona.");
      break;
    case "memory": {
      const result = writeMemoryRaw(remote.memory, profileName);
      if (!result.success)
        throw new Error(result.error || "Could not sync profile memory.");
      break;
    }
    case "config": {
      if (!remote.config.model) break;
      // Only model/provider sync; keep whatever base URL is configured locally.
      const current = getModelConfig(profileName);
      setModelConfig(
        remote.config.provider || "auto",
        remote.config.model,
        current.baseUrl,
        profileName,
      );
      break;
    }
  }
}

/**
 * Run one full sync pass: link profiles to cloud agents (by stored id, then by
 * name), reconcile each part, create cloud agents for unlinked local profiles
 * and local profiles for cloud-only agents, and unlink mappings whose cloud
 * agent disappeared. Never deletes anything on either side.
 */
export async function syncAgents(): Promise<AgentSyncResult> {
  if (running) {
    return (
      lastResult ?? {
        status: "error",
        error: "A sync is already running.",
        outcomes: [],
        finishedAt: Date.now(),
      }
    );
  }
  running = true;
  try {
    const result = await withProfileOperation(runSyncPass);
    lastResult = result;
    return result;
  } finally {
    running = false;
  }
}

async function runSyncPass(): Promise<AgentSyncResult> {
  const finished = (
    r: Omit<AgentSyncResult, "finishedAt">,
  ): AgentSyncResult => ({
    ...r,
    finishedAt: Date.now(),
  });

  const accountProfile = findAccountProfile();
  const account = accountProfile ? getAccount(accountProfile) : null;
  const token = accountProfile ? getAccessToken(accountProfile) : null;
  if (!account || !token) {
    return finished({ status: "signed-out", outcomes: [] });
  }

  let deletedLinks: DeletedLink[];
  try {
    deletedLinks = readDeletedLinks();
  } catch (error) {
    return finished({
      status: "error",
      error: (error as Error).message,
      outcomes: [],
    });
  }
  let remotes: RemoteAgent[];
  try {
    const res = await api(account.apiUrl, token, "GET", "/api/agents");
    if (res.status === 401)
      return finished({ status: "unauthorized", outcomes: [] });
    if (!res.ok) {
      return finished({
        status: "error",
        error: `Cloud agents unavailable (HTTP ${res.status}).`,
        outcomes: [],
      });
    }
    if (
      !Array.isArray(res.data?.agents) ||
      !res.data.agents.every(isRemoteAgent)
    ) {
      return finished({
        status: "error",
        error:
          "Cloud agents returned an invalid list; profiles were left untouched.",
        outcomes: [],
      });
    }
    remotes = res.data.agents as RemoteAgent[];
  } catch (err) {
    return finished({
      status: "error",
      error: `Couldn't reach ${account.apiUrl}: ${(err as Error).message}`,
      outcomes: [],
    });
  }

  const profiles = await listProfiles();
  const remoteById = new Map(remotes.map((a) => [a.id, a]));
  const outcomes: AgentSyncOutcome[] = [];
  // Cloud agents already linked (or claimed during this pass) — the leftovers
  // at the end are cloud-only and get pull-created.
  const claimed = new Set<string>();

  type Linked = { profile: ProfileInfo; state: SyncState; agent: RemoteAgent };
  const linked: Linked[] = [];
  const unlinkedLocals: ProfileInfo[] = [];

  const userId = account.user.id;
  for (const profile of profiles) {
    const state = readSyncState(profile.id);
    if (state) {
      // Linked to a different account: leave it completely alone. Unlinking
      // here would make the profile look never-synced and push the other
      // account's persona/memory to this one on the next pass.
      if (
        (state.accountId && state.accountId !== userId) ||
        (state.apiUrl && state.apiUrl !== normalizeApiUrl(account.apiUrl))
      ) {
        outcomes.push({
          profile: profile.id,
          agentId: state.agentId,
          action: "skipped",
          warnings: [
            "Linked to a different Hermes account; left untouched. It resumes syncing when that account signs back in.",
          ],
        });
        continue;
      }
      const agent = remoteById.get(state.agentId);
      if (agent) {
        claimed.add(agent.id);
        linked.push({ profile, state, agent });
      } else if (state.accountId === userId) {
        // The link is provably this account's and the agent is gone:
        // deleted in the console. Unlink, keep the local profile untouched.
        clearSyncState(profile.id);
        outcomes.push({
          profile: profile.id,
          agentId: state.agentId,
          action: "unlinked",
          warnings: [
            "Cloud agent was deleted in the console; this profile is local-only again.",
          ],
        });
      } else {
        // Legacy state without an owner record, and the agent isn't in this
        // account's list — ambiguous between "deleted in the console" and
        // "belongs to the previously signed-in account". Skipping is the safe
        // read: a wrong unlink re-uploads someone else's agent here.
        outcomes.push({
          profile: profile.id,
          agentId: state.agentId,
          action: "skipped",
          warnings: [
            "Cloud agent not found for this account — the link may belong to a previously signed-in account. Left untouched.",
          ],
        });
      }
    } else {
      unlinkedLocals.push(profile);
    }
  }

  // Link never-synced locals to unclaimed cloud agents by exact name.
  for (const profile of unlinkedLocals.slice()) {
    const match = remotes.find(
      (a) =>
        !claimed.has(a.id) &&
        !excludesAgent(deletedLinks, a.id, userId, account.apiUrl) &&
        a.name === profile.name,
    );
    if (match) {
      claimed.add(match.id);
      linked.push({
        profile,
        state: {
          version: 1,
          agentId: match.id,
          accountId: userId,
          apiUrl: normalizeApiUrl(account.apiUrl),
          remoteName: match.name,
          base: {},
        },
        agent: match,
      });
      unlinkedLocals.splice(unlinkedLocals.indexOf(profile), 1);
    }
  }

  // Reconcile each linked pair part by part.
  for (const { profile, state, agent } of linked) {
    const warnings: string[] = [];
    try {
      const local = localPartValues(profile);
      const localHash = partHashes(local);
      const remote = remotePartValues(agent);
      const remoteHash = partHashes(remote);
      const mtimes = localPartMtimes(profile);
      const remoteMs = Date.parse(agent.updatedAt) || 0;

      const toPush: SyncPart[] = [];
      const toPull: SyncPart[] = [];
      for (const part of PARTS) {
        const action = decidePartAction(
          state.base[part],
          localHash[part],
          remoteHash[part],
          mtimes[part],
          remoteMs,
        );
        if (action === "push") toPush.push(part);
        else if (action === "pull") toPull.push(part);
      }

      if (agent.name !== profile.name) {
        warnings.push(
          `Cloud agent is named "${agent.name}"; the local profile stays "${profile.name}" (renames don't sync).`,
        );
      }

      let pushedOk = true;
      if (toPush.length > 0) {
        const { body, skipped } = buildPushBody(toPush, local);
        warnings.push(...skipped);
        if (Object.keys(body).length > 0) {
          const res = await api(
            account.apiUrl,
            token,
            "PATCH",
            `/api/agents/${agent.id}`,
            body,
          );
          if (!res.ok) {
            pushedOk = false;
            warnings.push(`Push failed (HTTP ${res.status}).`);
          }
        }
      }
      for (const part of toPull) await applyPull(profile.id, part, remote);

      // New base per part: whichever side won is now common ground. Parts
      // that failed to push (or were skipped as oversize) keep their old base
      // so they stay pending.
      const base: SyncState["base"] = { ...state.base };
      for (const part of PARTS) {
        if (toPull.includes(part)) base[part] = remoteHash[part];
        else if (toPush.includes(part)) {
          if (pushedOk && !isPartSkipped(part, local))
            base[part] = localHash[part];
        } else base[part] = localHash[part];
      }
      writeSyncState(profile.id, {
        version: 1,
        agentId: agent.id,
        accountId: userId,
        apiUrl: normalizeApiUrl(account.apiUrl),
        remoteName: agent.name,
        base,
      });

      outcomes.push({
        profile: profile.id,
        agentId: agent.id,
        action:
          toPush.length > 0
            ? "pushed"
            : toPull.length > 0
              ? "pulled"
              : "up-to-date",
        warnings,
      });
    } catch (err) {
      outcomes.push({
        profile: profile.id,
        agentId: agent.id,
        action: "error",
        warnings: [...warnings, (err as Error).message],
      });
    }
  }

  // Back up never-synced local profiles as new cloud agents.
  for (const profile of unlinkedLocals) {
    const warnings: string[] = [];
    try {
      const local = localPartValues(profile);
      // The cloud agent's human label is the profile's display name.
      const name = profile.name.slice(0, MAX_NAME_CHARS);
      const { body, skipped } = buildPushBody(PARTS, local);
      warnings.push(...skipped);
      const res = await api(account.apiUrl, token, "POST", "/api/agents", {
        ...body,
        name,
      });
      const created = res.data.agent as RemoteAgent | undefined;
      if (!res.ok || !created) {
        outcomes.push({
          profile: profile.id,
          action: "error",
          warnings: [...warnings, `Create failed (HTTP ${res.status}).`],
        });
        continue;
      }
      const base: SyncState["base"] = {};
      const localHash = partHashes(local);
      for (const part of PARTS) {
        if (!isPartSkipped(part, local)) base[part] = localHash[part];
      }
      writeSyncState(profile.id, {
        version: 1,
        agentId: created.id,
        accountId: userId,
        apiUrl: normalizeApiUrl(account.apiUrl),
        remoteName: created.name,
        base,
      });
      outcomes.push({
        profile: profile.id,
        agentId: created.id,
        action: "created-remote",
        warnings,
      });
    } catch (err) {
      outcomes.push({
        profile: profile.id,
        action: "error",
        warnings: [...warnings, (err as Error).message],
      });
    }
  }

  // Pull-create local profiles for cloud-only agents. createProfile derives a
  // valid, collision-free id from the agent's display name and returns it; all
  // on-disk writes below key off that id.
  for (const agent of remotes) {
    if (
      claimed.has(agent.id) ||
      excludesAgent(deletedLinks, agent.id, userId, account.apiUrl)
    )
      continue;
    const warnings: string[] = [];
    const createRes = createProfile(agent.name, null);
    if (!createRes.success || !createRes.id) {
      outcomes.push({
        profile: agent.name,
        agentId: agent.id,
        action: "error",
        warnings: [...warnings, createRes.error ?? "Profile creation failed."],
      });
      continue;
    }
    const id = createRes.id;
    try {
      const remote = remotePartValues(agent);
      const meta = await readProfileMeta(id);
      // Save the identity before an asynchronous pull. If a pull fails,
      // deletion can still exclude this agent and retries retain the true
      // local baseline instead of pushing partially imported defaults.
      const state: SyncState = {
        version: 1,
        agentId: agent.id,
        accountId: userId,
        apiUrl: normalizeApiUrl(account.apiUrl),
        remoteName: agent.name,
        base: partHashes(
          localPartValues({ id, color: meta.color || defaultColorForName(id) }),
        ),
      };
      writeSyncState(id, state);
      const hashes = partHashes(remote);
      for (const part of PARTS) {
        await applyPull(id, part, remote);
        state.base[part] = hashes[part];
        writeSyncState(id, state);
      }
      outcomes.push({
        profile: id,
        agentId: agent.id,
        action: "created-local",
        warnings,
      });
    } catch (error) {
      outcomes.push({
        profile: id,
        agentId: agent.id,
        action: "error",
        warnings: [(error as Error).message],
      });
    }
  }

  return finished({ status: "ok", outcomes });
}

/** Whether buildPushBody would omit this part (oversize / unset model). */
function isPartSkipped(part: SyncPart, values: PartValues): boolean {
  if (part === "soul") return values.soul.length > MAX_SOUL_CHARS;
  if (part === "memory") return values.memory.length > MAX_MEMORY_CHARS;
  if (part === "config") return !values.config.model;
  return false;
}
