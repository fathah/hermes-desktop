import { t } from "../../shared/i18n";
import { resolveModelConfigFromContent } from "../config/model-config";
import { getAppLocale } from "../locale";
import type { SshConfig } from "../ssh-tunnel";
import type { ToolsetInfo } from "../tools";
import { deleteYamlValue, getYamlValue, setYamlValue } from "../yaml-utils";
import { sshReadFile, sshWriteFile } from "./core";

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLSET_DEFS = [
  {
    key: "web",
    labelKey: "tools.web.label",
    descriptionKey: "tools.web.description",
  },
  {
    key: "browser",
    labelKey: "tools.browser.label",
    descriptionKey: "tools.browser.description",
  },
  {
    key: "terminal",
    labelKey: "tools.terminal.label",
    descriptionKey: "tools.terminal.description",
  },
  {
    key: "file",
    labelKey: "tools.file.label",
    descriptionKey: "tools.file.description",
  },
  {
    key: "code_execution",
    labelKey: "tools.code_execution.label",
    descriptionKey: "tools.code_execution.description",
  },
  {
    key: "vision",
    labelKey: "tools.vision.label",
    descriptionKey: "tools.vision.description",
  },
  {
    key: "image_gen",
    labelKey: "tools.image_gen.label",
    descriptionKey: "tools.image_gen.description",
  },
  {
    key: "tts",
    labelKey: "tools.tts.label",
    descriptionKey: "tools.tts.description",
  },
  {
    key: "skills",
    labelKey: "tools.skills.label",
    descriptionKey: "tools.skills.description",
  },
  {
    key: "memory",
    labelKey: "tools.memory.label",
    descriptionKey: "tools.memory.description",
  },
  {
    key: "session_search",
    labelKey: "tools.session_search.label",
    descriptionKey: "tools.session_search.description",
  },
  {
    key: "clarify",
    labelKey: "tools.clarify.label",
    descriptionKey: "tools.clarify.description",
  },
  {
    key: "delegation",
    labelKey: "tools.delegation.label",
    descriptionKey: "tools.delegation.description",
  },
];

function parseEnabledToolsets(content: string): Set<string> {
  const enabled = new Set<string>();
  let inPlatformToolsets = false;
  let inCli = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trimEnd();
    if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
      inPlatformToolsets = true;
      inCli = false;
      continue;
    }
    if (inPlatformToolsets && /^\s+cli\s*:/.test(trimmed)) {
      inCli = true;
      continue;
    }
    if (inPlatformToolsets && /^\S/.test(trimmed) && !/^\s*$/.test(trimmed)) {
      inPlatformToolsets = false;
      inCli = false;
      continue;
    }
    if (inCli && /^\s{4}\S/.test(trimmed) && !/^\s{4,}-/.test(trimmed)) {
      inCli = false;
      continue;
    }
    if (inCli) {
      const m = trimmed.match(/^\s+-\s+["']?(\w+)["']?/);
      if (m) enabled.add(m[1]);
    }
  }
  return enabled;
}

function localizeToolDefs(
  enabled: boolean | ((key: string) => boolean),
): ToolsetInfo[] {
  const locale = getAppLocale();
  return TOOLSET_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey, locale),
    description: t(d.descriptionKey, locale),
    enabled: typeof enabled === "function" ? enabled(d.key) : enabled,
  }));
}

export function remoteConfigPath(profile?: string): string {
  if (profile && profile !== "default")
    return `$HOME/.hermes/profiles/${profile}/config.yaml`;
  return `$HOME/.hermes/config.yaml`;
}

export async function sshGetToolsets(
  config: SshConfig,
  profile?: string,
): Promise<ToolsetInfo[]> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return localizeToolDefs(true);
  const enabled = parseEnabledToolsets(content);
  if (enabled.size === 0 && !content.includes("platform_toolsets"))
    return localizeToolDefs(true);
  return localizeToolDefs((key) => enabled.has(key));
}

export async function sshSetToolsetEnabled(
  config: SshConfig,
  key: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  try {
    const configPath = remoteConfigPath(profile);
    const content = await sshReadFile(config, configPath);
    if (!content) return false;

    const current = parseEnabledToolsets(content);
    if (enabled) current.add(key);
    else current.delete(key);

    const toolsetLines = Array.from(current)
      .sort()
      .map((t) => `      - ${t}`)
      .join("\n");
    const newSection = `  cli:\n${toolsetLines}`;

    let newContent: string;
    if (content.includes("platform_toolsets")) {
      const lines = content.split("\n");
      const result: string[] = [];
      let inPT = false,
        inCli = false,
        inserted = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimEnd();
        if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
          inPT = true;
          result.push(line);
          continue;
        }
        if (inPT && /^\s+cli\s*:/.test(trimmed)) {
          inCli = true;
          result.push(newSection);
          inserted = true;
          continue;
        }
        if (inCli) {
          if (/^\s+-\s/.test(trimmed)) continue;
          inCli = false;
          result.push(line);
          continue;
        }
        if (inPT && /^\S/.test(trimmed) && trimmed !== "") {
          inPT = false;
          if (!inserted) {
            result.push(newSection);
          }
        }
        result.push(line);
      }
      newContent = result.join("\n");
    } else {
      newContent =
        content.trimEnd() + "\n\nplatform_toolsets:\n" + newSection + "\n";
    }

    await sshWriteFile(config, configPath, newContent);
    return true;
  } catch {
    return false;
  }
}

// ── Env / Config (Providers) ─────────────────────────────────────────────────

function remoteEnvPath(profile?: string): string {
  if (profile && profile !== "default")
    return `~/.hermes/profiles/${profile}/.env`;
  return "~/.hermes/.env";
}

export async function sshReadEnv(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, string>> {
  const content = await sshReadFile(config, remoteEnvPath(profile));
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const k = trimmed.substring(0, eqIdx).trim();
    let v = trimmed.substring(eqIdx + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (v) result[k] = v;
  }
  // Home Assistant has accumulated three naming conventions across hermes
  // versions: HASS_* (what gateway/config.py currently reads), HOMEASSISTANT_*
  // (legacy), and HA_* (older desktop builds). Mirror all three so the UI
  // can display the value regardless of which one the remote server uses.
  const HA_ALIAS_GROUPS: string[][] = [
    ["HASS_URL", "HOMEASSISTANT_URL", "HA_URL"],
    ["HASS_TOKEN", "HOMEASSISTANT_TOKEN", "HA_TOKEN"],
  ];
  for (const group of HA_ALIAS_GROUPS) {
    const present = group.find((k) => result[k]);
    if (!present) continue;
    const value = result[present];
    for (const k of group) {
      if (!result[k]) result[k] = value;
    }
  }
  return result;
}

export async function sshSetEnvValue(
  config: SshConfig,
  key: string,
  value: string,
  profile?: string,
): Promise<void> {
  const envPath = remoteEnvPath(profile);
  const content = await sshReadFile(config, envPath);

  if (!content.trim()) {
    await sshWriteFile(config, envPath, `${key}=${value}\n`);
    return;
  }

  const lines = content.split("\n");
  let found = false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().match(new RegExp(`^#?\\s*${escaped}\\s*=`))) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) lines.push(`${key}=${value}`);
  await sshWriteFile(config, envPath, lines.join("\n"));
}

// ─── Dotted-path YAML helpers (consolidated to yaml-utils.ts) ───────────────

export async function sshGetConfigValue(
  config: SshConfig,
  key: string,
  profile?: string,
): Promise<string | null> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return null;
  return getYamlValue(content, key);
}

export async function sshSetConfigValue(
  config: SshConfig,
  key: string,
  value: string,
  profile?: string,
): Promise<void> {
  if (/["\\\n\r]/.test(value)) {
    throw new Error(
      'Config value contains illegal characters: ", \\, or newline',
    );
  }
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;

  const updated = setYamlValue(content, key, value, { upsert: false });
  await sshWriteFile(config, configPath, updated);
}

export function sshGetHermesHome(_config: SshConfig, profile?: string): string {
  if (profile && profile !== "default") return `~/.hermes/profiles/${profile}`;
  return "~/.hermes";
}

export async function sshGetModelConfig(
  config: SshConfig,
  profile?: string,
): Promise<{ provider: string; model: string; baseUrl: string }> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return { provider: "auto", model: "", baseUrl: "" };
  return resolveModelConfigFromContent(content);
}

export async function sshSetModelConfig(
  config: SshConfig,
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): Promise<void> {
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;

  let updated = setYamlValue(content, "model.provider", provider);
  updated = setYamlValue(updated, "model.default", model);
  if (baseUrl) {
    updated = setYamlValue(updated, "model.base_url", baseUrl);
  } else {
    updated = deleteYamlValue(updated, "model.base_url");
  }

  // Enable streaming
  if (getYamlValue(updated, "streaming") !== null) {
    updated = setYamlValue(updated, "streaming", "true");
  }

  // Disable smart_model_routing
  updated = setYamlValue(updated, "smart_model_routing.enabled", "false");

  if (updated !== content) {
    await sshWriteFile(config, configPath, updated);
  }
}
