import type { SshConfig } from "../ssh-tunnel";
import {
  classifySkillCliOutput,
  type InstalledSkill,
  type SkillSearchResult,
} from "../skills";
import {
  pythonJsonInput,
  shellQuote,
  sshExec,
  sshPython,
  sshReadFile,
} from "./core";

// ── Skills ───────────────────────────────────────────────────────────────────

const REMOTE_PREFIX = "REMOTE:";

export async function sshListInstalledSkills(
  config: SshConfig,
  profile?: string,
): Promise<InstalledSkill[]> {
  const script = `
import os, json, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
skills_dir = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills" if profile and profile != "default" else "~/.hermes/skills")
skills = []

def read_meta(skill_path):
    description = ""
    skill_file = os.path.join(skill_path, "SKILL.md")
    if os.path.exists(skill_file):
        try:
            content = open(skill_file).read(4000)
            if content.startswith("---"):
                end = content.find("---", 3)
                if end != -1:
                    for line in content[3:end].splitlines():
                        if line.strip().startswith("description:"):
                            description = line.split(":",1)[1].strip().strip("'").strip('"')
            else:
                for line in content.splitlines():
                    if line.strip() and not line.startswith("#"):
                        description = line.strip()[:120]
                        break
        except:
            pass
    return description

if os.path.isdir(skills_dir):
    for entry in sorted(os.listdir(skills_dir)):
        entry_path = os.path.join(skills_dir, entry)
        if not os.path.isdir(entry_path):
            continue
        direct_skill_file = os.path.join(entry_path, "SKILL.md")
        if os.path.exists(direct_skill_file):
            skills.append({"name": entry, "category": "", "description": read_meta(entry_path), "path": entry_path})
            continue
        for name in sorted(os.listdir(entry_path)):
            skill_path = os.path.join(entry_path, name)
            if os.path.isdir(skill_path) and os.path.exists(os.path.join(skill_path, "SKILL.md")):
                skills.append({"name": name, "category": entry, "description": read_meta(skill_path), "path": skill_path})
print(json.dumps(skills))
`;
  try {
    const out = await sshPython(config, script, pythonJsonInput({ profile }));
    const parsed = JSON.parse(out.trim() || "[]") as Array<{
      name: string;
      category: string;
      description: string;
      path: string;
    }>;
    return parsed.map((s) => ({ ...s, path: REMOTE_PREFIX + s.path }));
  } catch {
    return [];
  }
}

export async function sshGetSkillContent(
  config: SshConfig,
  skillPath: string,
): Promise<string> {
  const remote = skillPath.startsWith(REMOTE_PREFIX)
    ? skillPath.slice(REMOTE_PREFIX.length)
    : skillPath;
  return await sshReadFile(config, `${remote}/SKILL.md`);
}

export async function sshInstallSkill(
  config: SshConfig,
  identifier: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const stdout = await sshExec(
      config,
      `hermes skills install ${shellQuote(identifier)} --yes 2>&1`,
      undefined,
      120000,
    );
    return classifySkillCliOutput(stdout ?? "");
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sshUninstallSkill(
  config: SshConfig,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const stdout = await sshExec(
      config,
      `hermes skills uninstall ${shellQuote(name)} 2>&1`,
    );
    return classifySkillCliOutput(stdout ?? "");
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sshSearchSkills(
  config: SshConfig,
  query: string,
): Promise<SkillSearchResult[]> {
  try {
    const out = await sshExec(
      config,
      `hermes skills browse --query ${shellQuote(query)} --json 2>/dev/null || echo "[]"`,
    );
    const parsed = JSON.parse(out.trim() || "[]");
    if (Array.isArray(parsed)) {
      return parsed.map((r: Record<string, string>) => ({
        name: r.name || "",
        description: r.description || "",
        category: r.category || "",
        source: r.source || "",
        installed: false,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

export async function sshListBundledSkills(
  config: SshConfig,
): Promise<SkillSearchResult[]> {
  return await sshSearchSkills(config, "");
}
