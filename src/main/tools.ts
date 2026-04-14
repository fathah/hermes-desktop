import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";

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
 * Parse the platform_toolsets.cli list from config.yaml.
 * The yaml structure looks like:
 *   platform_toolsets:
 *     cli:
 *       - web
 *       - browser
 *       ...
 * We use line-by-line parsing to stay consistent with config.ts (no yaml dep).
 */
function parseEnabledToolsets(configContent: string): Set<string> {
  const enabled = new Set<string>();
  const lines = configContent.split("\n");

  let inPlatformToolsets = false;
  let inCli = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Detect section headers
    if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
      inPlatformToolsets = true;
      inCli = false;
      continue;
    }

    if (inPlatformToolsets && /^\s+cli\s*:/.test(trimmed)) {
      inCli = true;
      continue;
    }

    // Exit sections on un-indent
    if (inPlatformToolsets && /^\S/.test(trimmed) && !/^\s*$/.test(trimmed)) {
      inPlatformToolsets = false;
      inCli = false;
      continue;
    }

    if (inCli && /^\s{4}\S/.test(trimmed) && !/^\s{4,}-/.test(trimmed)) {
      // A new key at the same level as cli — we've left the cli section
      inCli = false;
      continue;
    }

    // Parse list items inside cli:
    if (inCli) {
      const match = trimmed.match(/^\s+-\s+["']?(\w+)["']?/);
      if (match) {
        enabled.add(match[1]);
      }
    }
  }

  return enabled;
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
  const configFile = join(profileHome(profile), "config.yaml");
  if (!existsSync(configFile)) return false;

  try {
    const content = readFileSync(configFile, "utf-8");
    const currentEnabled = parseEnabledToolsets(content);

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

    const newSection = `  cli:\n${toolsetLines}`;

    // Check if platform_toolsets section exists
    if (content.includes("platform_toolsets")) {
      // Replace existing cli section within platform_toolsets
      const lines = content.split("\n");
      const result: string[] = [];
      let inPlatformToolsets = false;
      let inCli = false;
      let cliInserted = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimEnd();

        if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
          inPlatformToolsets = true;
          result.push(line);
          continue;
        }

        if (inPlatformToolsets && /^\s+cli\s*:/.test(trimmed)) {
          inCli = true;
          // Output the new cli section
          result.push(newSection);
          cliInserted = true;
          continue;
        }

        if (inCli) {
          // Skip old list items
          if (/^\s+-\s/.test(trimmed)) continue;
          // End of cli section
          if (
            /^\s{4}\S/.test(trimmed) ||
            /^\S/.test(trimmed) ||
            trimmed === ""
          ) {
            inCli = false;
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
          if (!cliInserted) {
            result.push(newSection);
            cliInserted = true;
          }
        }

        result.push(line);
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
