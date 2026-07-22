import type { ConnectionConfig } from "./config";
import { defaultColorForName } from "./profile-meta";
import type { CreateProfileResult, ProfileInfo } from "./profiles";
import { remoteDashboardRequestJson } from "./remote-api";

const DEFAULT_SOUL = `You are Hermes, a helpful AI assistant. You are friendly, knowledgeable, and always eager to help.

You communicate clearly and concisely. When asked to perform tasks, you think step-by-step and explain your reasoning. You are honest about your limitations and ask for clarification when needed.

You strive to be helpful while being safe and responsible. You respect the user's privacy and handle sensitive information carefully.
`;

type RemoteProfileRow = Record<string, unknown>;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function remoteListProfiles(
  connection: ConnectionConfig,
): Promise<ProfileInfo[]> {
  const [list, active] = await Promise.all([
    remoteDashboardRequestJson<{ profiles?: RemoteProfileRow[] }>(
      connection,
      "/api/profiles",
    ),
    remoteDashboardRequestJson<{ active?: string }>(
      connection,
      "/api/profiles/active",
    ),
  ]);
  const activeName = text(active?.active, "default");
  return (Array.isArray(list?.profiles) ? list.profiles : [])
    .filter((row) => typeof row?.name === "string" && row.name.length > 0)
    .map((row) => {
      const id = text(row.name);
      return {
        id,
        name: id,
        path: text(row.path),
        isDefault: bool(row.is_default) || id === "default",
        isActive: id === activeName,
        model: text(row.model),
        provider: text(row.provider, "auto") || "auto",
        hasEnv: bool(row.has_env),
        hasSoul: false,
        skillCount: count(row.skill_count),
        gatewayRunning: bool(row.gateway_running),
        color: defaultColorForName(id),
        avatar: null,
      };
    });
}

export async function remoteCreateProfile(
  connection: ConnectionConfig,
  name: string,
  cloneFrom: string | null,
): Promise<CreateProfileResult> {
  try {
    const result = await remoteDashboardRequestJson<{
      ok?: boolean;
      name?: string;
    }>(connection, "/api/profiles", {
      method: "POST",
      body: { name, clone_from: cloneFrom },
    });
    return result?.ok === false
      ? { success: false, error: "Remote profile creation failed." }
      : { success: true, id: text(result?.name, name) };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function remoteDeleteProfile(
  connection: ConnectionConfig,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await remoteDashboardRequestJson(
      connection,
      `/api/profiles/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
      },
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function remoteSetActiveProfile(
  connection: ConnectionConfig,
  name: string,
): Promise<boolean> {
  const result = await remoteDashboardRequestJson<{ ok?: boolean }>(
    connection,
    "/api/profiles/active",
    { method: "POST", body: { name } },
  );
  return result?.ok !== false;
}

function soulPath(profile: string): string {
  return `/api/profiles/${encodeURIComponent(profile || "default")}/soul`;
}

export async function remoteReadSoul(
  connection: ConnectionConfig,
  profile = "default",
): Promise<string> {
  const result = await remoteDashboardRequestJson<{ content?: string }>(
    connection,
    soulPath(profile),
  );
  return text(result?.content);
}

export async function remoteWriteSoul(
  connection: ConnectionConfig,
  content: string,
  profile = "default",
): Promise<boolean> {
  const result = await remoteDashboardRequestJson<{ ok?: boolean }>(
    connection,
    soulPath(profile),
    { method: "PUT", body: { content } },
  );
  return result?.ok !== false;
}

export async function remoteResetSoul(
  connection: ConnectionConfig,
  profile = "default",
): Promise<string> {
  await remoteWriteSoul(connection, DEFAULT_SOUL, profile);
  return DEFAULT_SOUL;
}
