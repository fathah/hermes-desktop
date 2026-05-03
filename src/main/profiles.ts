import { execFileSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import {
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "./installer";

const PROFILES_DIR = join(HERMES_HOME, "profiles");

export interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

async function readProfileConfig(profilePath: string): Promise<{
  model: string;
  provider: string;
}> {
  const configFile = join(profilePath, "config.yaml");
  try {
    const content = await fs.readFile(configFile, "utf-8");
    const modelMatch = content.match(/^\s*default:\s*["']?([^"'\n#]+)["']?/m);
    const providerMatch = content.match(
      /^\s*provider:\s*["']?([^"'\n#]+)["']?/m,
    );
    return {
      model: modelMatch ? modelMatch[1].trim() : "",
      provider: providerMatch ? providerMatch[1].trim() : "auto",
    };
  } catch {
    return { model: "", provider: "" };
  }
}

async function countSkills(profilePath: string): Promise<number> {
  const skillsDir = join(profilePath, "skills");
  try {
    const dirs = await fs.readdir(skillsDir);
    let count = 0;
    for (const d of dirs) {
      const sub = join(skillsDir, d);
      const stat = await fs.stat(sub);
      if (stat.isDirectory()) {
        const inner = await fs.readdir(sub);
        for (const f of inner) {
          try {
            await fs.access(join(sub, f, "SKILL.md"));
            count++;
          } catch {
            // not a skill
          }
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function isGatewayRunning(profilePath: string): Promise<boolean> {
  const pidFile = join(profilePath, "gateway.pid");
  try {
    const raw = await fs.readFile(pidFile, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function getActiveProfileName(): Promise<string> {
  const activeFile = join(HERMES_HOME, "active_profile");
  try {
    const name = await fs.readFile(activeFile, "utf-8");
    return name.trim() || "default";
  } catch {
    return "default";
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const activeName = await getActiveProfileName();
  const profiles: ProfileInfo[] = [];

  // Default profile is HERMES_HOME itself
  const [
    defaultConfig,
    defaultHasEnv,
    defaultHasSoul,
    defaultSkills,
    defaultGw,
  ] = await Promise.all([
    readProfileConfig(HERMES_HOME),
    fileExists(join(HERMES_HOME, ".env")),
    fileExists(join(HERMES_HOME, "SOUL.md")),
    countSkills(HERMES_HOME),
    isGatewayRunning(HERMES_HOME),
  ]);

  profiles.push({
    name: "default",
    path: HERMES_HOME,
    isDefault: true,
    isActive: activeName === "default",
    model: defaultConfig.model,
    provider: defaultConfig.provider,
    hasEnv: defaultHasEnv,
    hasSoul: defaultHasSoul,
    skillCount: defaultSkills,
    gatewayRunning: defaultGw,
  });

  // Named profiles under ~/.hermes/profiles/
  if (existsSync(PROFILES_DIR)) {
    try {
      const dirs = await fs.readdir(PROFILES_DIR);
      const profilePromises = dirs.map(async (name) => {
        const profilePath = join(PROFILES_DIR, name);
        const stat = await fs.stat(profilePath);
        if (!stat.isDirectory()) return null;

        const hasConfig = await fileExists(join(profilePath, "config.yaml"));
        const hasEnvFile = await fileExists(join(profilePath, ".env"));
        if (!hasConfig && !hasEnvFile) return null;

        const [config, hasSoul, skillCount, gwRunning] = await Promise.all([
          readProfileConfig(profilePath),
          fileExists(join(profilePath, "SOUL.md")),
          countSkills(profilePath),
          isGatewayRunning(profilePath),
        ]);

        return {
          name,
          path: profilePath,
          isDefault: false,
          isActive: activeName === name,
          model: config.model,
          provider: config.provider,
          hasEnv: hasEnvFile,
          hasSoul: hasSoul,
          skillCount,
          gatewayRunning: gwRunning,
        } as ProfileInfo;
      });

      const resolved = await Promise.all(profilePromises);
      for (const p of resolved) {
        if (p) profiles.push(p);
      }
    } catch {
      // ignore
    }
  }

  return profiles;
}

export function createProfile(
  name: string,
  clone: boolean,
): { success: boolean; error?: string } {
  try {
    const args = clone
      ? ["profile", "create", name, "--clone"]
      : ["profile", "create", name];
    execFileSync(HERMES_PYTHON, [HERMES_SCRIPT, ...args], {
      cwd: join(HERMES_HOME, "hermes-agent"),
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 15000,
    });
    return { success: true };
  } catch (err) {
    const msg =
      (err as { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    return { success: false, error: msg.trim() };
  }
}

export function deleteProfile(name: string): {
  success: boolean;
  error?: string;
} {
  if (name === "default")
    return { success: false, error: "Cannot delete the default profile" };
  try {
    execFileSync(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "profile", "delete", name, "--yes"],
      {
        cwd: join(HERMES_HOME, "hermes-agent"),
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        stdio: "pipe",
        timeout: 15000,
      },
    );
    return { success: true };
  } catch (err) {
    const msg =
      (err as { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    return { success: false, error: msg.trim() };
  }
}

export function setActiveProfile(name: string): void {
  try {
    execFileSync(HERMES_PYTHON, [HERMES_SCRIPT, "profile", "use", name], {
      cwd: join(HERMES_HOME, "hermes-agent"),
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 10000,
    });
  } catch {
    // ignore
  }
}
