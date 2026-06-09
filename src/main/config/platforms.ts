import { readFileSync, existsSync } from "fs";
import { escapeRegex, profilePaths, safeWriteFile } from "../utils";
import { readEnv } from "./env-store";

// ── Platform enabled/disabled ─────────────────────────────
//
// The Python hermes gateway (gateway/config.py) decides which messaging
// platforms to start from env vars in .env; it doesn't look at a fictional
// `platforms:` YAML section. config.yaml only carries an override-disable
// switch: `<platform>.enabled: false` at the top level. Earlier the desktop
// read and wrote a `platforms:\n  <name>:\n    enabled: …` block that the
// gateway never inspected, so the Gateway UI's toggles were cosmetic.
//
// `envCheck` returns true when the platform's required env vars are present
// (and, for whatsapp, set to a truthy literal). Add new platforms here as
// their Python-side activation rules are confirmed.
interface PlatformRule {
  envCheck: (env: Record<string, string>) => boolean;
  // YAML key for the override-disable lookup. Defaults to the platform key
  // itself; provide an explicit value when the desktop's display key
  // diverges from the Python CLI's config.yaml key (e.g. "home_assistant"
  // in the desktop vs "homeassistant" in the Python gateway).
  configKey?: string;
}

const TRUTHY_VALUES = new Set(["true", "1", "yes", "on"]);

const PLATFORM_RULES: Record<string, PlatformRule> = {
  telegram: { envCheck: (e) => !!e.TELEGRAM_BOT_TOKEN?.trim() },
  discord: { envCheck: (e) => !!e.DISCORD_BOT_TOKEN?.trim() },
  slack: { envCheck: (e) => !!e.SLACK_BOT_TOKEN?.trim() },
  whatsapp: {
    envCheck: (e) =>
      TRUTHY_VALUES.has((e.WHATSAPP_ENABLED || "").trim().toLowerCase()),
  },
  signal: {
    envCheck: (e) => !!e.SIGNAL_HTTP_URL?.trim() && !!e.SIGNAL_ACCOUNT?.trim(),
  },
  matrix: {
    envCheck: (e) =>
      !!e.MATRIX_ACCESS_TOKEN?.trim() || !!e.MATRIX_PASSWORD?.trim(),
  },
  mattermost: { envCheck: (e) => !!e.MATTERMOST_TOKEN?.trim() },
  home_assistant: {
    envCheck: (e) => !!e.HASS_TOKEN?.trim(),
    configKey: "homeassistant",
  },
};

const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_RULES);

/**
 * Match a top-level YAML block's `enabled: <bool>` field, e.g.:
 *
 *     telegram:
 *       reactions: false
 *       enabled: false      ← captured
 *       allowed_chats: ''
 *
 * Returns true/false if found, null if absent. The block must start at
 * column 0; `enabled:` is captured if it sits anywhere inside the
 * contiguous indented sub-block (any depth, in any position).
 */
function readPlatformOverride(
  content: string,
  platform: string,
): boolean | null {
  const blockStartRe = new RegExp(
    `^${escapeRegex(platform)}:[ \\t]*\\r?\\n`,
    "m",
  );
  const startMatch = content.match(blockStartRe);
  if (!startMatch || startMatch.index === undefined) return null;

  const after = content.slice(startMatch.index + startMatch[0].length);
  const lines = after.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) break; // hit next top-level key
    const m = line.match(/^[ \t]+enabled:[ \t]*(true|false)\b/);
    if (m) return m[1] === "true";
  }
  return null;
}

export function getPlatformEnabled(profile?: string): Record<string, boolean> {
  const env = readEnv(profile);
  const { configFile } = profilePaths(profile);
  const content = existsSync(configFile)
    ? readFileSync(configFile, "utf-8")
    : "";

  const result: Record<string, boolean> = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    const rule = PLATFORM_RULES[platform];
    const envEnabled = rule.envCheck(env);
    const configKey = rule.configKey || platform;
    const override = content ? readPlatformOverride(content, configKey) : null;
    // Python's rule: env-driven activation, config.yaml `enabled: false`
    // can force-disable. An explicit `enabled: true` doesn't bypass a
    // missing token (the Python gateway still requires the credential),
    // so reflect that here too.
    result[platform] = envEnabled && override !== false;
  }
  return result;
}

/**
 * Toggle a platform's force-disable override in config.yaml.
 *
 * The Python gateway activates a platform when its env vars are set;
 * config can force-disable with `<platform>.enabled: false` at the top
 * level. So toggling here writes/removes that single key:
 *
 *   - enabled=false → ensure `enabled: false` exists in the top-level
 *     `<platform>:` block (modify in place, append a child, or create
 *     the block).
 *   - enabled=true  → remove any existing `enabled: false` line.
 *
 * Filling in the platform's token env vars is what actually starts it;
 * this function only manages the disable override.
 */
export function setPlatformEnabled(
  platform: string,
  enabled: boolean,
  profile?: string,
): void {
  const rule = PLATFORM_RULES[platform];
  if (!rule) return;
  // Use the Python-side YAML key when writing the override, not the
  // desktop's display key (matters for home_assistant → homeassistant).
  const configKey = rule.configKey || platform;

  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) {
    // Only need to write a file when we're recording a disable override;
    // enabling a platform that has no config is the default.
    if (enabled) return;
    safeWriteFile(configFile, `${configKey}:\n  enabled: false\n`);
    return;
  }

  let content = readFileSync(configFile, "utf-8");
  const enabledLineRe = new RegExp(
    `^([ \\t]+enabled:[ \\t]*)(true|false)\\b([ \\t]*)$`,
    "m",
  );
  const blockStartRe = new RegExp(
    `^(${escapeRegex(configKey)}:[ \\t]*\\r?\\n)`,
    "m",
  );
  const flowStyleRe = new RegExp(
    `^${escapeRegex(configKey)}:[ \\t]*\\{\\s*\\}[ \\t]*$`,
    "m",
  );

  const blockMatch = content.match(blockStartRe);
  const hasBlock = !!blockMatch;
  const isFlowEmpty = flowStyleRe.test(content);

  if (isFlowEmpty) {
    // Convert `<platform>: {}` to a block we can edit.
    content = content.replace(
      flowStyleRe,
      `${configKey}:\n  enabled: ${enabled}`,
    );
    safeWriteFile(configFile, content);
    return;
  }

  if (hasBlock && blockMatch?.index !== undefined) {
    const blockStart = blockMatch.index + blockMatch[0].length;
    const rest = content.slice(blockStart);
    const restLines = rest.split(/\r?\n/);

    // Find the extent of the platform's sub-block (indented children).
    let subBlockEndOffset = 0;
    let existingEnabledLineStart: number | null = null;
    let existingEnabledLineEnd: number | null = null;
    for (const line of restLines) {
      const lineLen = line.length + 1; // include trailing \n
      if (line.trim() === "") {
        subBlockEndOffset += lineLen;
        continue;
      }
      if (!/^\s/.test(line)) break;
      const localStart = blockStart + subBlockEndOffset;
      const enabledMatch = line.match(enabledLineRe);
      if (enabledMatch) {
        existingEnabledLineStart = localStart;
        existingEnabledLineEnd = localStart + line.length;
      }
      subBlockEndOffset += lineLen;
    }

    if (existingEnabledLineStart !== null && existingEnabledLineEnd !== null) {
      if (enabled) {
        // Remove the entire `  enabled: false` line, including its newline.
        const removeEnd =
          content[existingEnabledLineEnd] === "\n"
            ? existingEnabledLineEnd + 1
            : existingEnabledLineEnd;
        content =
          content.slice(0, existingEnabledLineStart) + content.slice(removeEnd);
      } else {
        content =
          content.slice(0, existingEnabledLineStart) +
          `  enabled: false` +
          content.slice(existingEnabledLineEnd);
      }
    } else if (!enabled) {
      // Append `enabled: false` as the first child of the block.
      content =
        content.slice(0, blockStart) +
        `  enabled: false\n` +
        content.slice(blockStart);
    }
    // (enabled=true with no existing override: nothing to do.)

    safeWriteFile(configFile, content);
    return;
  }

  // No block at all — only need to materialize one when recording a disable.
  if (!enabled) {
    const trailingNewline = content.endsWith("\n") ? "" : "\n";
    content += `${trailingNewline}${configKey}:\n  enabled: false\n`;
    safeWriteFile(configFile, content);
  }
}
