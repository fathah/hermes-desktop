import type { SshConfig } from "../ssh-tunnel";
import { shellQuote, sshExec, sshPython } from "./core";
import { buildRemoteHermesCmd } from "./platforms";

// ── Profiles ─────────────────────────────────────────────────────────────────

export interface SshProfileInfo {
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

export function parseHermesProfileListOutput(output: string): SshProfileInfo[] {
  const profiles: SshProfileInfo[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^profile\s+model\s+gateway\b/i.test(trimmed)) continue;
    if (/^[─\-\s]+$/.test(trimmed)) continue;

    const isActive = /^[◆*]/.test(trimmed);
    const line = trimmed.replace(/^[◆*]\s*/, "");
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    const [name, model, gateway] = parts;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) continue;

    const gatewayState = gateway.toLowerCase();
    if (gatewayState !== "running" && gatewayState !== "stopped") continue;

    profiles.push({
      name,
      path: name === "default" ? "~/.hermes" : `~/.hermes/profiles/${name}`,
      isDefault: name === "default",
      isActive,
      model: model === "—" ? "" : model,
      provider: "auto",
      hasEnv: false,
      hasSoul: false,
      skillCount: 0,
      gatewayRunning: gatewayState === "running",
    });
  }

  if (profiles.length > 0 && !profiles.some((p) => p.isActive)) {
    const fallback = profiles.find((p) => p.isDefault) ?? profiles[0];
    fallback.isActive = true;
  }

  return profiles;
}

async function sshListProfilesViaHermesCli(
  config: SshConfig,
): Promise<SshProfileInfo[]> {
  try {
    const out = await sshExec(
      config,
      buildRemoteHermesCmd(["profile", "list"], " 2>/dev/null"),
      undefined,
      20000,
    );
    return parseHermesProfileListOutput(out);
  } catch {
    return [];
  }
}

export async function sshListProfiles(
  config: SshConfig,
): Promise<SshProfileInfo[]> {
  const script = `
import os, json
hermes_home = os.path.expanduser("~/.hermes")
profiles_dir = os.path.join(hermes_home, "profiles")
profiles = []

def read_config(path):
    model, provider = "", "auto"
    config_file = os.path.join(path, "config.yaml")
    if os.path.exists(config_file):
        content = open(config_file).read()
        import re
        m = re.search(r'^\\s*default:\\s*["\\'\\']?([^"\\'\\' \\n#]+)["\\'\\']?', content, re.M)
        if m: model = m.group(1).strip()
        p = re.search(r'^\\s*provider:\\s*["\\'\\']?([^"\\'\\' \\n#]+)["\\'\\']?', content, re.M)
        if p: provider = p.group(1).strip()
    return model, provider

def count_skills(path):
    skills_dir = os.path.join(path, "skills")
    count = 0
    if os.path.isdir(skills_dir):
        for cat in os.listdir(skills_dir):
            cat_path = os.path.join(skills_dir, cat)
            if os.path.isdir(cat_path):
                for name in os.listdir(cat_path):
                    if os.path.exists(os.path.join(cat_path, name, "SKILL.md")):
                        count += 1
    return count

def gw_running(path):
    pid_file = os.path.join(path, "gateway.pid")
    if not os.path.exists(pid_file): return False
    try:
        pid = int(open(pid_file).read().strip())
        os.kill(pid, 0)
        return True
    except:
        return False

# Default profile
model, provider = read_config(hermes_home)
profiles.append({
    "name": "default", "path": hermes_home, "isDefault": True, "isActive": True,
    "model": model, "provider": provider,
    "hasEnv": os.path.exists(os.path.join(hermes_home, ".env")),
    "hasSoul": os.path.exists(os.path.join(hermes_home, "SOUL.md")),
    "skillCount": count_skills(hermes_home),
    "gatewayRunning": gw_running(hermes_home)
})

if os.path.isdir(profiles_dir):
    for name in sorted(os.listdir(profiles_dir)):
        p = os.path.join(profiles_dir, name)
        if not os.path.isdir(p): continue
        model, provider = read_config(p)
        profiles.append({
            "name": name, "path": p, "isDefault": False, "isActive": False,
            "model": model, "provider": provider,
            "hasEnv": os.path.exists(os.path.join(p, ".env")),
            "hasSoul": os.path.exists(os.path.join(p, "SOUL.md")),
            "skillCount": count_skills(p),
            "gatewayRunning": gw_running(p)
        })

print(json.dumps(profiles))
`;
  const cliProfiles = await sshListProfilesViaHermesCli(config);

  try {
    const out = await sshPython(config, script);
    const scannedProfiles = JSON.parse(out.trim() || "[]") as SshProfileInfo[];
    if (cliProfiles.length > scannedProfiles.length) return cliProfiles;
    return scannedProfiles.length > 0 ? scannedProfiles : cliProfiles;
  } catch {
    if (cliProfiles.length > 0) return cliProfiles;
    return [
      {
        name: "default",
        path: "~/.hermes",
        isDefault: true,
        isActive: true,
        model: "",
        provider: "auto",
        hasEnv: false,
        hasSoul: false,
        skillCount: 0,
        gatewayRunning: false,
      },
    ];
  }
}

export async function sshCreateProfile(
  config: SshConfig,
  name: string,
  clone: boolean,
): Promise<boolean> {
  try {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe) return false;
    const quoted = shellQuote(safe);
    if (clone) {
      await sshExec(
        config,
        `hermes profiles create ${quoted} --clone-from default 2>&1 || mkdir -p ~/.hermes/profiles/${quoted}`,
      );
    } else {
      await sshExec(
        config,
        `hermes profiles create ${quoted} 2>&1 || mkdir -p ~/.hermes/profiles/${quoted}`,
      );
    }
    return true;
  } catch {
    return false;
  }
}

export async function sshDeleteProfile(
  config: SshConfig,
  name: string,
): Promise<boolean> {
  try {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe || safe === "default") return false;
    const quoted = shellQuote(safe);
    await sshExec(
      config,
      `hermes profiles delete ${quoted} --yes 2>&1 || rm -rf ~/.hermes/profiles/${quoted}`,
    );
    return true;
  } catch {
    return false;
  }
}
