import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import type { SkillUsageEntry } from "../shared/learning";

export interface SkillUsageSkill {
  name: string;
  path: string;
}

function usagePath(profile?: string): string {
  return join(profileHome(profile), "sps-agent", "skill-usage.json");
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function readUsage(profile?: string): Record<string, SkillUsageEntry> {
  const file = usagePath(profile);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as Record<string, SkillUsageEntry>;
  } catch {
    return {};
  }
}

function writeUsage(
  usage: Record<string, SkillUsageEntry>,
  profile?: string,
): void {
  safeWriteFile(usagePath(profile), `${JSON.stringify(usage, null, 2)}\n`);
}

function entryFor(
  usage: Record<string, SkillUsageEntry>,
  skill: SkillUsageSkill,
): SkillUsageEntry {
  return (
    usage[skill.path] ?? {
      name: skill.name,
      path: skill.path,
      loadCount: 0,
      injectedCount: 0,
    }
  );
}

export function listSkillUsage(
  profile?: string,
): Record<string, SkillUsageEntry> {
  return readUsage(profile);
}

export function recordSkillLoaded(
  skill: SkillUsageSkill,
  profile?: string,
): void {
  const usage = readUsage(profile);
  const entry = entryFor(usage, skill);
  usage[skill.path] = {
    ...entry,
    name: skill.name,
    path: skill.path,
    loadCount: entry.loadCount + 1,
    lastLoadedAt: now(),
  };
  writeUsage(usage, profile);
}

export function recordSkillInjected(
  skills: SkillUsageSkill[],
  profile?: string,
): void {
  if (skills.length === 0) return;
  const usage = readUsage(profile);
  const ts = now();
  for (const skill of skills) {
    const entry = entryFor(usage, skill);
    usage[skill.path] = {
      ...entry,
      name: skill.name,
      path: skill.path,
      injectedCount: entry.injectedCount + 1,
      lastUsedAt: ts,
    };
  }
  writeUsage(usage, profile);
}
