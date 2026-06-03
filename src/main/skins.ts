/**
 * Skin engine (idea A6) — main-process IO.
 *
 * Loads skin files from <profileHome>/skins/ (*.json, *.yaml, *.yml), validates
 * them with the shared pure validator, and returns the usable skins plus their
 * CSS-variable maps for the renderer to apply at the app root.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, extname, basename } from "path";
import YAML from "yaml";
import { profileHome } from "./utils";
import { validateSkin, skinToCssVars, type LoadedSkin } from "../shared/skins";

export type { LoadedSkin };

function skinsDir(profile?: string): string {
  return join(profileHome(profile), "skins");
}

function parseSkinFile(content: string, ext: string): unknown {
  if (ext === ".json") return JSON.parse(content);
  return YAML.parse(content); // .yaml / .yml
}

/**
 * List all valid skins for a profile. Invalid or unparseable files are skipped
 * (never throws). The file stem becomes the skin `id`.
 */
export function listSkins(profile?: string): LoadedSkin[] {
  const dir = skinsDir(profile);
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const out: LoadedSkin[] = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext !== ".json" && ext !== ".yaml" && ext !== ".yml") continue;
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const parsed = parseSkinFile(content, ext);
      const { valid, skin } = validateSkin(parsed);
      if (!valid || !skin) continue;
      out.push({
        id: basename(file, ext),
        skin,
        cssVars: skinToCssVars(skin),
      });
    } catch {
      // unreadable / malformed — skip
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
