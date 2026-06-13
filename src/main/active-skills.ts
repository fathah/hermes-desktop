/**
 * Active (loaded) skills for the chat surfaces.
 *
 * Claude-Code-style `/skill-name`: the user explicitly loads a skill so its
 * SKILL.md *instructions* (not just its name) enter the conversation. State is
 * held in the main process, keyed by profile, in memory — "sticky for the
 * session" means it survives across turns but resets on app restart. Both chat
 * surfaces (Hermes Chat + SPS assistant) share the per-profile set and inject
 * the same built system message, so the wiring lives in exactly one place.
 *
 * This LOADS instructions; it does NOT execute skill code. Hermes skills are a
 * superset of Claude-Code skills — some ship an executable `main.py` run by the
 * Python backend. Injecting the SKILL.md body still helps those (it tells the
 * agent when/how to delegate), but running the code stays the backend's job.
 */
import { listInstalledSkills, getSkillContent } from "./skills";
import { profileKey } from "./hermes/gateway-process";
import { recordSkillInjected, recordSkillLoaded } from "./skill-usage";
import { readCapabilityRiskRegistry } from "./capability-risk-store";

/** Combined active-skill content above this many chars triggers a warning. */
const SOFT_CAP_CHARS = 12_000;

/** profileKey -> (skill path -> display name). */
const activeByProfile = new Map<string, Map<string, string>>();

export interface ActiveSkill {
  name: string;
  path: string;
}

export interface LoadSkillResult {
  ok: boolean;
  name?: string;
  path?: string;
  alreadyLoaded?: boolean;
  error?: string;
}

export interface UnloadSkillResult {
  ok: boolean;
  removed: string[];
}

/** Normalise a skill name to a slash-token: lowercase, non-alphanumerics → "-". */
export function slugifySkill(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Get the per-profile map. Reads never create an entry (so the empty-store
 *  fast path in the builder stays valid); only loads create one. */
function activeMap(
  profile: string | undefined,
  create: boolean,
): Map<string, string> | undefined {
  const key = profileKey(profile);
  let map = activeByProfile.get(key);
  if (!map && create) {
    map = new Map<string, string>();
    activeByProfile.set(key, map);
  }
  return map;
}

/**
 * Load a skill into the active set by name or slug. Resolves the name against
 * the installed skills so we store a real on-disk path to read later.
 */
export function loadActiveSkill(
  name: string,
  profile?: string,
): LoadSkillResult {
  const query = (name ?? "").trim();
  if (!query) return { ok: false, error: "No skill name given." };

  const wanted = slugifySkill(query);
  const installed = listInstalledSkills(profile);
  const match =
    installed.find((s) => s.name.toLowerCase() === query.toLowerCase()) ||
    installed.find((s) => slugifySkill(s.name) === wanted);

  if (!match) {
    return { ok: false, error: `No installed skill matches "${query}".` };
  }
  const gate = skillGateDecision(match.path, profile);
  if (!gate.allowed) return { ok: false, error: gate.reason };

  const map = activeMap(profile, true)!;
  const alreadyLoaded = map.has(match.path);
  map.set(match.path, match.name);
  if (!alreadyLoaded)
    recordSkillLoaded({ name: match.name, path: match.path }, profile);
  return { ok: true, name: match.name, path: match.path, alreadyLoaded };
}

/**
 * Unload one skill (by name/slug/path) or, when given "all"/"*", every skill.
 * Returns the display names that were removed.
 */
export function unloadActiveSkill(
  nameOrAll: string | undefined,
  profile?: string,
): UnloadSkillResult {
  const map = activeMap(profile, false);
  const target = (nameOrAll ?? "").trim().toLowerCase();

  if (!target || target === "all" || target === "*") {
    if (!map) return { ok: true, removed: [] };
    const removed = Array.from(map.values());
    map.clear();
    return { ok: true, removed };
  }

  if (!map) return { ok: false, removed: [] };

  const wanted = slugifySkill(target);
  const removed: string[] = [];
  for (const [path, displayName] of Array.from(map.entries())) {
    const matches =
      displayName.toLowerCase() === target ||
      slugifySkill(displayName) === wanted ||
      path === nameOrAll;
    if (matches) {
      map.delete(path);
      removed.push(displayName);
    }
  }
  return { ok: removed.length > 0, removed };
}

/** List the skills currently loaded for a profile. */
export function listActiveSkills(profile?: string): ActiveSkill[] {
  const map = activeMap(profile, false);
  if (!map) return [];
  return Array.from(map.entries()).map(([path, name]) => ({ name, path }));
}

/**
 * Build the system message that carries every loaded skill's instructions into
 * the next turn. Returns null when nothing is loaded so callers can skip it.
 * Skills whose content is unreadable (moved/deleted on disk) are skipped.
 */
export function buildActiveSkillsSystemMessage(
  profile?: string,
): { role: "system"; content: string } | null {
  // Fast path for the overwhelmingly common case (nothing loaded anywhere):
  // return before resolving the profile, which touches config/disk. Guarded by
  // a try/catch so a profile-resolution or read hiccup can never break a send —
  // it just means no skill injection this turn (mirrors self-awareness).
  if (activeByProfile.size === 0) return null;
  try {
    return buildActiveSkillsSystemMessageInner(profile);
  } catch (err) {
    console.error("[active-skills] failed to build system message:", err);
    return null;
  }
}

function buildActiveSkillsSystemMessageInner(
  profile?: string,
): { role: "system"; content: string } | null {
  const active = listActiveSkills(profile);
  if (active.length === 0) return null;

  const sections: string[] = [];
  const injected: ActiveSkill[] = [];
  for (const skill of active) {
    if (!skillGateDecision(skill.path, profile).allowed) continue;
    const body = getSkillContent(skill.path).trim();
    if (!body) continue;
    sections.push(`## Skill: ${skill.name}\n\n${body}`);
    injected.push(skill);
  }
  if (sections.length === 0) return null;

  const preamble =
    "The user has explicitly loaded the following skill(s) for this " +
    "conversation. Treat their instructions as active guidance and follow " +
    "them where relevant.";
  const content = `${preamble}\n\n${sections.join("\n\n---\n\n")}`;

  if (content.length > SOFT_CAP_CHARS) {
    console.warn(
      `[active-skills] loaded skill content is ${content.length} chars ` +
        `(> ${SOFT_CAP_CHARS}); injected in full but this inflates every turn.`,
    );
  }

  recordSkillInjected(injected, profile);
  return { role: "system", content };
}

function skillGateDecision(
  path: string,
  profile?: string,
): { allowed: boolean; reason?: string } {
  const report = readCapabilityRiskRegistry(profile).reports.find(
    (r) => r.id === `skill:${path}`,
  );
  if (!report) {
    return {
      allowed: false,
      reason: "Skill needs a capability safety check before it can be loaded.",
    };
  }
  if (report.status === "blocked") {
    return {
      allowed: false,
      reason: "Skill is blocked by the capability safety check.",
    };
  }
  if (report.reviewState !== "reviewed") {
    return {
      allowed: false,
      reason: "Skill must be reviewed in Application Health before use.",
    };
  }
  return { allowed: true };
}

/** Test-only: drop all loaded skills across every profile. */
export function __resetActiveSkillsForTests(): void {
  activeByProfile.clear();
}
