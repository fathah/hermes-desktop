/**
 * Index-time redaction — the SINGLE choke point through which every external
 * transcript message passes before it is written to the index. Redaction here
 * (not at read time) means a leaked secret never lands in `messages` or
 * `messages_fts` in the first place, so it cannot be recovered by search.
 *
 * Two layers:
 *   1. Pattern-based — well-known secret shapes (provider keys, tokens, PEM
 *      blocks, JWTs, `key = value` assignments of sensitive-looking names).
 *   2. Known-secrets — exact strings the app already holds (api-server key,
 *      remote bearer token, env values), gathered at the call site and passed
 *      in. Same >8-char guard as {@link StreamRedactor} to avoid trashing the
 *      text with false positives on short values.
 *
 * Pure module: no Node/Electron/sqlite imports, so it runs under vitest.
 */

export const REDACTED = "[REDACTED]";

/**
 * Ordered list of secret-shaped patterns. Each match is replaced wholesale with
 * {@link REDACTED}, EXCEPT the `key = value` heuristic which replaces only the
 * value (handled separately so the surrounding key name survives for context).
 *
 * Order matters only for readability — replacements are independent.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  // PEM private-key blocks (any flavour). Multiline.
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
  // Anthropic keys (sk-ant-...) — listed before the generic sk- rule for clarity.
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  // OpenAI / OpenRouter / generic `sk-` keys (covers sk-or-, sk-proj-, …).
  /sk-[A-Za-z0-9_-]{16,}/g,
  // GitHub tokens: classic PAT, fine-grained PAT, and the gh{p,o,u,s,r}_ family.
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  // AWS access key id.
  /AKIA[0-9A-Z]{16}/g,
  // Slack tokens.
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  // Google API keys.
  /AIza[0-9A-Za-z_-]{35}/g,
  // JSON Web Tokens (three base64url segments). Catches bearer creds in transit.
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

/**
 * Sensitive-looking assignments: `api_key: "abc…"`, `SECRET=abc…`,
 * `token = 'abc…'`. Captures the key-name (group 1) and the value (group 3) so
 * we can keep the name and redact only the value. Requires the value to be at
 * least 12 chars to skip trivial config like `token=on`.
 */
const KEY_VALUE_PATTERN =
  /\b((?:api[-_]?key|secret|token|password|passwd|pwd|access[-_]?key|auth[-_]?token|bearer)[A-Za-z0-9_-]*)\b(["']?\s*[:=]\s*["']?)([A-Za-z0-9_\-./+=]{12,})/gi;

/**
 * Redact one message's text. `knownSecrets` are exact strings (env values, the
 * api-server key, the remote bearer token) the app already holds; they are
 * filtered to >8 chars to match {@link StreamRedactor} and avoid false hits.
 */
export function redactExternalText(
  text: string,
  knownSecrets: readonly string[] = [],
): string {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }

  let result = text;

  // Layer 1a: pattern-based, full-match replacement.
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }

  // Layer 1b: key = value heuristic — keep the name, redact the value.
  result = result.replace(
    KEY_VALUE_PATTERN,
    (_match, keyName: string, sep: string) => `${keyName}${sep}${REDACTED}`,
  );

  // Layer 2: exact known secrets the app already holds.
  const longSecrets = knownSecrets.filter(
    (s): s is string => typeof s === "string" && s.trim().length > 8,
  );
  for (const secret of longSecrets) {
    result = result.split(secret).join(REDACTED);
  }

  return result;
}
