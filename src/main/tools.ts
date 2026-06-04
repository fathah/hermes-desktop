import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";
import { DEFAULT_MESSAGING_PLATFORM_TOOLSETS } from "../shared/messaging-platforms";

export interface ToolsetInfo {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

const TOOLSET_DEFS: {
  key: string;
  labelKey: string;
  descriptionKey: string;
}[] = [
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
  {
    key: "cronjob",
    labelKey: "tools.cronjob.label",
    descriptionKey: "tools.cronjob.description",
  },
  {
    key: "moa",
    labelKey: "tools.moa.label",
    descriptionKey: "tools.moa.description",
  },
  {
    key: "todo",
    labelKey: "tools.todo.label",
    descriptionKey: "tools.todo.description",
  },
];

function localizeToolDefs(
  enabled: boolean | ((key: string) => boolean),
): ToolsetInfo[] {
  const locale = getAppLocale();
  return TOOLSET_DEFS.map((toolDef) => ({
    key: toolDef.key,
    label: t(toolDef.labelKey, locale),
    description: t(toolDef.descriptionKey, locale),
    enabled: typeof enabled === "function" ? enabled(toolDef.key) : enabled,
  }));
}

/**
 * Parse one platform_toolsets.<platform> list from config.yaml.
 * The yaml structure looks like:
 *   platform_toolsets:
 *     cli:
 *       - web
 *       - browser
 *       ...
 * We use line-by-line parsing to stay consistent with config.ts (no yaml dep).
 */
function parsePlatformToolsets(configContent: string): Record<string, Set<string>> {
  const toolsets: Record<string, Set<string>> = {};
  const lines = configContent.split("\n");

  let inPlatformToolsets = false;
  let currentPlatform: string | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
      inPlatformToolsets = true;
      currentPlatform = null;
      continue;
    }

    if (inPlatformToolsets && /^\S/.test(trimmed) && trimmed !== "") {
      inPlatformToolsets = false;
      currentPlatform = null;
      continue;
    }

    if (!inPlatformToolsets) continue;

    const platformMatch = trimmed.match(
      /^\s+([A-Za-z0-9_-]+)\s*:\s*(\[\])?\s*(?:#.*)?$/,
    );
    if (platformMatch) {
      const platformName = platformMatch[1];
      currentPlatform = platformMatch[2] ? null : platformName;
      toolsets[platformName] ??= new Set<string>();
      continue;
    }

    if (currentPlatform) {
      const match = trimmed.match(/^\s+-\s+["']?([A-Za-z0-9_-]+)["']?/);
      if (match) {
        toolsets[currentPlatform].add(match[1]);
      }
    }
  }

  return toolsets;
}

function parseEnabledToolsets(
  configContent: string,
  platform = "cli",
): Set<string> {
  return parsePlatformToolsets(configContent)[platform] ?? new Set<string>();
}

function validatePlatformToolsetKey(platform: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(platform);
}

export function getPlatformToolsets(profile?: string): Record<string, string[]> {
  const configFile = join(profileHome(profile), "config.yaml");
  if (!existsSync(configFile)) return {};
  try {
    const content = readFileSync(configFile, "utf-8");
    return Object.fromEntries(
      Object.entries(parsePlatformToolsets(content)).map(([platform, values]) => [
        platform,
        Array.from(values).sort(),
      ]),
    );
  } catch {
    return {};
  }
}

export function getToolsets(profile?: string): ToolsetInfo[] {
  const configFile = join(profileHome(profile), "config.yaml");

  // If no config, assume all toolsets are enabled (hermes default behavior)
  if (!existsSync(configFile)) {
    return localizeToolDefs(true);
  }

  try {
    const content = readFileSync(configFile, "utf-8");
    const enabledSet = parseEnabledToolsets(content);

    // If no platform_toolsets.cli section exists, all are enabled by default
    if (enabledSet.size === 0 && !content.includes("platform_toolsets")) {
      return localizeToolDefs(true);
    }

    return localizeToolDefs((key) => enabledSet.has(key));
  } catch {
    return localizeToolDefs(true);
  }
}

export function setToolsetEnabled(
  key: string,
  enabled: boolean,
  profile?: string,
): boolean {
  return setPlatformToolsetEnabled("cli", key, enabled, profile);
}

export function setMessagingPlatformToolsetEnabled(
  platform: string,
  key: string,
  enabled: boolean,
  profile?: string,
): boolean {
  return setPlatformToolsetEnabled(
    platform,
    key,
    enabled,
    profile,
    DEFAULT_MESSAGING_PLATFORM_TOOLSETS,
  );
}

function setPlatformToolsetEnabled(
  platform: string,
  key: string,
  enabled: boolean,
  profile?: string,
  defaultEnabled: string[] = [],
): boolean {
  const configFile = join(profileHome(profile), "config.yaml");
  if (!existsSync(configFile)) return false;
  if (!validatePlatformToolsetKey(platform) || !validatePlatformToolsetKey(key)) {
    return false;
  }

  try {
    const content = readFileSync(configFile, "utf-8");
    const parsed = parsePlatformToolsets(content);
    const hasPlatformConfig = Object.prototype.hasOwnProperty.call(parsed, platform);
    const currentEnabled = hasPlatformConfig
      ? new Set(parsed[platform])
      : new Set(defaultEnabled);

    if (enabled) {
      currentEnabled.add(key);
    } else {
      currentEnabled.delete(key);
    }

    // Rebuild the platform_toolsets.cli section
    const toolsetLines = Array.from(currentEnabled)
      .sort()
      .map((t) => `      - ${t}`)
      .join("\n");

    const newSection = `  ${platform}:\n${toolsetLines}`;
    const platformHeader = new RegExp(`^\\s+${platform}\\s*:`);

    // Check if platform_toolsets section exists
    if (content.includes("platform_toolsets")) {
      // Replace existing platform section within platform_toolsets
      const lines = content.split("\n");
      const result: string[] = [];
      let inPlatformToolsets = false;
      let inTargetPlatform = false;
      let platformInserted = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimEnd();

        if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
          inPlatformToolsets = true;
          result.push(line);
          continue;
        }

        if (inPlatformToolsets && platformHeader.test(trimmed)) {
          inTargetPlatform = true;
          // Output the new platform section
          result.push(newSection);
          platformInserted = true;
          continue;
        }

        if (inTargetPlatform) {
          // Skip old list items
          if (/^\s+-\s/.test(trimmed)) continue;
          // End of platform section
          if (
            /^\s{4}\S/.test(trimmed) ||
            /^\S/.test(trimmed) ||
            trimmed === ""
          ) {
            inTargetPlatform = false;
            if (
              trimmed === "" &&
              i + 1 < lines.length &&
              /^\S/.test(lines[i + 1].trimEnd())
            ) {
              result.push(line);
              continue;
            }
            result.push(line);
            continue;
          }
          continue;
        }

        if (inPlatformToolsets && /^\S/.test(trimmed) && trimmed !== "") {
          inPlatformToolsets = false;
          if (!platformInserted) {
            result.push(newSection);
            platformInserted = true;
          }
        }

        result.push(line);
      }

      // Trailing platform_toolsets (no next block) never triggers inline insertion
      if (inPlatformToolsets && !platformInserted) {
        result.push(newSection);
      }

      safeWriteFile(configFile, result.join("\n"));
    } else {
      // Append platform_toolsets section at end
      const newContent =
        content.trimEnd() + "\n\nplatform_toolsets:\n" + newSection + "\n";
      safeWriteFile(configFile, newContent);
    }

    return true;
  } catch {
    return false;
  }
}
