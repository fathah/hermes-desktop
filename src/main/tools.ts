import { existsSync, readFileSync, copyFileSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";

/** The read/info-only toolset scope for the Telegram platform: research + info,
 *  with NO machine mutation. Excludes terminal, file, computer_use,
 *  code_execution, cronjob, messaging, obsidian, kanban, skills, todo, etc.
 *  (Telegram's default `hermes-telegram` preset DOES include terminal + file,
 *  which is why scoping is the security core of remote control.) */
export const READ_INFO_TELEGRAM_TOOLSETS = [
  "web",
  "x_search",
  "browser",
  "vision",
  "memory",
  "session_search",
  "clarify",
];

const MUTATING_TOOLSETS = new Set([
  "terminal",
  "file",
  "computer_use",
  "code_execution",
  "cronjob",
  "obsidian",
  "kanban",
  "delegation",
  "moa",
]);

/** Upsert a `platform_toolsets.<platform>: [list]` block into config.yaml text,
 *  preserving all other content/comments. Pure + testable. Handles: no
 *  platform_toolsets section (append), block-form sub-key (replace items),
 *  inline-form sub-key `telegram: [hermes-telegram]` (rewrite as a block), and
 *  absent sub-key (insert). */
export function upsertPlatformToolsets(
  content: string,
  platform: string,
  toolsets: string[],
): string {
  const itemLines = toolsets.map((name) => `      - ${name}`);
  const lines = content.split("\n");
  const ptIdx = lines.findIndex((l) => /^platform_toolsets\s*:\s*$/.test(l));
  if (ptIdx < 0) {
    return (
      content.replace(/\s*$/, "") +
      `\n\nplatform_toolsets:\n  ${platform}:\n${itemLines.join("\n")}\n`
    );
  }
  // Extent of the platform_toolsets block: indented/blank lines until the next
  // top-level (column-0, non-blank) key.
  let blockEnd = ptIdx + 1;
  while (
    blockEnd < lines.length &&
    (lines[blockEnd] === "" || /^\s/.test(lines[blockEnd]))
  ) {
    blockEnd++;
  }
  const subRe = new RegExp(`^  ${platform}\\s*:`);
  let subIdx = -1;
  for (let i = ptIdx + 1; i < blockEnd; i++) {
    if (subRe.test(lines[i])) {
      subIdx = i;
      break;
    }
  }
  if (subIdx >= 0) {
    const inline = /:\s*\S/.test(lines[subIdx]); // `telegram: [..]` on one line
    if (inline) {
      lines.splice(subIdx, 1, `  ${platform}:`, ...itemLines);
    } else {
      let e = subIdx + 1;
      while (e < blockEnd && /^\s{4,}-\s/.test(lines[e])) e++;
      lines.splice(subIdx + 1, e - (subIdx + 1), ...itemLines);
    }
    return lines.join("\n");
  }
  lines.splice(ptIdx + 1, 0, `  ${platform}:`, ...itemLines);
  return lines.join("\n");
}

/** Read the configured toolset list for a platform from config.yaml text, or
 *  null if not explicitly set (→ gateway uses the platform default). Pure. */
export function readPlatformToolsets(
  content: string,
  platform: string,
): string[] | null {
  const lines = content.split("\n");
  const ptIdx = lines.findIndex((l) => /^platform_toolsets\s*:\s*$/.test(l));
  if (ptIdx < 0) return null;
  let blockEnd = ptIdx + 1;
  while (
    blockEnd < lines.length &&
    (lines[blockEnd] === "" || /^\s/.test(lines[blockEnd]))
  ) {
    blockEnd++;
  }
  const subRe = new RegExp(`^  ${platform}\\s*:\\s*(.*)$`);
  for (let i = ptIdx + 1; i < blockEnd; i++) {
    const m = subRe.exec(lines[i]);
    if (!m) continue;
    const inline = m[1].trim();
    if (inline.startsWith("[")) {
      return inline
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const items: string[] = [];
    for (let j = i + 1; j < blockEnd && /^\s{4,}-\s/.test(lines[j]); j++) {
      items.push(lines[j].replace(/^\s*-\s*/, "").trim());
    }
    return items;
  }
  return null;
}

export type TelegramScope = "read-info" | "broad" | "custom";

/** Classify the current Telegram capability scope from config. "broad" = the
 *  agent can mutate the machine (default preset or a mutating toolset present). */
export function getTelegramScope(profile?: string): TelegramScope {
  const configFile = join(profileHome(profile), "config.yaml");
  if (!existsSync(configFile)) return "broad";
  let content = "";
  try {
    content = readFileSync(configFile, "utf-8");
  } catch {
    return "broad";
  }
  const list = readPlatformToolsets(content, "telegram");
  if (!list || list.length === 0) return "broad"; // default = hermes-telegram (has terminal+file)
  // A preset like "hermes-telegram" means broad.
  if (list.some((ts) => ts.startsWith("hermes-"))) return "broad";
  if (list.some((ts) => MUTATING_TOOLSETS.has(ts))) return "broad";
  const set = new Set(list);
  const isReadInfo =
    list.length === READ_INFO_TELEGRAM_TOOLSETS.length &&
    READ_INFO_TELEGRAM_TOOLSETS.every((ts) => set.has(ts));
  return isReadInfo ? "read-info" : "custom";
}

/** Apply the read/info-only scope to the Telegram platform. Backs up config.yaml
 *  first (the change touches a load-bearing file). Returns success. */
export function setTelegramReadInfoScope(profile?: string): boolean {
  const configFile = join(profileHome(profile), "config.yaml");
  if (!existsSync(configFile)) return false;
  try {
    const content = readFileSync(configFile, "utf-8");
    try {
      copyFileSync(configFile, `${configFile}.bak.telegram-scope`);
    } catch {
      /* best-effort backup */
    }
    const next = upsertPlatformToolsets(
      content,
      "telegram",
      READ_INFO_TELEGRAM_TOOLSETS,
    );
    safeWriteFile(configFile, next);
    return true;
  } catch {
    return false;
  }
}

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
    key: "obsidian",
    labelKey: "tools.obsidian.label",
    descriptionKey: "tools.obsidian.description",
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

      // Trailing platform_toolsets (no next block) never triggers inline insertion
      if (inPlatformToolsets && !cliInserted) {
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
