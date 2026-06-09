import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Claude-Code-style `/skill-name` for the app's chat surfaces.
 *
 * One hook owns everything the two chat surfaces (Hermes Chat + SPS assistant)
 * need: the installed-skill catalogue (for the slash menu + slug resolution),
 * the active (loaded) set (for chips), the command parser, and the IPC calls.
 * Active state lives in the main process keyed by profile, so both surfaces see
 * the same loaded skills — this hook just mirrors it for display.
 */

export interface ActiveSkill {
  name: string;
  path: string;
}

export interface InstalledSkillLite {
  name: string;
  category: string;
  description: string;
  path: string;
}

export interface SkillCommandMatch {
  action: "load" | "unload";
  /** load: the resolved skill name. unload: a name, or undefined = unload all. */
  name?: string;
}

export interface UseChatSkills {
  active: ActiveSkill[];
  installed: InstalledSkillLite[];
  refresh: () => Promise<void>;
  /** Sync parse — true command surfaces must decide local-vs-backend without I/O. */
  match: (text: string) => SkillCommandMatch | null;
  /** Execute a `/skill`/`/unload`/`/<slug>` command; returns a markdown confirmation. */
  run: (text: string) => Promise<string>;
  /** Remove one loaded skill (chip "×"). */
  unloadByName: (name: string) => Promise<void>;
}

/** lowercase, non-alphanumerics → "-" — matches the main-process slug. */
export function slugifySkill(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface UseChatSkillsArgs {
  profile?: string;
  /** Slash commands the surface already owns — never shadow them with a skill slug. */
  reservedSlashNames?: string[];
}

export function useChatSkills({
  profile,
  reservedSlashNames = [],
}: UseChatSkillsArgs): UseChatSkills {
  const [active, setActive] = useState<ActiveSkill[]>([]);
  const [installed, setInstalled] = useState<InstalledSkillLite[]>([]);

  // Sync mirrors so `match` (called from the synchronous local-vs-backend gate)
  // can resolve slugs without awaiting.
  const installedRef = useRef<InstalledSkillLite[]>([]);
  const reservedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    reservedRef.current = new Set(
      reservedSlashNames.map((n) => n.replace(/^\//, "").toLowerCase()),
    );
  }, [reservedSlashNames]);

  const refresh = useCallback(async (): Promise<void> => {
    const [act, inst] = await Promise.all([
      window.hermesAPI.listActiveSkills(profile),
      window.hermesAPI.listInstalledSkills(profile),
    ]);
    setActive(act);
    setInstalled(inst);
    installedRef.current = inst;
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const match = useCallback((text: string): SkillCommandMatch | null => {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return null;
    const [rawCmd, ...rest] = trimmed.split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const arg = rest.join(" ").trim();

    if (cmd === "/skill") return { action: "load", name: arg };
    if (cmd === "/unload") return { action: "unload", name: arg || undefined };

    // Direct `/<slug>` form (faithful to Claude Code). Built-in commands win.
    const slug = cmd.slice(1);
    if (!slug || reservedRef.current.has(slug)) return null;
    const hit = installedRef.current.find((s) => slugifySkill(s.name) === slug);
    return hit ? { action: "load", name: hit.name } : null;
  }, []);

  const run = useCallback(
    async (text: string): Promise<string> => {
      const m = match(text);
      if (!m) return "";

      if (m.action === "unload") {
        const res = await window.hermesAPI.unloadSkillFromChat(m.name, profile);
        await refresh();
        if (res.removed.length === 0) {
          return m.name
            ? `No loaded skill named **${m.name}** to unload.`
            : "No skills are loaded.";
        }
        return `Unloaded ${res.removed.map((n) => `**${n}**`).join(", ")}.`;
      }

      // load
      if (!m.name) {
        return "Usage: `/skill <name>` — loads that skill's instructions for this conversation.";
      }
      const res = await window.hermesAPI.loadSkillToChat(m.name, profile);
      await refresh();
      if (!res.ok) {
        return `Couldn't load skill: ${res.error ?? "unknown error"}`;
      }
      if (res.alreadyLoaded) {
        return `**${res.name}** is already loaded for this conversation.`;
      }
      return (
        `Loaded skill **${res.name}** — its instructions are now active for ` +
        "this conversation. Use `/unload` to remove it."
      );
    },
    [match, profile, refresh],
  );

  const unloadByName = useCallback(
    async (name: string): Promise<void> => {
      await window.hermesAPI.unloadSkillFromChat(name, profile);
      await refresh();
    },
    [profile, refresh],
  );

  return useMemo(
    () => ({ active, installed, refresh, match, run, unloadByName }),
    [active, installed, refresh, match, run, unloadByName],
  );
}
