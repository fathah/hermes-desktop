import { join } from "path";
import { promises as fs } from "fs";
import { profileHome, isValidProfileName, PROFILE_NAME_ERROR } from "./utils";

export { PROFILE_COLORS, defaultColorForName } from "../shared/profileColors";

/**
 * Per-profile appearance metadata (avatar + accent colour), stored as
 * `profile-meta.json` inside each profile's home directory. Kept separate from
 * the agent's own config.yaml so desktop-only presentation never collides with
 * the CLI's settings.
 */
export interface ProfileMeta {
  /** Hex colour (e.g. "#3498DB"). When unset, a stable default is derived. */
  color?: string;
  /** Avatar image as a data URL. When unset, a letter avatar is shown. */
  avatar?: string;
}

const META_FILE = "profile-meta.json";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// Avatars are downscaled client-side; cap the stored data URL defensively.
const MAX_AVATAR_BYTES = 1_500_000;

function metaPath(name: string): string {
  return join(profileHome(name), META_FILE);
}

export async function readProfileMeta(name: string): Promise<ProfileMeta> {
  try {
    const raw = await fs.readFile(metaPath(name), "utf-8");
    const parsed = JSON.parse(raw) as ProfileMeta;
    if (!parsed || typeof parsed !== "object") return {};
    const meta: ProfileMeta = {};
    if (typeof parsed.color === "string" && HEX_COLOR.test(parsed.color)) {
      meta.color = parsed.color;
    }
    if (
      typeof parsed.avatar === "string" &&
      parsed.avatar.startsWith("data:image/")
    ) {
      meta.avatar = parsed.avatar;
    }
    return meta;
  } catch {
    return {};
  }
}

async function writeProfileMeta(
  name: string,
  patch: Partial<ProfileMeta>,
): Promise<void> {
  if (!isValidProfileName(name)) throw new Error(PROFILE_NAME_ERROR);
  const current = await readProfileMeta(name);
  const next: ProfileMeta = { ...current, ...patch };
  // Drop keys explicitly cleared with undefined.
  for (const k of Object.keys(next) as (keyof ProfileMeta)[]) {
    if (next[k] === undefined) delete next[k];
  }
  await fs.writeFile(metaPath(name), JSON.stringify(next, null, 2), "utf-8");
}

export async function setProfileColor(
  name: string,
  color: string,
): Promise<{ success: boolean; error?: string }> {
  if (!HEX_COLOR.test(color)) {
    return { success: false, error: "Invalid colour" };
  }
  try {
    await writeProfileMeta(name, { color });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function setProfileAvatar(
  name: string,
  dataUrl: string,
): Promise<{ success: boolean; error?: string }> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return { success: false, error: "Invalid image" };
  }
  if (dataUrl.length > MAX_AVATAR_BYTES) {
    return { success: false, error: "Image too large" };
  }
  try {
    await writeProfileMeta(name, { avatar: dataUrl });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function removeProfileAvatar(
  name: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await writeProfileMeta(name, { avatar: undefined });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
