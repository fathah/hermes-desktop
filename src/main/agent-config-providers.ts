// @lat: [[provider-setup#Provider setup#Agent config sync for named providers]]
import { existsSync, readFileSync } from "fs";
import { profilePaths, safeWriteFile } from "./utils";

/**
 * Bridge between hermes-agent's config.yaml provider sections and the
 * desktop's own stores, so providers added from the terminal show up in the
 * desktop UI and providers added in the desktop are visible to `hermes`.
 *
 * The agent reads two user-config shapes (hermes_cli/providers.py):
 *   - `providers:` — a dict of named endpoints: `{slug: {name, base_url,
 *     key_env, transport}}`, resolved by `resolve_user_provider`. This is the
 *     shape the desktop mirrors its named custom providers into.
 *   - `custom_providers:` — the legacy list (`- name/base_url/model/api_key`),
 *     already imported into the model library by [[src/main/models.ts]].
 *
 * All edits are text-based (offset/line splicing, like config.ts) so user
 * comments and unrelated keys in config.yaml survive round-trips. In
 * particular, updating an entry patches individual field values in place —
 * a terminal user's extra fields (e.g. `transport:`) are never dropped.
 */

export interface AgentUserProvider {
  /** The `providers:` dict key — what `--provider <slug>` resolves. */
  slug: string;
  /** Display name (`name:`), falling back to the slug. */
  name: string;
  /** Endpoint base URL (`base_url:`/`api:`/`url:` — same aliases the agent accepts). */
  baseUrl: string;
  /** Env var holding the API key (`key_env:`), empty when unset. */
  keyEnv: string;
}

/** Slug used as the config.yaml `providers:` dict key for a display name —
 *  same normalization the agent applies to custom-provider names. */
export function slugifyProviderName(name: string): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readConfig(profile?: string): { file: string; content: string } {
  const { configFile } = profilePaths(profile);
  return {
    file: configFile,
    content: existsSync(configFile) ? readFileSync(configFile, "utf-8") : "",
  };
}

function stripScalar(raw: string): string {
  const trimmed = raw.trim();
  // A double-quoted scalar: unquote and unescape (the inverse of yamlQuote),
  // and don't apply comment stripping inside the quotes.
  const dq = trimmed.match(/^"((?:[^"\\]|\\.)*)"/);
  if (dq) return dq[1].replace(/\\(["\\])/g, "$1");
  const sq = trimmed.match(/^'((?:[^']|'')*)'/);
  if (sq) return sq[1].replace(/''/g, "'");
  return trimmed
    .replace(/\s+#.*$/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

interface FieldSpan {
  value: string;
  /** Offsets bracketing the raw value text on the field's line. */
  valueStart: number;
  valueEnd: number;
}

interface ProviderEntrySpan {
  slug: string;
  /** Offset of the `<slug>:` line start. */
  start: number;
  /** Offset just past the entry's last line (exclusive, incl. newline). */
  end: number;
  /** Offset just past the `<slug>:` header line — where a new field goes. */
  headerEnd: number;
  /** Indent of this entry's direct fields ("" until a field is seen). */
  fieldIndent: string;
  fields: Map<string, FieldSpan>;
}

interface ProvidersBlock {
  /** Offset just past the last body line (exclusive) — append point. */
  bodyEnd: number;
  /** Indent of provider entries (children of `providers:`). */
  childIndent: string;
  entries: ProviderEntrySpan[];
}

/** Locate the top-level `providers:` block and its entries. Null when the
 *  file has no such block. Line-based, indentation-scoped: only an entry's
 *  direct children are recorded as fields, so nested maps (e.g. a `models:`
 *  sub-dict) can't shadow `name`/`base_url`/`key_env`. */
function findProvidersBlock(content: string): ProvidersBlock | null {
  const header = content.match(/^providers[^\S\r\n]*:[^\S\r\n]*(#.*)?\r?\n/m);
  if (!header || header.index === undefined) return null;
  if (header.index > 0 && content[header.index - 1] !== "\n") return null;

  const bodyStart = header.index + header[0].length;
  const lines = content.slice(bodyStart).split(/(?<=\n)/);
  const entries: ProviderEntrySpan[] = [];
  let childIndent = "";
  let offset = bodyStart;
  let bodyEnd = bodyStart;
  let current: ProviderEntrySpan | null = null;

  for (const line of lines) {
    // Lines keep their trailing newline (lookbehind split) so offsets add up;
    // match against the newline-stripped text since `$` won't cross a `\n`.
    const text = line.replace(/\r?\n$/, "");
    const isBlank = /^\s*$/.test(text);
    if (!isBlank && !/^[ \t]/.test(text)) break; // next top-level key
    if (!isBlank) {
      const keyMatch = text.match(/^([ \t]+)([\w.-]+)([^\S\r\n]*:)(.*)$/);
      if (keyMatch) {
        const [, ind, key, colon, rest] = keyMatch;
        if (!childIndent) childIndent = ind;
        if (ind.length <= childIndent.length) {
          current = {
            slug: key,
            start: offset,
            end: offset + line.length,
            headerEnd: offset + line.length,
            fieldIndent: "",
            fields: new Map(),
          };
          entries.push(current);
        } else if (current) {
          if (!current.fieldIndent) current.fieldIndent = ind;
          if (ind.length === current.fieldIndent.length) {
            const valueStart =
              offset +
              ind.length +
              key.length +
              colon.length +
              (rest.length - rest.trimStart().length);
            const rawValue = rest.trimStart();
            current.fields.set(key, {
              value: stripScalar(rawValue),
              valueStart,
              valueEnd: valueStart + rawValue.replace(/\s+$/, "").length,
            });
          }
          current.end = offset + line.length;
        }
      } else if (current) {
        // Non key:value content (e.g. list items) still belongs to the entry.
        current.end = offset + line.length;
      }
      bodyEnd = offset + line.length;
    }
    offset += line.length;
  }
  return { bodyEnd, childIndent: childIndent || "  ", entries };
}

/** Parse the `providers:` dict from a profile's config.yaml. */
export function listAgentUserProviders(profile?: string): AgentUserProvider[] {
  const { content } = readConfig(profile);
  if (!content) return [];
  const block = findProvidersBlock(content);
  if (!block) return [];
  return block.entries.map((e) => ({
    slug: e.slug,
    name: e.fields.get("name")?.value || e.slug,
    // Same base-URL aliases resolve_user_provider accepts, same precedence.
    baseUrl:
      e.fields.get("api")?.value ||
      e.fields.get("url")?.value ||
      e.fields.get("base_url")?.value ||
      "",
    keyEnv: e.fields.get("key_env")?.value || "",
  }));
}

/** Double-quoted YAML scalar: backslashes and quotes escaped so a provider
 *  name like `My "Fast" Provider` can't produce an unparseable config.yaml. */
function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderEntry(
  indent: string,
  input: { slug: string; name: string; baseUrl: string; keyEnv: string },
): string {
  const sub = indent + "  ";
  return (
    `${indent}${input.slug}:\n` +
    `${sub}name: ${yamlQuote(input.name)}\n` +
    `${sub}base_url: ${yamlQuote(input.baseUrl)}\n` +
    (input.keyEnv ? `${sub}key_env: ${yamlQuote(input.keyEnv)}\n` : "")
  );
}

/**
 * Create or update a `providers:` entry in config.yaml. An existing entry is
 * matched by `key_env`, then by slug — so a desktop re-save updates the
 * terminal-visible block in place instead of duplicating it. Updates patch
 * only the `name`/`base_url`/`key_env` values; other fields are preserved.
 */
export function upsertAgentUserProvider(
  profile: string | undefined,
  input: { name: string; baseUrl: string; keyEnv: string; slug?: string },
): void {
  const name = (input.name || "").trim();
  const baseUrl = (input.baseUrl || "").trim();
  const slug = (input.slug || slugifyProviderName(name)).trim();
  if (!name || !baseUrl || !slug) return;

  const { file, content } = readConfig(profile);
  const block = findProvidersBlock(content);
  const entry = { slug, name, baseUrl, keyEnv: input.keyEnv || "" };

  if (!block) {
    // The agent's config scaffold writes an inline empty dict (`providers: {}`),
    // which the block parser can't index. Rewrite that line into block form —
    // appending a second `providers:` key instead would make the YAML
    // ambiguous (this exact miss silently disabled the Hermes One mirror).
    const emptyFlow = content.match(
      /^providers[^\S\r\n]*:[^\S\r\n]*\{[^\S\r\n]*\}[^\S\r\n]*(#.*)?\r?\n?/m,
    );
    if (emptyFlow && emptyFlow.index !== undefined) {
      const replacement = `providers:\n${renderEntry("  ", entry)}`;
      safeWriteFile(
        file,
        content.slice(0, emptyFlow.index) +
          replacement +
          content.slice(emptyFlow.index + emptyFlow[0].length),
      );
      return;
    }
    // Any other unparseable `providers:` form (a non-empty flow dict) — bail
    // rather than append a duplicate top-level key.
    if (/^providers[^\S\r\n]*:/m.test(content)) return;
    const sep = content === "" || content.endsWith("\n") ? "" : "\n";
    safeWriteFile(
      file,
      `${content}${sep}providers:\n${renderEntry("  ", entry)}`,
    );
    return;
  }

  const existing =
    block.entries.find(
      (e) => input.keyEnv && e.fields.get("key_env")?.value === input.keyEnv,
    ) ?? block.entries.find((e) => e.slug === slug);

  if (!existing) {
    const rendered = renderEntry(block.childIndent, entry);
    safeWriteFile(
      file,
      content.slice(0, block.bodyEnd) + rendered + content.slice(block.bodyEnd),
    );
    return;
  }

  // Patch fields in place, back-to-front so earlier offsets stay valid.
  // The base-URL aliases (`api`/`url`) are updated under whichever name the
  // entry already uses; missing fields are inserted after the header line.
  const urlField = existing.fields.has("api")
    ? "api"
    : existing.fields.has("url")
      ? "url"
      : "base_url";
  const wanted: [string, string][] = [
    ["name", name],
    [urlField, baseUrl],
    ...(entry.keyEnv ? [["key_env", entry.keyEnv] as [string, string]] : []),
  ];
  const patches: { start: number; end: number; text: string }[] = [];
  const fieldIndent = existing.fieldIndent || block.childIndent + "  ";
  for (const [key, value] of wanted) {
    const span = existing.fields.get(key);
    if (span) {
      if (span.value === value) continue;
      patches.push({
        start: span.valueStart,
        end: span.valueEnd,
        text: yamlQuote(value),
      });
    } else {
      patches.push({
        start: existing.headerEnd,
        end: existing.headerEnd,
        text: `${fieldIndent}${key}: ${yamlQuote(value)}\n`,
      });
    }
  }
  if (patches.length === 0) return; // nothing changed — don't rewrite the file
  patches.sort((a, b) => b.start - a.start);
  let next = content;
  for (const p of patches) {
    next = next.slice(0, p.start) + p.text + next.slice(p.end);
  }
  safeWriteFile(file, next);
}

/** Remove a `providers:` entry matched by key_env, or by slug derived from
 *  the name. No-op when absent. */
export function removeAgentUserProvider(
  profile: string | undefined,
  match: { name: string; keyEnv?: string },
): void {
  const { file, content } = readConfig(profile);
  if (!content) return;
  const block = findProvidersBlock(content);
  if (!block) return;
  const slug = slugifyProviderName(match.name);
  const existing =
    block.entries.find(
      (e) => match.keyEnv && e.fields.get("key_env")?.value === match.keyEnv,
    ) ?? block.entries.find((e) => e.slug === slug);
  if (!existing) return;
  safeWriteFile(
    file,
    content.slice(0, existing.start) + content.slice(existing.end),
  );
}

// Hermes One's inference endpoint. Mirrored as a first-party user provider so
// the agent can route it by slug; must match `OPENAI_COMPATIBLE_BASE_URLS`
// (renderer constants) and the `URL_KEY_MAP` host pattern.
const HERMESONE_BASE_URL = "https://inference.hermesone.org/v1";

/**
 * Mirror first-party keyed brands into config.yaml `providers:` so the agent
 * can route them as *named* providers. Today: Hermes One.
 *
 * Without this the gateway has no provider row for `inference.hermesone.org`
 * — desktop models on that endpoint are saved as bare `custom` + base URL,
 * and the agent resolves `--provider custom` against **the session's current
 * base URL**. A session sitting on another provider (e.g. Nous) then sends
 * the Hermes One model to the wrong endpoint (404, wrong catalog). A
 * `providers: hermesone:` entry gives the switch a slug that always carries
 * the right URL and key. Idempotent — the upsert no-ops when unchanged; runs
 * on every model-library / provider-list read.
 */
export function mirrorFirstPartyAgentProviders(profile?: string): void {
  try {
    const { envFile } = profilePaths(profile);
    if (!existsSync(envFile)) return;
    const env = readFileSync(envFile, "utf-8");
    const match = env.match(/^\s*HERMESONE_API_KEY\s*=\s*(.+)\s*$/m);
    if (!match || !match[1].trim()) return;
    upsertAgentUserProvider(profile, {
      slug: "hermesone",
      name: "Hermes One",
      baseUrl: HERMESONE_BASE_URL,
      keyEnv: "HERMESONE_API_KEY",
    });
  } catch {
    /* best-effort — chat still works once the entry can be written */
  }
}

/**
 * Remove a legacy `custom_providers:` list item by display name. Needed when
 * the user deletes a terminal-added provider from the desktop UI — leaving the
 * list item behind would re-import it on the next read.
 */
export function removeAgentCustomProviderEntry(
  profile: string | undefined,
  name: string,
): void {
  const { file, content } = readConfig(profile);
  if (!content) return;
  const header = content.match(
    /^custom_providers[^\S\r\n]*:[^\S\r\n]*(#.*)?\r?\n/m,
  );
  if (!header || header.index === undefined) return;
  if (header.index > 0 && content[header.index - 1] !== "\n") return;

  const bodyStart = header.index + header[0].length;
  const lines = content.slice(bodyStart).split(/(?<=\n)/);
  const target = (name || "").trim();
  let offset = bodyStart;
  let itemStart = -1;
  let itemEnd = -1;
  let itemMatches = false;

  for (const line of lines) {
    const text = line.replace(/\r?\n$/, "");
    const isBlank = /^\s*$/.test(text);
    if (!isBlank && !/^[ \t]/.test(text)) break; // next top-level key
    if (/^\s*-\s/.test(text)) {
      if (itemMatches) break; // matched item fully scanned
      itemStart = offset;
      itemEnd = offset + line.length;
      const nm = text.match(/-\s*name\s*:\s*(.*)$/);
      itemMatches = !!nm && stripScalar(nm[1]) === target;
    } else if (itemStart !== -1 && !isBlank) {
      const nm = text.match(/^\s*name\s*:\s*(.*)$/);
      if (nm && stripScalar(nm[1]) === target) itemMatches = true;
      itemEnd = offset + line.length;
    }
    offset += line.length;
  }
  if (!itemMatches || itemStart === -1) return;
  safeWriteFile(file, content.slice(0, itemStart) + content.slice(itemEnd));
}
