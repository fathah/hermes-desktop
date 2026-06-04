import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import { HERMES_HOME, expectedEnvKeyForModel } from "./installer";
import {
  escapeRegex,
  getActiveProfileNameSync,
  profileHome,
  profilePaths,
  safeWriteFile,
} from "./utils";
import { getYamlPath } from "./yaml-path";
import { canonicalProviderBaseUrl } from "./provider-registry";
import {
  expectedEnvKeyForUrl,
  OPENAI_COMPAT_PROVIDERS,
} from "../shared/url-key-map";

// ── Connection Config (local / remote / ssh) ─────────────

export interface SshConnectionConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  remotePort: number;
  localPort: number;
}

export interface ConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  apiKey: string;
  ssh: SshConnectionConfig;
}

export interface PublicConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  hasApiKey: boolean;
  // Length of the stored API key, exposed so the renderer can show a
  // mask that matches the real value's width. The secret itself never
  // leaves the main process. 0 when no key is set.
  apiKeyLength: number;
  ssh: SshConnectionConfig;
}

// Lazy getter — avoids circular dependency with installer.ts
// (HERMES_HOME may not be assigned yet when this module first loads)
function desktopConfigFile(): string {
  return join(HERMES_HOME, "desktop.json");
}

export function readDesktopConfig(): Record<string, unknown> {
  try {
    const f = desktopConfigFile();
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf-8"));
  } catch {
    return {};
  }
}

export function writeDesktopConfig(data: Record<string, unknown>): void {
  if (!existsSync(HERMES_HOME)) {
    mkdirSync(HERMES_HOME, { recursive: true });
  }
  writeFileSync(desktopConfigFile(), JSON.stringify(data, null, 2), "utf-8");
}

export function getConnectionConfig(): ConnectionConfig {
  const data = readDesktopConfig();
  const ssh = (data.sshConfig as Partial<SshConnectionConfig>) ?? {};
  return {
    mode: (data.connectionMode as "local" | "remote" | "ssh") || "local",
    remoteUrl: (data.remoteUrl as string) || "",
    apiKey: (data.remoteApiKey as string) || "",
    ssh: {
      host: (ssh.host as string) || "",
      port: (ssh.port as number) || 22,
      username: (ssh.username as string) || "",
      keyPath: (ssh.keyPath as string) || "",
      remotePort: (ssh.remotePort as number) || 8642,
      localPort: (ssh.localPort as number) || 18642,
    },
  };
}

export function getPublicConnectionConfig(): PublicConnectionConfig {
  const config = getConnectionConfig();
  return {
    mode: config.mode,
    remoteUrl: config.remoteUrl,
    hasApiKey: config.apiKey.length > 0,
    apiKeyLength: config.apiKey.length,
    ssh: config.ssh,
  };
}

export function setConnectionConfig(config: ConnectionConfig): void {
  const data = readDesktopConfig();
  data.connectionMode = config.mode;
  data.remoteUrl = config.remoteUrl;
  data.remoteApiKey = config.apiKey;
  if (config.mode === "ssh") {
    data.sshConfig = config.ssh;
  }
  writeDesktopConfig(data);
}

export function resolveConnectionApiKeyUpdate(
  existing: ConnectionConfig,
  mode: "local" | "remote" | "ssh",
  remoteUrl: string,
  apiKey?: string,
): string {
  if (apiKey !== undefined) return apiKey;
  if (existing.mode === mode && existing.remoteUrl === remoteUrl) {
    return existing.apiKey;
  }
  return "";
}

// ── In-memory cache with TTL ─────────────────────────────
const CACHE_TTL = 5000; // 5 seconds
const _cache = new Map<string, { data: unknown; ts: number }>();
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function getCached<T>(key: string): T | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  _cache.set(key, { data, ts: Date.now() });
}

function invalidateCache(prefix: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

export function readEnv(profile?: string): Record<string, string> {
  const cacheKey = `env:${profile || "default"}`;
  const cached = getCached<Record<string, string>>(cacheKey);
  if (cached) return cached;

  const { envFile } = profilePaths(profile);
  if (!existsSync(envFile)) return {};

  const content = readFileSync(envFile, "utf-8");
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const eqIndex = trimmed.indexOf("=");
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  setCache(cacheKey, result);
  return result;
}

export function setEnvValue(
  key: string,
  value: string,
  profile?: string,
): void {
  validateEnvEntry(key, value);

  const { envFile } = profilePaths(profile);
  invalidateCache(`env:${profile || "default"}`);
  if (key === "API_SERVER_KEY") invalidateCache("apiServerKey:");

  if (!existsSync(envFile)) {
    safeWriteFile(envFile, `${key}=${value}\n`);
    return;
  }

  const content = readFileSync(envFile, "utf-8");
  const lines = content.split("\n");
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.match(new RegExp(`^#?\\s*${escapeRegex(key)}\\s*=`))) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(`${key}=${value}`);
  }

  safeWriteFile(envFile, lines.join("\n"));
}

export function validateEnvEntry(key: string, value: string): void {
  if (!ENV_KEY_RE.test(key)) {
    throw new Error(
      "Invalid environment variable name. Use letters, numbers, and underscores, and do not start with a number.",
    );
  }

  if (/[\0\r\n]/.test(value)) {
    throw new Error("Environment variable values must be single-line strings.");
  }
}

function stripYamlQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function quoteYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function appendDirectNestedYamlValue(
  content: string,
  segments: string[],
  value: string,
): string | null {
  if (segments.length !== 2) return null;
  const [parent, child] = segments;
  if (!parent || !child) return null;

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const quotedValue = quoteYamlScalar(value);
  const parentRe = new RegExp(
    `^${escapeRegex(parent)}:[ \\t]*(#.*)?(?:\\r?\\n|$)`,
    "m",
  );
  const parentMatch = parentRe.exec(content);

  if (!parentMatch || parentMatch.index === undefined) {
    const sep = content === "" || content.endsWith("\n") ? "" : newline;
    return `${content}${sep}${parent}:${newline}  ${child}: ${quotedValue}${newline}`;
  }

  const blockStart = parentMatch.index + parentMatch[0].length;
  let blockEnd = blockStart;
  let cursor = blockStart;

  while (cursor < content.length) {
    const lineEnd = content.indexOf("\n", cursor);
    const lineEndExclusive = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(cursor, lineEndExclusive);

    if (line.trim() !== "" && !/^[ \t]/.test(line)) {
      break;
    }

    blockEnd =
      lineEndExclusive === content.length
        ? content.length
        : lineEndExclusive + 1;
    cursor = blockEnd;
  }

  const insertion = `  ${child}: ${quotedValue}${newline}`;
  return `${content.slice(0, blockEnd)}${insertion}${content.slice(blockEnd)}`;
}

/**
 * Locate a dotted YAML path in `content` (e.g. "agent.service_tier" finds
 * the `service_tier` field nested under top-level `agent:`). Returns the
 * value plus the substring offsets a writer can splice over, or null
 * when any segment of the path is missing.
 *
 * Why this exists: the renderer passes dotted paths like
 * `agent.service_tier`, `memory.provider`, `network.force_ipv4` through
 * `getConfig`/`setConfig`. The old implementation used the key string as
 * a literal regex fragment, so it looked for a flat line spelled exactly
 * `agent.service_tier:` — which never exists in real YAML and silently
 * returned null. Flat keys also leaked across blocks (a `service_tier`
 * under `telegram:` could shadow `agent.service_tier`). See issue #247.
 *
 * Each segment must appear at strictly-greater indent than its parent's
 * line. Segments without dots are treated as 1-segment paths and pinned
 * to the top level (column-0 keys only) — so a flat `provider` no longer
 * matches `model.provider` or `auxiliary.vision.provider` by accident.
 *
 * Returns the first match in document order at each level; later
 * duplicates at the same level are ignored, matching YAML semantics for
 * mappings.
 */
interface YamlPathHit {
  value: string;
  /** Absolute offset where the writer should splice the new value. */
  valueStart: number;
  /** Absolute offset just past the substring the writer should replace.
   *  Excludes any trailing comment so we don't clobber `# notes`. */
  valueEnd: number;
}

function findYamlPath(content: string, dottedPath: string): YamlPathHit | null {
  const segments = dottedPath.split(".").filter(Boolean);
  if (segments.length === 0) return null;

  let cursor = 0;
  let parentIndent = -1;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    const found = findSegmentInBlock(content, cursor, parentIndent, segment);
    if (!found) return null;

    if (isLast) {
      return {
        value: stripYamlQuotes(found.rawValue),
        valueStart: found.valueStart,
        valueEnd: found.valueEnd,
      };
    }

    // Descend: subsequent search continues after the segment's header
    // line, bounded by indent > parentIndent.
    cursor = found.afterLine;
    parentIndent = found.indent;
  }

  return null;
}

interface SegmentMatch {
  /** Indent length of the matched line. */
  indent: number;
  /** Raw value substring (between the colon's gap and any trailing comment). */
  rawValue: string;
  valueStart: number;
  valueEnd: number;
  /** Absolute offset of the byte just past the matched line's newline. */
  afterLine: number;
}

function findSegmentInBlock(
  content: string,
  startAt: number,
  parentIndent: number,
  segment: string,
): SegmentMatch | null {
  // Walk lines from startAt until we leave the parent's block (a line
  // with indent <= parentIndent). Within the block, return the first
  // line whose key matches `segment` at the *minimum* indent > parent's
  // — which is the depth of direct children.
  const escapedSegment = escapeRegex(segment);
  let directChildIndent: number | null = null;
  let cursor = startAt;

  while (cursor < content.length) {
    const lineEnd = content.indexOf("\n", cursor);
    const lineEndExclusive = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(cursor, lineEndExclusive);
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      cursor =
        lineEndExclusive === content.length
          ? content.length
          : lineEndExclusive + 1;
      continue;
    }

    const indent = line.length - line.trimStart().length;

    // Block boundary: a non-blank line at or shallower than the parent
    // closes the parent's block.
    if (indent <= parentIndent) return null;

    // First non-blank child sets the canonical "direct child" indent for
    // this block. Deeper-nested lines (grandchildren) are walked past
    // without being treated as siblings of `segment`.
    if (directChildIndent === null) directChildIndent = indent;

    if (indent === directChildIndent) {
      // `[ \t]*` (zero-or-more) so this works at column 0 too — the
      // first segment of a dotted path is a top-level key with no
      // leading whitespace. The `indent === directChildIndent` gate
      // above already enforces depth.
      const m = line.match(
        new RegExp(
          `^([ \\t]*)(${escapedSegment}):([ \\t]*)([^\\n#]*?)([ \\t]*)(#.*)?$`,
        ),
      );
      if (m) {
        const indentStr = m[1];
        const gapBeforeValue = m[3];
        const rawValue = m[4];
        const keyEnd = cursor + indentStr.length + segment.length + 1; // past `:`
        const valueStart = keyEnd + gapBeforeValue.length;
        const valueEnd = valueStart + rawValue.length;
        return {
          indent: indentStr.length,
          rawValue,
          valueStart,
          valueEnd,
          afterLine:
            lineEndExclusive === content.length
              ? content.length
              : lineEndExclusive + 1,
        };
      }
    }

    cursor =
      lineEndExclusive === content.length
        ? content.length
        : lineEndExclusive + 1;
  }

  return null;
}

/**
 * Read a top-level key at column 0 (no indent). Used when a caller
 * passes a single-segment "path" — we don't want it to silently match
 * a nested occurrence with the same name.
 */
function findTopLevelKey(content: string, key: string): YamlPathHit | null {
  const re = new RegExp(
    `^(${escapeRegex(key)}):([ \\t]*)([^\\n#]*?)([ \\t]*)(#.*)?$`,
    "m",
  );
  const m = content.match(re);
  if (!m || m.index === undefined) return null;
  const gap = m[2];
  const rawValue = m[3];
  const lineStart = m.index;
  const valueStart = lineStart + key.length + 1 + gap.length; // past `:` and gap
  const valueEnd = valueStart + rawValue.length;
  return {
    value: stripYamlQuotes(rawValue),
    valueStart,
    valueEnd,
  };
}

export function getConfigValue(key: string, profile?: string): string | null {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return null;

  const content = readFileSync(configFile, "utf-8");
  // Use the indentation-aware reader so dotted keys like `memory.provider`,
  // `network.force_ipv4`, `agent.service_tier` resolve correctly. The old
  // regex matched only literal `dotted.key:` lines which don't exist in
  // YAML, so nested lookups silently returned null and the UI rendered
  // every memory provider as inactive, every nested toggle as default, etc.
  return getYamlPath(content, key);
}

export function setConfigValue(
  key: string,
  value: string,
  profile?: string,
): void {
  // Invalidate the apiServerKey cache when either of the two canonical
  // gateway-secret locations is written: the legacy top-level
  // `API_SERVER_KEY` *or* the hermes-agent canonical `api_server.token`
  // path. Without the second check, editing `api_server.token` via the
  // desktop would leave the cached value stale for up to the 5s TTL.
  if (
    key === "API_SERVER_KEY" ||
    key === "api_server.token" ||
    key.startsWith("api_server.")
  ) {
    invalidateCache("apiServerKey:");
  }
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;

  let content = readFileSync(configFile, "utf-8");
  const segments = key.split(".").filter(Boolean);
  if (segments.length === 0) return;

  const hit =
    segments.length === 1
      ? findTopLevelKey(content, segments[0])
      : findYamlPath(content, key);

  // Existing key → in-place replace, preserving surrounding whitespace
  // and any trailing comment.
  if (hit) {
    content =
      content.slice(0, hit.valueStart) +
      quoteYamlScalar(value) +
      content.slice(hit.valueEnd);
    safeWriteFile(configFile, content);
    return;
  }

  // Key missing. Top-level single keys are safe to append. Direct
  // two-segment scalar paths are also safe to create/append and are used
  // by Settings fields such as `network.proxy`. Deeper paths remain a
  // no-op to avoid guessing inside complex user-edited YAML.
  if (segments.length === 1) {
    const sep = content.endsWith("\n") || content === "" ? "" : "\n";
    content = `${content}${sep}${key}: ${quoteYamlScalar(value)}\n`;
    safeWriteFile(configFile, content);
    return;
  }

  const nextContent = appendDirectNestedYamlValue(content, segments, value);
  if (nextContent !== null) {
    safeWriteFile(configFile, nextContent);
  }
}

/**
 * Locate the direct children of a top-level YAML block. Each child is
 * keyed by name and carries the substring offsets needed to read or
 * rewrite its value in-place.
 *
 * Why this exists: the model-field readers/writers used to run loose
 * regexes like `^\s*default:` against the whole file, which match any
 * `default:` at any indent — so a `personalities.default` description
 * would be picked up as the model name (issue #242), and toggling the
 * model in the UI would overwrite that personality string instead of
 * `model.default`. Scoping reads and writes to a named top-level block
 * fixes both directions.
 *
 * Direct (sibling) children only: keys nested deeper than one indent
 * under the block are ignored. The block ends at the first non-indented,
 * non-empty line — the next top-level key. Anchored block-header search
 * means a `model:` later in some other context (e.g. a YAML string
 * literal, or nested under another block) won't be mistaken for the
 * top-level `model:` we want.
 */
interface BlockChild {
  key: string;
  /** Parsed value, with surrounding single/double quotes stripped. */
  value: string;
  /** Indent string of this child's line (e.g. "  "). */
  indent: string;
  /** Absolute offset of the substring after `key: ` and any leading
   *  whitespace — where a writer should splice the new value. */
  valueStart: number;
  /** Absolute offset just past the substring the writer should replace
   *  (excludes any trailing comment so we don't clobber `# notes`). */
  valueEnd: number;
}

function readTopLevelBlock(
  content: string,
  blockName: string,
): {
  children: Map<string, BlockChild>;
  blockBodyStart: number | null;
  childIndent: string;
} {
  const startRe = new RegExp(`^${escapeRegex(blockName)}:[ \\t]*\\r?\\n`, "m");
  const start = content.match(startRe);
  if (!start || start.index === undefined) {
    return { children: new Map(), blockBodyStart: null, childIndent: "  " };
  }

  const blockBodyStart = start.index + start[0].length;
  const children = new Map<string, BlockChild>();
  let firstChildIndent: string | null = null;
  let cursor = blockBodyStart;

  while (cursor < content.length) {
    const lineEnd = content.indexOf("\n", cursor);
    const lineEndExclusive = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(cursor, lineEndExclusive);

    // Stop at a non-indented, non-empty line (= next top-level key).
    if (line.trim() !== "" && !/^\s/.test(line)) break;

    const m = line.match(
      /^([ \t]+)([A-Za-z_][A-Za-z0-9_-]*):([ \t]*)([^\n#]*?)([ \t]*)(#.*)?$/,
    );
    if (m) {
      const indent = m[1];
      const key = m[2];
      const gapBeforeValue = m[3];
      const rawValue = m[4];
      const trailingWhitespace = m[5];
      void trailingWhitespace; // not used for replacement boundaries

      // First child encountered sets the canonical indent. Anything more
      // indented is a nested child (skip); anything less is malformed.
      if (firstChildIndent === null) firstChildIndent = indent;
      if (indent === firstChildIndent && !children.has(key)) {
        const keyEnd = cursor + indent.length + key.length + 1; // past `:`
        const valueStart = keyEnd + gapBeforeValue.length;
        const valueEnd = valueStart + rawValue.length;
        children.set(key, {
          key,
          value: stripYamlQuotes(rawValue),
          indent,
          valueStart,
          valueEnd,
        });
      }
    }

    cursor =
      lineEndExclusive === content.length
        ? content.length
        : lineEndExclusive + 1;
  }

  return {
    children,
    blockBodyStart,
    childIndent: firstChildIndent ?? "  ",
  };
}

export function getModelConfig(profile?: string): {
  provider: string;
  model: string;
  baseUrl: string;
} {
  const cacheKey = `mc:${profile || "default"}`;
  const cached = getCached<{
    provider: string;
    model: string;
    baseUrl: string;
  }>(cacheKey);
  if (cached) return cached;

  const { configFile } = profilePaths(profile);
  const defaults = { provider: "auto", model: "", baseUrl: "" };
  if (!existsSync(configFile)) return defaults;

  const content = readFileSync(configFile, "utf-8");
  const { children } = readTopLevelBlock(content, "model");

  const result = {
    provider: children.get("provider")?.value || defaults.provider,
    model: children.get("default")?.value || defaults.model,
    baseUrl: children.get("base_url")?.value || defaults.baseUrl,
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Mirror of the runtime key-resolution fallback for OpenAI-compatible /
 * custom endpoints (see `sendMessageViaCli` in hermes.ts): the gateway tries
 * the URL-specific key, then `CUSTOM_API_KEY`, then `OPENAI_API_KEY`. Returns
 * true when any link in that chain is populated for `profile`.
 *
 * Why it exists: the pre-send readiness check and the config-health audit
 * derive a single expected key from the base URL (e.g. a Groq URL →
 * `GROQ_API_KEY`). But a user on the "OpenAI Compatible" provider pointed at
 * Groq legitimately authenticates with `OPENAI_API_KEY` — the runtime falls
 * back to it — so demanding `GROQ_API_KEY` is a false positive (the chat
 * actually works). This lets those checks accept the same keys the gateway
 * does. Returns false for providers the runtime does NOT route through the
 * custom path, so their specific-key checks still apply.
 *
 * (The runtime also consults a per-model `CUSTOM_PROVIDER_<name>_KEY` ahead of
 * the generic keys; that lookup needs models.json and is intentionally omitted
 * here to keep config.ts free of a models.ts import — the generic chain covers
 * the reported cases.)
 */
export function customEndpointKeyResolvable(
  provider: string,
  baseUrl: string,
  profile?: string,
): boolean {
  const p = (provider || "").trim().toLowerCase();
  if (!baseUrl || !OPENAI_COMPAT_PROVIDERS.has(p)) return false;

  const env = readEnv(profile);
  const candidates = new Set<string>([
    expectedEnvKeyForUrl(baseUrl), // URL-specific key, or CUSTOM_API_KEY
    "CUSTOM_API_KEY",
    "OPENAI_API_KEY",
  ]);
  for (const k of candidates) {
    if ((env[k] ?? "").trim()) return true;
  }
  return false;
}

/**
 * Replace a direct child's value inside a top-level YAML block in-place,
 * preserving the key's surrounding whitespace and any trailing comment.
 * When the child doesn't exist, insert it as the first sibling at the
 * block's existing indent. When the block itself doesn't exist, append
 * one with the new key inside.
 */
export function upsertBlockChild(
  content: string,
  blockName: string,
  key: string,
  value: string,
): string {
  const { children, blockBodyStart, childIndent } = readTopLevelBlock(
    content,
    blockName,
  );

  const existing = children.get(key);
  if (existing) {
    return (
      content.slice(0, existing.valueStart) +
      `"${value}"` +
      content.slice(existing.valueEnd)
    );
  }

  if (blockBodyStart !== null) {
    const insertion = `${childIndent}${key}: "${value}"\n`;
    return (
      content.slice(0, blockBodyStart) +
      insertion +
      content.slice(blockBodyStart)
    );
  }

  // No block at all → append one. Match the existing file's trailing
  // newline conventions; if the file is empty (e.g. setModelConfig is
  // bootstrapping a fresh config.yaml) skip the separator so we don't
  // leave a stray leading blank line.
  const sep = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${sep}${blockName}:\n  ${key}: "${value}"\n`;
}

/**
 * Pick a value to write under model.api_key when the user configures a
 * provider="custom" entry pointing at a known commercial host (DeepSeek,
 * Groq, Mistral, etc.).
 *
 * Workaround for an upstream hermes-agent bug
 * (NousResearch/hermes-agent #?? — see fathah/hermes-desktop#260): the
 * gateway's ``_resolve_openrouter_runtime`` fallback chain reaches
 * ``OPENAI_API_KEY``/``OPENROUTER_API_KEY`` when a bare ``custom``
 * provider's credential pool is empty, which leaks unrelated keys to
 * non-OpenAI endpoints (manifesting as ``****ired`` / 401 from
 * api.deepseek.com).  Writing the matching env-var value to
 * ``model.api_key`` makes ``cfg_api_key`` win that chain before the
 * leak ever runs.
 *
 * Returns null when the provider/base_url combination doesn't match a
 * known commercial host or no env var is set — leaves the user's
 * config untouched for local LLMs (Ollama, vLLM, etc.).
 */
function pickAutoApiKeyForCustomProvider(
  provider: string,
  baseUrl: string,
  profile?: string,
): string | null {
  if (provider !== "custom" || !baseUrl) return null;
  const envKey = expectedEnvKeyForModel(provider, baseUrl);
  if (!envKey) return null;
  const env = readEnv(profile);
  const raw = env[envKey];
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  return trimmed || null;
}

/**
 * Locate the `model:` block in a YAML document and return the offsets that
 * bracket its body (children lines, not counting the `model:` header line).
 * Returns null when there's no `model:` block at all.
 *
 * The boundaries are needed to scope `api_key` add/update/remove operations
 * to the model block — every `auxiliary.*` subsection has its own
 * `api_key:` line, and a naive `/^api_key:/m` replace would clobber those
 * instead.
 */
function findModelBlockBody(
  content: string,
): { start: number; end: number } | null {
  const headerMatch = content.match(/^model:[^\S\r\n]*\r?\n/m);
  if (!headerMatch) return null;
  const start = headerMatch.index! + headerMatch[0].length;
  // The body runs until the next line that starts at column 0 (next
  // top-level key) or end of file.  Blank lines stay inside the block.
  const after = content.slice(start);
  const nextTopMatch = after.match(/^\S/m);
  const end = nextTopMatch ? start + nextTopMatch.index! : content.length;
  return { start, end };
}

export function setModelConfig(
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): void {
  invalidateCache(`mc:${profile || "default"}`);
  const { configFile } = profilePaths(profile);

  // Bootstrap an empty config.yaml when it's missing — previously this
  // function early-returned, so users on a custom HERMES_HOME where the
  // file hadn't been created (issue #228) had their model selection
  // silently dropped: the desktop appeared to save it but config.yaml
  // never got written, and the Python gateway saw an empty model and
  // returned 404s. `safeWriteFile` (used below) will create parent dirs
  // as needed; `upsertBlockChild` produces a valid minimal YAML doc
  // from an empty starting string.
  let content = existsSync(configFile) ? readFileSync(configFile, "utf-8") : "";

  content = upsertBlockChild(content, "model", "provider", provider);
  content = upsertBlockChild(content, "model", "default", model);

  // Pick the effective base_url to write.  Precedence:
  //   1. User-supplied `baseUrl` (the renderer passes this when the user
  //      typed an explicit value into the "Base URL (optional)" field).
  //   2. Otherwise, the canonical default for built-in providers
  //      (DeepSeek → api.deepseek.com, Groq → api.groq.com, etc. — see
  //      `provider-registry.ts`).
  //   3. Otherwise (custom / auto / unknown provider with no baseUrl),
  //      leave `base_url:` out of the model block entirely.
  //
  // Without (2), switching from a model with an explicit baseUrl (e.g.
  // a previous OAuth Codex selection at `chatgpt.com/backend-api/codex`)
  // to a built-in provider with no baseUrl in its library entry used to
  // leave the stale URL in `config.yaml`. Chat then routed to the wrong
  // host while still sending the new provider's key, producing a 401
  // from OpenAI carrying e.g. a DeepSeek key. See issue analysis in
  // PR description.
  const effectiveBaseUrl = baseUrl || canonicalProviderBaseUrl(provider) || "";
  if (effectiveBaseUrl) {
    content = upsertBlockChild(content, "model", "base_url", effectiveBaseUrl);
  }

  // Workaround for upstream gateway bug — see pickAutoApiKeyForCustomProvider.
  // Scope all api_key add/update/remove operations to the `model:` block —
  // `auxiliary.*` subsections each carry their own `api_key:` line and must
  // not be touched.
  const autoApiKey = pickAutoApiKeyForCustomProvider(
    provider,
    baseUrl,
    profile,
  );
  const body = findModelBlockBody(content);
  if (body) {
    const block = content.slice(body.start, body.end);
    const apiKeyInBlock = /^[ \t]+api_key:\s*.*\r?\n?/m;
    let newBlock = block;
    if (autoApiKey) {
      if (apiKeyInBlock.test(block)) {
        newBlock = block.replace(
          /^([ \t]+api_key:\s*).*$/m,
          `$1"${autoApiKey}"`,
        );
      } else {
        // Insert after base_url within the block, otherwise after provider.
        const eolMatch = block.match(/\r?\n/);
        const eol = eolMatch ? eolMatch[0] : "\n";
        const indentMatch = block.match(/^([ \t]+)\S/m);
        const indent = indentMatch ? indentMatch[1] : "  ";
        const apiKeyLine = `${indent}api_key: "${autoApiKey}"${eol}`;
        const afterBaseUrl = block.replace(
          /^([ \t]+base_url:\s*"[^"]*"\s*\r?\n)/m,
          `$1${apiKeyLine}`,
        );
        newBlock =
          afterBaseUrl !== block
            ? afterBaseUrl
            : block.replace(
                /^([ \t]+provider:\s*"[^"]*"\s*\r?\n)/m,
                `$1${apiKeyLine}`,
              );
        // Last-resort: if neither base_url nor provider lines were found
        // (config got hand-edited), prepend api_key to the block.
        if (newBlock === block) {
          newBlock = `${apiKeyLine}${block}`;
        }
      }
    } else if (apiKeyInBlock.test(block)) {
      newBlock = block.replace(apiKeyInBlock, "");
    }
    if (newBlock !== block) {
      content =
        content.slice(0, body.start) + newBlock + content.slice(body.end);
    }
  }

  // Disable smart_model_routing
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (
      /^\s*enabled:\s*(true|false)/.test(lines[i]) &&
      i > 0 &&
      /smart_model_routing/.test(lines[i - 1])
    ) {
      lines[i] = lines[i].replace(/(enabled:\s*)(true|false)/, "$1false");
    }
  }
  content = lines.join("\n");

  // Enable streaming
  const streamingRegex = /^(\s*streaming:\s*)(\S+)/m;
  if (streamingRegex.test(content)) {
    content = content.replace(streamingRegex, "$1true");
  }

  safeWriteFile(configFile, content);
}

export function getHermesHome(profile?: string): string {
  return profilePaths(profile).home;
}

/**
 * Resolve the API server's shared secret. Honoured by the local hermes
 * gateway (`api_server.token` in `config.yaml` / `API_SERVER_KEY` in
 * `.env`) when present; the desktop must include it as
 * `Authorization: Bearer …` on every chat request, otherwise the gateway
 * responds with "Invalid API key" / "Session continuation requires API
 * key authentication".
 *
 * Search order — explicit overrides first, canonical locations after:
 *
 *   1. Profile `config.yaml` top-level `API_SERVER_KEY` (legacy override)
 *   2. Default `config.yaml` top-level `API_SERVER_KEY` (legacy override)
 *   3. Profile `.env` `API_SERVER_KEY` (matches what the gateway reads)
 *   4. Default `.env` `API_SERVER_KEY`
 *   5. Profile `config.yaml` `api_server.token` (canonical hermes-agent
 *      gateway-secret location — issue #333)
 *   6. Default `config.yaml` `api_server.token`
 *
 * The `api_server.token` candidates are the bug fix for #333: users who
 * ran `hermes setup` (which writes `api_server.token` into `config.yaml`
 * but does not touch `.env`) would otherwise see chat fail on the
 * second message with *"Session continuation requires API key
 * authentication. Configure API_SERVER_KEY to enable this feature."*
 *
 * `.env` is checked **before** `api_server.token` so that the
 * documented manual workaround — add `API_SERVER_KEY=…` to `.env` to
 * unblock the second message — still takes precedence when a user has
 * set it explicitly.
 *
 * Returns "" when none of the six locations are configured.
 *
 * Hot path: called per chat message and per error-probe. Reuse the same
 * 5s TTL cache as `readEnv()` so we do not re-parse `config.yaml` +
 * `.env` every call. Invalidated by `setEnvValue` / `setConfigValue`
 * when the key being written is `API_SERVER_KEY` or any
 * `api_server.*` subkey.
 */
export function getApiServerKey(profile?: string): string {
  const cacheKey = `apiServerKey:${profile || "default"}`;
  const cached = getCached<string>(cacheKey);
  if (cached !== undefined) return cached;

  const envForProfile = readEnv(profile);
  const sources: ApiKeySources = {
    configTopLevelProfile: getConfigValue("API_SERVER_KEY", profile),
    configTopLevelDefault:
      profile && profile !== "default"
        ? getConfigValue("API_SERVER_KEY")
        : null,
    envProfile: envForProfile.API_SERVER_KEY ?? null,
    envDefault:
      profile && profile !== "default"
        ? (readEnv().API_SERVER_KEY ?? null)
        : null,
    apiServerTokenProfile: getConfigValue("api_server.token", profile),
    apiServerTokenDefault:
      profile && profile !== "default"
        ? getConfigValue("api_server.token")
        : null,
  };
  const { value, source } = resolveApiServerKeyWithSource(sources);

  // Migration on read — if we resolved the key from a non-canonical
  // location AND the canonical `.env` slot is empty for this profile,
  // copy the value into `.env`. Keeps the original copy alone (additive
  // only — never deletes), so a user who explicitly wrote to
  // `api_server.token:` can still see their original entry there.
  //
  // The point of the migration is to make the gateway's own
  // `os.getenv("API_SERVER_KEY")` lookup find the value: the gateway's
  // env hydration at spawn time also injects it (Piece 0), but a
  // user-edited `.env` is the canonical, file-of-record storage.
  //
  // Per-profile scope: cross-profile migration (e.g. copy default .env
  // value into a profile that has neither) is out of scope — a user
  // running multiple profiles may have intentionally per-profile keys.
  const isNamedProfile = Boolean(profile && profile !== "default");
  const sourceBelongsToProfile =
    !isNamedProfile ||
    source === "configTopLevelProfile" ||
    source === "apiServerTokenProfile";
  if (
    value &&
    source &&
    sourceBelongsToProfile &&
    !CANONICAL_API_KEY_SOURCES.has(source) &&
    !(envForProfile.API_SERVER_KEY ?? "").trim()
  ) {
    try {
      setEnvValue("API_SERVER_KEY", value, profile);
      appendConfigFixLog({
        ts: Date.now(),
        issueCode: "API_SERVER_KEY_NON_CANONICAL",
        action: "migrate",
        from: source,
        to:
          profile && profile !== "default"
            ? `~/.hermes/profiles/${profile}/.env`
            : "~/.hermes/.env",
        profile: profile || "default",
        valueMasked: maskKey(value),
      });
    } catch {
      // best-effort — don't block the read on a failed migration
    }
  }

  setCache(cacheKey, value);
  return value;
}

/**
 * Identifies which of the six candidate locations a resolved
 * `API_SERVER_KEY` was sourced from. Used by the migration-on-read
 * heuristic in `getApiServerKey` and by the config-health audit to
 * surface keys living outside the canonical `.env` location.
 */
export type ApiKeySource =
  | "configTopLevelProfile"
  | "configTopLevelDefault"
  | "envProfile"
  | "envDefault"
  | "apiServerTokenProfile"
  | "apiServerTokenDefault";

export interface ApiKeySources {
  configTopLevelProfile: string | null;
  configTopLevelDefault: string | null;
  envProfile: string | null;
  envDefault: string | null;
  apiServerTokenProfile: string | null;
  apiServerTokenDefault: string | null;
}

export interface ApiKeyResolution {
  value: string;
  source: ApiKeySource | null;
}

/**
 * Source-aware variant of `resolveApiServerKey`. Returns both the
 * resolved value and a tag indicating which candidate won, so callers
 * can decide whether the value lives in the canonical `.env` location
 * or somewhere that warrants a migration / health-audit warning.
 */
export function resolveApiServerKeyWithSource(
  sources: ApiKeySources,
): ApiKeyResolution {
  const order: Array<{ source: ApiKeySource; value: string | null }> = [
    { source: "configTopLevelProfile", value: sources.configTopLevelProfile },
    { source: "configTopLevelDefault", value: sources.configTopLevelDefault },
    { source: "envProfile", value: sources.envProfile },
    { source: "envDefault", value: sources.envDefault },
    { source: "apiServerTokenProfile", value: sources.apiServerTokenProfile },
    { source: "apiServerTokenDefault", value: sources.apiServerTokenDefault },
  ];
  for (const { source, value } of order) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) return { value: trimmed, source };
  }
  return { value: "", source: null };
}

/**
 * Pure precedence-resolution for the API server's shared secret. Split
 * out from `getApiServerKey` so the candidate-ordering policy can be
 * unit-tested without filesystem fixtures (the I/O — `getConfigValue` /
 * `readEnv` — happens in the caller).
 *
 * Returns the first non-empty trimmed candidate, or "" when all six
 * sources are empty / null / whitespace.
 */
export function resolveApiServerKey(sources: ApiKeySources): string {
  return resolveApiServerKeyWithSource(sources).value;
}

/**
 * Sources that are considered the canonical location for
 * `API_SERVER_KEY`. Reads from anywhere else are still honoured but
 * trigger a migration write to `.env` (see Piece 1) so future reads —
 * and crucially the gateway's own `os.getenv("API_SERVER_KEY")` —
 * find the value in the canonical spot.
 */
export const CANONICAL_API_KEY_SOURCES: ReadonlySet<ApiKeySource> =
  new Set<ApiKeySource>(["envProfile", "envDefault"]);

/**
 * Mask a credential for safe logging: keep the first 4 and last 4
 * characters, replace the middle with a fixed-width ellipsis. Returns
 * "" for empty input and "***" for very short values where masking
 * would still expose most of the key.
 */
export function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Append a JSONL entry to `~/.hermes/logs/config-fixes.log` recording
 * an automated or user-initiated config migration. Auto-truncates the
 * log to the most-recent 1000 entries on each write so it doesn't grow
 * unbounded. Best-effort — any I/O error is silently swallowed so a
 * broken log directory never blocks the migration itself.
 */
export interface ConfigFixLogEntry {
  ts: number;
  issueCode: string;
  action: "migrate" | "autofix" | "manual-fix";
  from?: string;
  to?: string;
  profile?: string;
  valueMasked?: string;
  detail?: string;
}

const CONFIG_FIX_LOG_MAX_LINES = 1000;

export function appendConfigFixLog(entry: ConfigFixLogEntry): void {
  try {
    const logDir = join(HERMES_HOME, "logs");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "config-fixes.log");
    let existing = "";
    if (existsSync(logFile)) {
      existing = readFileSync(logFile, "utf-8");
      const lines = existing.split("\n").filter((l) => l.trim() !== "");
      if (lines.length >= CONFIG_FIX_LOG_MAX_LINES) {
        existing =
          lines.slice(lines.length - CONFIG_FIX_LOG_MAX_LINES + 1).join("\n") +
          "\n";
      } else if (existing && !existing.endsWith("\n")) {
        existing += "\n";
      }
    }
    const line = JSON.stringify(entry) + "\n";
    writeFileSync(logFile, existing + line, "utf-8");
  } catch {
    // intentionally silent — never let log I/O block a migration
  }
}

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
  slack: {
    envCheck: (e) =>
      !!e.SLACK_BOT_TOKEN?.trim() && !!e.SLACK_APP_TOKEN?.trim(),
  },
  whatsapp: {
    envCheck: (e) =>
      TRUTHY_VALUES.has((e.WHATSAPP_ENABLED || "").trim().toLowerCase()) ||
      (!!e.WHATSAPP_API_URL?.trim() && !!e.WHATSAPP_API_TOKEN?.trim()),
  },
  signal: {
    envCheck: (e) =>
      (!!e.SIGNAL_HTTP_URL?.trim() && !!e.SIGNAL_ACCOUNT?.trim()) ||
      !!e.SIGNAL_PHONE_NUMBER?.trim(),
  },
  matrix: {
    envCheck: (e) =>
      (!!e.MATRIX_HOMESERVER?.trim() &&
        !!e.MATRIX_ACCESS_TOKEN?.trim() &&
        !!e.MATRIX_USER_ID?.trim()) ||
      !!e.MATRIX_PASSWORD?.trim(),
  },
  mattermost: {
    envCheck: (e) => !!e.MATTERMOST_URL?.trim() && !!e.MATTERMOST_TOKEN?.trim(),
  },
  home_assistant: {
    envCheck: (e) => !!e.HASS_URL?.trim() && !!e.HASS_TOKEN?.trim(),
    configKey: "homeassistant",
  },
  homeassistant: {
    envCheck: (e) => !!e.HASS_URL?.trim() && !!e.HASS_TOKEN?.trim(),
    configKey: "homeassistant",
  },
  email: {
    envCheck: (e) =>
      !!e.EMAIL_ADDRESS?.trim() &&
      !!e.EMAIL_PASSWORD?.trim() &&
      (!!e.EMAIL_IMAP_HOST?.trim() || !!e.EMAIL_IMAP_SERVER?.trim()) &&
      (!!e.EMAIL_SMTP_HOST?.trim() || !!e.EMAIL_SMTP_SERVER?.trim()),
  },
  sms: {
    envCheck: (e) =>
      !!e.TWILIO_ACCOUNT_SID?.trim() && !!e.TWILIO_AUTH_TOKEN?.trim(),
  },
  bluebubbles: {
    envCheck: (e) =>
      (!!e.BLUEBUBBLES_SERVER_URL?.trim() || !!e.BLUEBUBBLES_URL?.trim()) &&
      !!e.BLUEBUBBLES_PASSWORD?.trim(),
  },
  dingtalk: {
    envCheck: (e) =>
      (!!e.DINGTALK_CLIENT_ID?.trim() &&
        !!e.DINGTALK_CLIENT_SECRET?.trim()) ||
      (!!e.DINGTALK_APP_KEY?.trim() && !!e.DINGTALK_APP_SECRET?.trim()),
  },
  feishu: {
    envCheck: (e) => !!e.FEISHU_APP_ID?.trim() && !!e.FEISHU_APP_SECRET?.trim(),
  },
  wecom: {
    envCheck: (e) =>
      !!e.WECOM_BOT_ID?.trim() ||
      (!!e.WECOM_CORP_ID?.trim() &&
        !!e.WECOM_AGENT_ID?.trim() &&
        !!e.WECOM_SECRET?.trim()),
  },
  wecom_callback: {
    envCheck: (e) =>
      !!e.WECOM_CALLBACK_CORP_ID?.trim() &&
      !!e.WECOM_CALLBACK_CORP_SECRET?.trim() &&
      !!e.WECOM_CALLBACK_AGENT_ID?.trim(),
  },
  weixin: {
    envCheck: (e) =>
      (!!e.WEIXIN_ACCOUNT_ID?.trim() && !!e.WEIXIN_TOKEN?.trim()) ||
      !!e.WEIXIN_BOT_TOKEN?.trim(),
  },
  qqbot: {
    envCheck: (e) => !!e.QQ_APP_ID?.trim() && !!e.QQ_CLIENT_SECRET?.trim(),
  },
  yuanbao: { envCheck: () => false },
  api_server: {
    envCheck: (e) =>
      TRUTHY_VALUES.has((e.API_SERVER_ENABLED || "").trim().toLowerCase()) ||
      !!e.API_SERVER_KEY?.trim(),
  },
  webhook: {
    envCheck: (e) =>
      TRUTHY_VALUES.has((e.WEBHOOK_ENABLED || "").trim().toLowerCase()) ||
      !!e.WEBHOOK_SECRET?.trim(),
    configKey: "webhook",
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

// ── Credential Pool / OAuth store (auth.json) ─────────────────────────

function authFilePath(profile?: string): string {
  return join(profileHome(profile || getActiveProfileNameSync()), "auth.json");
}

/**
 * Shape of a credential-pool entry as the upstream gateway expects it.
 *
 * The engine's resolver (`hermes_cli/auth.py` and the credential-pool
 * entry parser) reads `access_token` (not `key`), needs an
 * `auth_type` to distinguish OAuth from API-key entries inside the
 * same pool, and uses `id` / `priority` / `source` for rotation and
 * telemetry. Issue #367 — pool entries written by the desktop with
 * just `{key, label}` were rejected at runtime ("Hermes is not
 * logged into Nous Portal") because none of the canonical fields
 * were present.
 *
 * `key` is retained for read-only compatibility — old auth.json files
 * that already contain `{key, label}` entries are still parsed
 * (otherwise a user's existing manual entries would vanish on first
 * read). New writes always use the full canonical shape.
 */
interface CredentialEntry {
  id?: string;
  label?: string;
  auth_type?: "api_key" | "oauth_device_code" | string;
  priority?: number;
  source?: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  base_url?: string;
  request_count?: number;
  /** Legacy field — historical pool entries written with `{key, label}`. */
  key?: string;
}

function readAuthStore(profile?: string): Record<string, unknown> {
  try {
    const p = authFilePath(profile);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeAuthStore(
  store: Record<string, unknown>,
  profile?: string,
): void {
  safeWriteFile(authFilePath(profile), JSON.stringify(store, null, 2));
}

export function getCredentialPool(
  profile?: string,
): Record<string, CredentialEntry[]> {
  const store = readAuthStore(profile);
  const pool = store.credential_pool;
  if (!pool || typeof pool !== "object") return {};
  return pool as Record<string, CredentialEntry[]>;
}

export function setCredentialPool(
  provider: string,
  entries: CredentialEntry[],
  profile?: string,
): void {
  const store = readAuthStore(profile);
  if (!store.credential_pool || typeof store.credential_pool !== "object") {
    store.credential_pool = {};
  }
  (store.credential_pool as Record<string, CredentialEntry[]>)[provider] =
    entries;
  writeAuthStore(store, profile);
}

/**
 * Build a credential-pool entry in the canonical engine shape from a
 * user-typed (key, label). Used by the Providers screen so the
 * renderer doesn't need to know the upstream schema — issue #367.
 *
 * The base URL for known providers comes from `canonicalProviderBaseUrl`;
 * unknown providers (`custom`, user-defined) get an empty `base_url`
 * and the engine falls back to its own registry.
 */
export function buildCredentialPoolEntry(
  provider: string,
  apiKey: string,
  label: string,
  existingEntries: CredentialEntry[] = [],
): CredentialEntry {
  const baseUrl = canonicalProviderBaseUrl(provider) || "";
  // Next priority — pool entries are sorted ascending, so a new entry
  // appended at the end gets the highest priority value.
  const nextPriority = existingEntries.reduce(
    (max, e) =>
      typeof e.priority === "number" ? Math.max(max, e.priority + 1) : max,
    0,
  );
  return {
    id: cryptoRandomId(),
    label: label.trim() || `Key ${existingEntries.length + 1}`,
    auth_type: "api_key",
    priority: nextPriority,
    source: "manual",
    access_token: apiKey.trim(),
    base_url: baseUrl,
    request_count: 0,
  };
}

function cryptoRandomId(): string {
  // 8-hex-char id — matches the existing pool entries' id length.
  // Uses `randomBytes(4)` so the name finally matches the impl: four
  // cryptographically-strong bytes → 8 hex chars. Post-#382 review
  // feedback flagged the previous `Math.random()` loop as both
  // misleadingly named and collision-prone at scale.
  return randomBytes(4).toString("hex");
}

/**
 * Append a manually-typed credential pool entry, constructing the
 * full canonical shape. Used by the renderer's "Add" button so the
 * shape stays consistent with what the engine's resolver expects.
 *
 * Returns the updated entries list for that provider.
 */
export function addCredentialPoolEntry(
  provider: string,
  apiKey: string,
  label: string,
  profile?: string,
): CredentialEntry[] {
  const existing = getCredentialPool(profile)[provider] || [];
  const entry = buildCredentialPoolEntry(provider, apiKey, label, existing);
  const next = [...existing, entry];
  setCredentialPool(provider, next, profile);
  return next;
}

/**
 * True iff the given provider has usable OAuth or stored-credential evidence
 * in auth.json. Recognized fields are `access_token`, `refresh_token`, and
 * `api_key`, looked up under both `providers[<name>]` and any entry in
 * `credential_pool[<name>]`. When a named profile is given without its own
 * auth.json, fall back to the default-profile store.
 *
 * Stricter than just "provider key exists in JSON" — an empty
 * `providers: { anthropic: {} }` or a bare `active_provider` no longer
 * counts as configured. The previous looser check masked real onboarding
 * errors where a credential record existed but contained no token.
 */
export function hasOAuthCredentials(
  provider: string,
  profile?: string,
): boolean {
  const cleanProvider = provider.trim();
  if (!cleanProvider) return false;

  const stores = [readAuthStore(profile)];
  if (profile && profile !== "default") {
    stores.push(readAuthStore());
  }

  for (const store of stores) {
    const providers = store.providers;
    if (providers && typeof providers === "object") {
      const entry = (providers as Record<string, CredentialEntry>)[
        cleanProvider
      ];
      if (
        entry &&
        (String(entry.access_token || "").trim() ||
          String(entry.refresh_token || "").trim() ||
          String(entry.api_key || "").trim())
      ) {
        return true;
      }
    }

    const pool = store.credential_pool;
    const entries =
      pool && typeof pool === "object"
        ? (pool as Record<string, CredentialEntry[]>)[cleanProvider]
        : undefined;
    if (
      Array.isArray(entries) &&
      entries.some(
        (entry) =>
          !!(
            entry &&
            (String(entry.api_key || "").trim() ||
              String(entry.access_token || "").trim() ||
              String(entry.refresh_token || "").trim())
          ),
      )
    ) {
      return true;
    }
  }

  return false;
}
