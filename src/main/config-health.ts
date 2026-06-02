/**
 * Config-health audit — startup + on-demand scan for inconsistencies
 * across the desktop's three configuration surfaces (`.env`,
 * `config.yaml`, `models.json`) plus the running gateway state.
 *
 * Every check is wrapped in try/catch so a broken check NEVER breaks
 * the audit; the runner returns an empty report on total failure.
 * Each issue carries an `autoFixable` flag and a fix description; the
 * renderer's Diagnose UI renders a per-issue "Fix" button for those.
 *
 * Audit log: every auto-fix appends to `~/.hermes/logs/config-fixes.log`
 * via `appendConfigFixLog` (capped at 1000 entries).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profilePaths } from "./utils";
import {
  type ApiKeySource,
  appendConfigFixLog,
  customEndpointKeyResolvable,
  getConfigValue,
  getModelConfig,
  hasOAuthCredentials,
  maskKey,
  readEnv,
  setConfigValue,
  setEnvValue,
  upsertBlockChild,
} from "./config";
import { safeWriteFile } from "./utils";
import { HERMES_HOME } from "./installer";
import { expectedEnvKeyForModel } from "./installer";
import { expectedEnvKeyForUrl, isLocalBaseUrl } from "../shared/url-key-map";
import { findSiblingHermesHomes } from "./wsl-detection";

export type Severity = "error" | "warning" | "info";

export type IssueCode =
  | "API_SERVER_KEY_NON_CANONICAL"
  | "API_SERVER_KEY_MULTIPLE_VALUES"
  | "EMPTY_API_SERVER_KEY"
  | "MODEL_KEY_MISSING"
  | "UI_RUNTIME_ENVKEY_MISMATCH"
  | "NON_ASCII_CREDENTIAL"
  | "SIBLING_HERMES_HOME_DRIFT"
  | "LEGACY_TOOLSET_NAME";

export interface ConfigHealthIssue {
  code: IssueCode;
  severity: Severity;
  message: string;
  detail?: string;
  /** Filesystem paths involved — shown to the user verbatim. */
  locations: string[];
  autoFixable: boolean;
  fixDescription?: string;
  fixLocation?: "providers" | "models" | ".env" | "config.yaml" | "setup";
  /** Optional context for the auto-fix routine (e.g. which env var). */
  context?: Record<string, string>;
}

export interface ConfigHealthReport {
  ranAt: number;
  profile: string;
  issues: ConfigHealthIssue[];
  summary: { errors: number; warnings: number; infos: number };
}

const EMPTY_REPORT = (profile: string): ConfigHealthReport => ({
  ranAt: Date.now(),
  profile,
  issues: [],
  summary: { errors: 0, warnings: 0, infos: 0 },
});

/**
 * Run all enabled checks against the given profile (default profile
 * when omitted). Returns a populated report; never throws.
 */
export function runConfigHealthCheck(profile?: string): ConfigHealthReport {
  const profileName = profile || "default";
  const report = EMPTY_REPORT(profileName);

  const checks: Array<(p?: string) => ConfigHealthIssue[]> = [
    checkApiServerKeyPlacement,
    checkActiveModelKeyPresence,
    checkRuntimeEnvKeyMismatch,
    checkNonAsciiCredentials,
    checkSiblingHermesHomeDrift,
    checkLegacyToolsetName,
  ];

  for (const check of checks) {
    try {
      const issues = check(profile);
      for (const issue of issues) {
        report.issues.push(issue);
        if (issue.severity === "error") report.summary.errors++;
        else if (issue.severity === "warning") report.summary.warnings++;
        else report.summary.infos++;
      }
    } catch (err) {
      // Swallow — a broken check never breaks the audit. Log to console
      // so a developer can find it; users see only the empty result.
      // eslint-disable-next-line no-console
      console.warn("[config-health] check threw:", err);
    }
  }

  return report;
}

/**
 * Auto-fix dispatcher. Each fixable IssueCode has its own handler.
 * Returns `{ok: false}` for unknown / non-fixable codes.
 */
export function autoFixIssue(
  code: IssueCode,
  profile?: string,
  context?: Record<string, string>,
): { ok: boolean; message?: string } {
  try {
    switch (code) {
      case "API_SERVER_KEY_NON_CANONICAL":
        return fixApiServerKeyPlacement(profile);
      case "UI_RUNTIME_ENVKEY_MISMATCH":
        return fixRuntimeEnvKeyMismatch(profile, context);
      case "NON_ASCII_CREDENTIAL":
        return fixNonAsciiCredential(profile, context);
      case "SIBLING_HERMES_HOME_DRIFT":
        return fixSiblingHermesHomeDrift(profile, context);
      case "LEGACY_TOOLSET_NAME":
        return fixLegacyToolsetName(profile);
      default:
        return { ok: false, message: `No auto-fix available for ${code}` };
    }
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// ───────────────────────────────────────────────────────
//  Checks
// ───────────────────────────────────────────────────────

/**
 * `API_SERVER_KEY` lives in any non-`.env` location AND/OR in multiple
 * locations with different values. The migration-on-read fix in
 * getApiServerKey() handles the first case automatically; this check
 * just surfaces it so users see it happened (and re-fires if the auto
 * migration failed for some reason).
 */
function checkApiServerKeyPlacement(profile?: string): ConfigHealthIssue[] {
  const issues: ConfigHealthIssue[] = [];
  const { envFile, configFile } = profilePaths(profile);

  const env = readEnv(profile);
  const envKey = (env.API_SERVER_KEY ?? "").trim();
  const topLevel = (getConfigValue("API_SERVER_KEY", profile) ?? "").trim();
  const nested = (getConfigValue("api_server.token", profile) ?? "").trim();

  // Multiple values: if two or more non-empty locations disagree, that's
  // ambiguous and the user has to resolve which one wins.
  const values = [envKey, topLevel, nested].filter((v) => v !== "");
  const uniqueValues = new Set(values);
  if (uniqueValues.size > 1) {
    issues.push({
      code: "API_SERVER_KEY_MULTIPLE_VALUES",
      severity: "error",
      message:
        "API_SERVER_KEY is set in multiple places with different values.",
      detail:
        "The desktop and the gateway pick different values depending on " +
        "the source. Resolve to a single canonical entry in .env and " +
        "remove the others.",
      locations: [envFile, configFile].filter(existsSync),
      autoFixable: false,
      fixLocation: ".env",
    });
    return issues; // Resolve this before re-flagging non-canonical placement
  }

  // Non-canonical placement: the only value is somewhere other than .env.
  if (!envKey && (topLevel || nested)) {
    const source: ApiKeySource = topLevel
      ? "configTopLevelProfile"
      : "apiServerTokenProfile";
    issues.push({
      code: "API_SERVER_KEY_NON_CANONICAL",
      severity: "warning",
      message:
        "API_SERVER_KEY is configured in config.yaml only — copy it to .env so the gateway picks it up reliably.",
      detail:
        "The upstream gateway reads API_SERVER_KEY from .env or its " +
        "spawn environment. Keeping the value in config.yaml works " +
        "today (the desktop bridges it), but .env is the canonical " +
        "location and survives upstream changes.",
      locations: [configFile].filter(existsSync),
      autoFixable: true,
      fixDescription: "Copy the value into .env (config.yaml untouched).",
      fixLocation: ".env",
      context: { source },
    });
  }

  // Empty: no key at all, and the gateway is configured to require one.
  // We can't auto-fix this — the user has to provide a secret.
  if (!envKey && !topLevel && !nested) {
    // Only flag if a gateway run.py / api_server is actually configured.
    // For a fresh install with no setup yet, this would be noise.
    const configExists = existsSync(configFile);
    if (configExists) {
      issues.push({
        code: "EMPTY_API_SERVER_KEY",
        severity: "info",
        message:
          "No API_SERVER_KEY is set — session continuation will use the gateway's anonymous fallback.",
        detail:
          "If you want to enforce auth on the local gateway (or are " +
          "running it remotely / behind SSH), set API_SERVER_KEY in .env.",
        locations: [envFile],
        autoFixable: false,
        fixLocation: "setup",
      });
    }
  }

  return issues;
}

/**
 * Active model is configured but its expected provider key isn't in
 * .env. This is the *most likely* cause of chat 401s — the user has
 * picked a model in the GUI but their key isn't where the gateway
 * expects to find it.
 */
function checkActiveModelKeyPresence(profile?: string): ConfigHealthIssue[] {
  const mc = getModelConfig(profile);
  if (!mc.provider || mc.provider === "auto") return [];
  if (!mc.model) return [];

  // Local/private URLs commonly run without a provider API key.
  if (isLocalBaseUrl(mc.baseUrl)) return [];

  const expectedKey = expectedEnvKeyForModel(mc.provider, mc.baseUrl);
  if (!expectedKey) return [];

  const env = readEnv(profile);
  if ((env[expectedKey] ?? "").trim()) return [];

  // OpenAI-compatible / custom endpoints resolve their key from a fallback
  // chain (URL key → CUSTOM_PROVIDER_<name>_KEY → CUSTOM_API_KEY →
  // OPENAI_API_KEY). If any link is present the gateway can authenticate, so
  // don't warn about the URL-derived key being absent.
  if (customEndpointKeyResolvable(mc.provider, mc.baseUrl, profile)) {
    return [];
  }

  // Secondary positive signal: auth.json may carry the credentials
  // (OAuth tokens, or properly-shaped credential-pool entries).
  // Issue #367 — Nous Portal in OAuth mode has no NOUS_API_KEY in
  // .env, the engine resolves from auth.json instead. Don't flag if
  // we see real evidence there.
  if (hasOAuthCredentials(mc.provider, profile)) return [];

  const { envFile } = profilePaths(profile);
  return [
    {
      code: "MODEL_KEY_MISSING",
      severity: "warning",
      message: `Active model uses ${mc.provider} but ${expectedKey} is not set in .env (and no credentials in auth.json).`,
      detail:
        "Chat will fail with an upstream auth error until the key is " +
        "configured. Add it under Providers, sign in via the OAuth " +
        "flow, or switch to a model whose credentials are already set.",
      locations: [envFile],
      autoFixable: false,
      fixLocation: "providers",
      context: { expectedKey, provider: mc.provider },
    },
  ];
}

/**
 * Mismatch between the env var name the GUI saved a key under and the
 * env var name the runtime actually reads. Specifically: the user
 * picked a base URL whose canonical key is X, but their .env stores
 * a value under Y. Auto-fix copies the value to X (Option A — leave
 * the old entry alone).
 */
function checkRuntimeEnvKeyMismatch(profile?: string): ConfigHealthIssue[] {
  const mc = getModelConfig(profile);
  if (!mc.baseUrl) return [];

  const expectedKey = expectedEnvKeyForUrl(mc.baseUrl);
  if (expectedKey === "CUSTOM_API_KEY") return [];

  const env = readEnv(profile);
  const expectedValue = (env[expectedKey] ?? "").trim();
  if (expectedValue) return []; // Expected key already has a value

  // For OpenAI-compatible / custom endpoints, OPENAI_API_KEY and
  // CUSTOM_API_KEY are valid fallbacks the runtime actually reads — not a
  // "saved under the wrong name" mismatch. Don't suggest copying the value to
  // the URL-derived key when the existing one already resolves.
  if (customEndpointKeyResolvable(mc.provider, mc.baseUrl, profile)) {
    return [];
  }

  // Look for any non-empty *_API_KEY / *_TOKEN that *isn't* the expected
  // one — that's the candidate for the mismatch warning. Don't fire
  // on a wholly-empty .env; that's MODEL_KEY_MISSING territory.
  const candidates = Object.entries(env).filter(
    ([k, v]) =>
      /^[A-Z][A-Z0-9_]*(_API_KEY|_TOKEN)$/.test(k) &&
      k !== expectedKey &&
      k !== "API_SERVER_KEY" &&
      (v ?? "").trim() !== "",
  );
  if (candidates.length === 0) return [];

  // Pick the candidate that looks most like a provider key (first match).
  const [otherKey] = candidates[0];
  const { envFile } = profilePaths(profile);
  return [
    {
      code: "UI_RUNTIME_ENVKEY_MISMATCH",
      severity: "warning",
      message: `${expectedKey} is empty but ${otherKey} has a value — likely saved under the wrong name.`,
      detail:
        `Your active model's base URL (${mc.baseUrl}) expects ${expectedKey}, ` +
        `but only ${otherKey} is populated. Auto-fix copies the value across ` +
        "(the original entry is left alone).",
      locations: [envFile],
      autoFixable: true,
      fixDescription: `Copy ${otherKey} → ${expectedKey} in .env.`,
      fixLocation: ".env",
      context: { from: otherKey, to: expectedKey },
    },
  ];
}

/**
 * Non-ASCII characters in credential values — most often a stray curly
 * quote from a copy-paste, which the upstream rejects with a confusing
 * error. Auto-fix strips them.
 */
function checkNonAsciiCredentials(profile?: string): ConfigHealthIssue[] {
  const env = readEnv(profile);
  const offenders: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z][A-Z0-9_]*(_API_KEY|_TOKEN|API_SERVER_KEY)$/.test(key)) {
      continue;
    }
    if (!value) continue;
    // eslint-disable-next-line no-control-regex
    if (/[^\x20-\x7e]/.test(value)) {
      offenders.push(key);
    }
  }
  if (offenders.length === 0) return [];

  const { envFile } = profilePaths(profile);
  return [
    {
      code: "NON_ASCII_CREDENTIAL",
      severity: "info",
      message: `Non-ASCII characters detected in: ${offenders.join(", ")}.`,
      detail:
        "Common cause: a smart-quote or trailing newline from a paste. " +
        "Auto-fix strips characters outside the printable ASCII range.",
      locations: [envFile],
      autoFixable: true,
      fixDescription: "Strip non-ASCII characters from the values.",
      fixLocation: ".env",
      context: { keys: offenders.join(",") },
    },
  ];
}

// ───────────────────────────────────────────────────────
//  Auto-fixes
// ───────────────────────────────────────────────────────

function fixApiServerKeyPlacement(profile?: string): {
  ok: boolean;
  message?: string;
} {
  const topLevel = (getConfigValue("API_SERVER_KEY", profile) ?? "").trim();
  const nested = (getConfigValue("api_server.token", profile) ?? "").trim();
  const value = topLevel || nested;
  if (!value) {
    return { ok: false, message: "Nothing to migrate." };
  }
  const env = readEnv(profile);
  if ((env.API_SERVER_KEY ?? "").trim()) {
    return { ok: true, message: ".env already has API_SERVER_KEY." };
  }
  setEnvValue("API_SERVER_KEY", value, profile);
  appendConfigFixLog({
    ts: Date.now(),
    issueCode: "API_SERVER_KEY_NON_CANONICAL",
    action: "autofix",
    from: topLevel ? "configTopLevelProfile" : "apiServerTokenProfile",
    to: profilePaths(profile).envFile,
    profile: profile || "default",
    valueMasked: maskKey(value),
  });
  return { ok: true, message: "Copied API_SERVER_KEY into .env." };
}

function fixRuntimeEnvKeyMismatch(
  profile: string | undefined,
  context: Record<string, string> | undefined,
): { ok: boolean; message?: string } {
  if (!context?.from || !context?.to) {
    return { ok: false, message: "Missing fix context (from/to env keys)." };
  }
  const env = readEnv(profile);
  const value = (env[context.from] ?? "").trim();
  if (!value) {
    return {
      ok: false,
      message: `${context.from} is empty — nothing to copy.`,
    };
  }
  if ((env[context.to] ?? "").trim()) {
    return {
      ok: true,
      message: `${context.to} already populated — no copy needed.`,
    };
  }
  setEnvValue(context.to, value, profile);
  appendConfigFixLog({
    ts: Date.now(),
    issueCode: "UI_RUNTIME_ENVKEY_MISMATCH",
    action: "autofix",
    from: context.from,
    to: context.to,
    profile: profile || "default",
    valueMasked: maskKey(value),
  });
  return { ok: true, message: `Copied ${context.from} → ${context.to}.` };
}

function fixNonAsciiCredential(
  profile: string | undefined,
  context: Record<string, string> | undefined,
): { ok: boolean; message?: string } {
  const keys = (context?.keys ?? "").split(",").filter(Boolean);
  if (keys.length === 0) {
    return { ok: false, message: "No keys to clean." };
  }
  const env = readEnv(profile);
  const cleaned: string[] = [];
  for (const key of keys) {
    const value = env[key] ?? "";
    // eslint-disable-next-line no-control-regex
    const stripped = value.replace(/[^\x20-\x7e]/g, "");
    if (stripped !== value && stripped) {
      setEnvValue(key, stripped, profile);
      cleaned.push(key);
      appendConfigFixLog({
        ts: Date.now(),
        issueCode: "NON_ASCII_CREDENTIAL",
        action: "autofix",
        from: key,
        to: key,
        profile: profile || "default",
        valueMasked: maskKey(stripped),
      });
    }
  }
  if (cleaned.length === 0) {
    return { ok: false, message: "Nothing to clean." };
  }
  return { ok: true, message: `Cleaned: ${cleaned.join(", ")}.` };
}

// ───────────────────────────────────────────────────────
//  Sibling-hermes-home drift check (Windows + WSL)
//
//  Hermes Desktop reads its config from %LocalAppData%\hermes\. Users
//  who also run the `hermes` CLI inside a WSL distro have a second,
//  separate ~/.hermes/ at /home/<user>/.hermes/ on the WSL fs. The
//  two are independent. When they drift (a key set on one side but
//  not the other, two different keys, etc.), the user gets confusing
//  errors like "Invalid token payload" because chat goes through the
//  Windows-side config but they configured the WSL-side. Issue #384
//  is a textbook case.
//
//  The check enumerates accessible WSL ~/.hermes/ directories
//  (fail-soft — no WSL, no result), compares a curated set of
//  fields, and emits one issue per drifting field. Auto-fix is
//  offered ONLY when the direction is unambiguous (one side empty,
//  the other has a value).
// ───────────────────────────────────────────────────────

/** Fields we compare across sibling hermes-homes. Each entry is
 *  `{ source, field, label }`:
 *   - `source` — `env` (reads from `.env`) or `config` (reads
 *     from `config.yaml` via dotted-path getConfigValue equivalent)
 *   - `field` — the key/path name
 *   - `label` — what to call it in messages
 *
 *  Adding to this list is cheap; pick fields whose drift causes
 *  real user-visible bugs. */
const DRIFT_FIELDS: ReadonlyArray<{
  source: "env" | "config";
  field: string;
  label: string;
}> = [
  // .env credentials — the most common drift cause
  { source: "env", field: "API_SERVER_KEY", label: "API_SERVER_KEY (.env)" },
  {
    source: "env",
    field: "OPENROUTER_API_KEY",
    label: "OPENROUTER_API_KEY (.env)",
  },
  {
    source: "env",
    field: "ANTHROPIC_API_KEY",
    label: "ANTHROPIC_API_KEY (.env)",
  },
  { source: "env", field: "OPENAI_API_KEY", label: "OPENAI_API_KEY (.env)" },
  {
    source: "env",
    field: "DEEPSEEK_API_KEY",
    label: "DEEPSEEK_API_KEY (.env)",
  },
  { source: "env", field: "GROQ_API_KEY", label: "GROQ_API_KEY (.env)" },
  { source: "env", field: "MISTRAL_API_KEY", label: "MISTRAL_API_KEY (.env)" },
  {
    source: "env",
    field: "TOGETHER_API_KEY",
    label: "TOGETHER_API_KEY (.env)",
  },
  {
    source: "env",
    field: "FIREWORKS_API_KEY",
    label: "FIREWORKS_API_KEY (.env)",
  },
  {
    source: "env",
    field: "CEREBRAS_API_KEY",
    label: "CEREBRAS_API_KEY (.env)",
  },
  {
    source: "env",
    field: "PERPLEXITY_API_KEY",
    label: "PERPLEXITY_API_KEY (.env)",
  },
  { source: "env", field: "GOOGLE_API_KEY", label: "GOOGLE_API_KEY (.env)" },
  { source: "env", field: "XAI_API_KEY", label: "XAI_API_KEY (.env)" },
  { source: "env", field: "NOUS_API_KEY", label: "NOUS_API_KEY (.env)" },
  { source: "env", field: "HF_TOKEN", label: "HF_TOKEN (.env)" },
  { source: "env", field: "CUSTOM_API_KEY", label: "CUSTOM_API_KEY (.env)" },
  // config.yaml fields — the model-specific ones, including the
  // `api_key` field that issue #384 was hitting.
  {
    source: "config",
    field: "model.provider",
    label: "model.provider (config.yaml)",
  },
  {
    source: "config",
    field: "model.default",
    label: "model.default (config.yaml)",
  },
  {
    source: "config",
    field: "model.base_url",
    label: "model.base_url (config.yaml)",
  },
  {
    source: "config",
    field: "model.api_key",
    label: "model.api_key (config.yaml)",
  },
  {
    source: "config",
    field: "api_server.token",
    label: "api_server.token (config.yaml)",
  },
];

/** True when the field's value should be treated as a secret in
 *  user-facing messages (mask-shown, never quoted in full). */
function isSecretField(label: string): boolean {
  return /API_KEY|TOKEN|api_key|token/.test(label);
}

interface SiblingEnv {
  values: Record<string, string>; // field-or-dotted-path → value
  envFile: string;
  configFile: string;
}

/** Read the curated subset of fields from a sibling hermes-home. */
function readSiblingFields(home: string): SiblingEnv {
  const envFile = join(home, ".env");
  const configFile = join(home, "config.yaml");
  const values: Record<string, string> = {};
  // .env
  let envText = "";
  try {
    if (existsSync(envFile)) envText = readFileSync(envFile, "utf-8");
  } catch {
    /* unreadable distro fs — leave empty */
  }
  const envMap: Record<string, string> = {};
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) envMap[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  // config.yaml
  let configText = "";
  try {
    if (existsSync(configFile)) configText = readFileSync(configFile, "utf-8");
  } catch {
    /* unreadable */
  }
  for (const { source, field } of DRIFT_FIELDS) {
    if (source === "env") {
      values[field] = (envMap[field] ?? "").trim();
    } else {
      // simple dotted-path read against the YAML text — enough for
      // the flat 1- or 2-segment paths we care about
      values[field] = readDottedYaml(configText, field);
    }
  }
  return { values, envFile, configFile };
}

/** Tiny dotted-path YAML reader. Handles the 1- and 2-segment cases
 *  we use here. Returns "" for missing values. Not a general YAML
 *  parser — duplicates a slice of what `getConfigValue` does
 *  internally, but takes a string instead of a profile so we can
 *  point it at sibling files. */
function readDottedYaml(text: string, dotted: string): string {
  const parts = dotted.split(".");
  if (parts.length === 1) {
    const re = new RegExp(`^\\s*${parts[0]}\\s*:\\s*(.+?)\\s*$`, "m");
    const m = text.match(re);
    return m ? m[1].replace(/^["']|["']$/g, "").trim() : "";
  }
  if (parts.length === 2) {
    const blockRe = new RegExp(`^${parts[0]}:\\s*\\n((?:[ \\t]+.*\\n?)*)`, "m");
    const blockM = text.match(blockRe);
    if (!blockM) return "";
    const child = new RegExp(`^[ \\t]+${parts[1]}\\s*:\\s*(.+?)\\s*$`, "m");
    const m = blockM[1].match(child);
    return m ? m[1].replace(/^["']|["']$/g, "").trim() : "";
  }
  return "";
}

/** Current Windows-side fields, read with the same readers so the
 *  comparison is apples-to-apples. */
function readCurrentFields(profile: string | undefined): SiblingEnv {
  // Reuse readSiblingFields by pointing it at the profile home —
  // identical parse logic, so any quirk in our YAML reader applies
  // symmetrically and won't false-flag.
  return readSiblingFields(profilePaths(profile).home);
}

function checkSiblingHermesHomeDrift(profile?: string): ConfigHealthIssue[] {
  const siblings = findSiblingHermesHomes();
  if (siblings.length === 0) return [];

  const current = readCurrentFields(profile);
  const issues: ConfigHealthIssue[] = [];

  for (const sibling of siblings) {
    const siblingFields = readSiblingFields(sibling.hermesHome);

    for (const { field, label } of DRIFT_FIELDS) {
      const winValue = current.values[field] ?? "";
      const wslValue = siblingFields.values[field] ?? "";
      if (winValue === wslValue) continue;

      const isSecret = isSecretField(label);
      const winMasked = isSecret ? maskKey(winValue) : winValue;
      const wslMasked = isSecret ? maskKey(wslValue) : wslValue;
      const where = `${sibling.distro}:/home/${sibling.user}/.hermes`;

      // Direction A: one side empty, the other has a value →
      // unambiguous, auto-fixable. Default direction WSL → Windows
      // (assumption: Hermes Desktop is the broken side, the user's
      // CLI on WSL is the working setup). If reverse direction is
      // ever needed, expose a second fixId.
      if (!winValue && wslValue) {
        issues.push({
          code: "SIBLING_HERMES_HOME_DRIFT",
          severity: "warning",
          message: `${label} is set on WSL (${sibling.distro}) but not on the Windows side that Hermes Desktop reads.`,
          detail:
            `WSL value (${where}): ${wslMasked}\n` +
            `Windows value: (not set)\n\n` +
            `Hermes Desktop reads only ${current.envFile.replace(/\\\.env$/, "")} — your CLI on WSL works, the desktop doesn't, because the value never made it across. Auto-fix copies the WSL value into the Windows-side file.`,
          locations: [current.configFile, current.envFile, sibling.hermesHome],
          autoFixable: true,
          fixDescription: `Copy ${label} from WSL (${sibling.distro}) → Windows side.`,
          fixLocation: ".env",
          context: {
            field,
            distro: sibling.distro,
            user: sibling.user,
            wslHome: sibling.hermesHome,
            direction: "wsl-to-windows",
          },
        });
      } else if (winValue && !wslValue) {
        // Reverse case — Windows has a value but WSL doesn't.
        // Less common (user has the desktop working but the CLI
        // broken). Surface as info, not auto-fixable from here
        // (we don't want to write to WSL silently).
        issues.push({
          code: "SIBLING_HERMES_HOME_DRIFT",
          severity: "info",
          message: `${label} is set on Windows but not on WSL (${sibling.distro}).`,
          detail:
            `Windows value: ${winMasked}\n` +
            `WSL value (${where}): (not set)\n\n` +
            `Hermes Desktop reads the Windows side, so this isn't blocking the desktop. Just a heads-up that your CLI on WSL is missing this value if you also use it there.`,
          locations: [current.envFile, sibling.hermesHome],
          autoFixable: false,
          context: {
            field,
            distro: sibling.distro,
            user: sibling.user,
            direction: "windows-to-wsl",
          },
        });
      } else {
        // Both sides have non-empty values that differ. Could be
        // intentional (separate billing accounts, dev vs prod
        // keys). Surface as info, no auto-fix.
        issues.push({
          code: "SIBLING_HERMES_HOME_DRIFT",
          severity: "info",
          message: `${label} has different values on Windows and WSL (${sibling.distro}).`,
          detail:
            `Windows value: ${winMasked}\n` +
            `WSL value (${where}): ${wslMasked}\n\n` +
            `Hermes Desktop reads only the Windows side. If these were supposed to be the same, copy whichever value is current to the other side. If they're intentionally different, this notice is informational.`,
          locations: [current.envFile, sibling.hermesHome],
          autoFixable: false,
          context: {
            field,
            distro: sibling.distro,
            user: sibling.user,
            direction: "ambiguous",
          },
        });
      }
    }
  }

  return issues;
}

function fixSiblingHermesHomeDrift(
  profile: string | undefined,
  context: Record<string, string> | undefined,
): { ok: boolean; message?: string } {
  const field = context?.field;
  const wslHome = context?.wslHome;
  const direction = context?.direction;
  if (!field || !wslHome) {
    return { ok: false, message: "Missing fix context (field/wslHome)." };
  }
  if (direction !== "wsl-to-windows") {
    return {
      ok: false,
      message:
        "Only WSL → Windows auto-fix is supported. For the reverse direction, edit the WSL file manually.",
    };
  }

  const siblingFields = readSiblingFields(wslHome);
  const value = (siblingFields.values[field] ?? "").trim();
  if (!value) {
    return { ok: false, message: `WSL value for ${field} is empty.` };
  }

  // Dispatch by field source — env vars go through setEnvValue,
  // config.yaml fields through setConfigValue.
  const fieldDef = DRIFT_FIELDS.find((f) => f.field === field);
  if (!fieldDef) {
    return { ok: false, message: `Unknown field ${field}.` };
  }
  try {
    if (fieldDef.source === "env") {
      setEnvValue(field, value, profile);
    } else {
      // config.yaml field. For top-level keys (e.g. `API_SERVER_KEY`)
      // `setConfigValue` handles both update + append. For dotted
      // paths under an existing block (`model.api_key`,
      // `api_server.token`), `setConfigValue` only updates — it
      // refuses to insert a missing leaf to avoid corrupting the
      // file. We DO want to insert here (that's the whole point of
      // the fix), so use `upsertBlockChild` directly for the
      // 2-segment case.
      const segments = field.split(".");
      if (segments.length === 1) {
        setConfigValue(field, value, profile);
      } else if (segments.length === 2) {
        const { configFile } = profilePaths(profile);
        const content = existsSync(configFile)
          ? readFileSync(configFile, "utf-8")
          : "";
        const next = upsertBlockChild(content, segments[0], segments[1], value);
        safeWriteFile(configFile, next);
      } else {
        return {
          ok: false,
          message: `Unsupported config.yaml path depth: ${field}`,
        };
      }
    }
    appendConfigFixLog({
      ts: Date.now(),
      issueCode: "SIBLING_HERMES_HOME_DRIFT",
      action: "autofix",
      from: `wsl:${wslHome}/${fieldDef.source === "env" ? ".env" : "config.yaml"}`,
      to:
        fieldDef.source === "env"
          ? "%LocalAppData%/hermes/.env"
          : "%LocalAppData%/hermes/config.yaml",
      profile: profile || "default",
      valueMasked: isSecretField(fieldDef.label) ? maskKey(value) : value,
      detail: field,
    });
    return {
      ok: true,
      message: `Copied ${field} from WSL to the Windows-side ${fieldDef.source === "env" ? ".env" : "config.yaml"}.`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// Re-export for tests that want to call the check directly without
// going through `runConfigHealthCheck`.
export { checkSiblingHermesHomeDrift, fixSiblingHermesHomeDrift };

// ───────────────────────────────────────────────────────
//  LEGACY_TOOLSET_NAME — `toolsets:` list still has "hermes"
// ───────────────────────────────────────────────────────

/**
 * The bundled hermes-agent CLI renamed its default toolset alias from
 * "hermes" (legacy) to "hermes-cli". Configs written by older versions —
 * either an older bundled engine or a prior standalone hermes CLI install —
 * still reference the legacy name in their top-level `toolsets:` block.
 * The current engine's validator no longer recognises `"hermes"` and
 * prints `Warning: Unknown toolsets: hermes` on every agent invocation
 * (issues #353, fresh #385/Telegram reports).
 *
 * The fix is a one-line YAML rewrite: `- hermes` → `- hermes-cli`. The
 * agent still functions today — it's a cosmetic warning — but it
 * clutters every chat session and looks broken to new users.
 */
function checkLegacyToolsetName(profile?: string): ConfigHealthIssue[] {
  const issues: ConfigHealthIssue[] = [];
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return issues;

  let content: string;
  try {
    content = readFileSync(configFile, "utf-8");
  } catch {
    return issues;
  }

  if (!findLegacyToolsetEntry(content)) return issues;

  issues.push({
    code: "LEGACY_TOOLSET_NAME",
    severity: "warning",
    message:
      'config.yaml references the legacy toolset name "hermes" — the current engine expects "hermes-cli".',
    detail:
      "The bundled hermes-agent CLI renamed the default toolset alias " +
      'from "hermes" to "hermes-cli". The agent still runs, but every ' +
      "invocation prints `Warning: Unknown toolsets: hermes` until the " +
      "entry is updated. Auto-fix rewrites the line in place.",
    locations: [configFile],
    autoFixable: true,
    fixDescription: "Rewrite `- hermes` → `- hermes-cli` in config.yaml.",
    fixLocation: "config.yaml",
  });
  return issues;
}

/**
 * Scan the top-level `toolsets:` block for a literal `- hermes` entry
 * (the legacy alias). Returns true on the first match. Indentation-
 * aware: stops at the first top-level (non-indented) line after the
 * `toolsets:` header. Tolerates quoted forms (`- "hermes"`, `- 'hermes'`)
 * and trailing comments.
 *
 * Does NOT match `hermes-cli` / `hermes-telegram` / `hermes-discord` /
 * etc. — those are the current canonical names and must not be touched.
 */
function findLegacyToolsetEntry(content: string): boolean {
  const lines = content.split("\n");
  let inToolsets = false;
  for (const line of lines) {
    if (/^toolsets\s*:/.test(line)) {
      inToolsets = true;
      continue;
    }
    if (!inToolsets) continue;
    // Exit the block on the next un-indented (top-level) non-empty line
    // that ISN'T a list item. YAML allows `- foo` at zero indent under
    // a parent key (and that's what `hermes setup` actually writes), so
    // a line starting with `-` is still part of the block.
    if (/^[^\s-]/.test(line) && line.trim() !== "") {
      inToolsets = false;
      continue;
    }
    // List item shape: optional whitespace, dash, whitespace, optional
    // quote, NAME, optional matching quote, optional trailing comment.
    // NAME captured tightly so `hermes-cli` doesn't match `hermes`.
    const m = line.match(/^\s*-\s+(["']?)([\w-]+)\1\s*(#.*)?$/);
    if (m && m[2] === "hermes") return true;
  }
  return false;
}

/**
 * Rewrite every `- hermes` entry inside the top-level `toolsets:` block
 * to `- hermes-cli`, preserving indentation, quoting style, and any
 * trailing comment. Re-runs `findLegacyToolsetEntry` on the result so
 * the function is a no-op if there's nothing to fix.
 */
function fixLegacyToolsetName(profile?: string): {
  ok: boolean;
  message?: string;
} {
  try {
    const { configFile } = profilePaths(profile);
    if (!existsSync(configFile)) {
      return { ok: false, message: "config.yaml not found" };
    }
    const original = readFileSync(configFile, "utf-8");
    if (!findLegacyToolsetEntry(original)) {
      return { ok: false, message: "No legacy toolset entry found." };
    }

    const lines = original.split("\n");
    let inToolsets = false;
    let changed = false;
    const out: string[] = [];
    for (const line of lines) {
      if (/^toolsets\s*:/.test(line)) {
        inToolsets = true;
        out.push(line);
        continue;
      }
      if (inToolsets) {
        // Same un-indent-but-not-list-item exit rule as the parser.
        if (/^[^\s-]/.test(line) && line.trim() !== "") {
          inToolsets = false;
          out.push(line);
          continue;
        }
        // Rewrite the legacy entry only — leave hermes-cli et al alone.
        // Accept both zero-indent (`- hermes`) and indented (`  - hermes`).
        const m = line.match(/^(\s*-\s+)(["']?)hermes\2(\s*(?:#.*)?)$/);
        if (m) {
          const prefix = m[1];
          const quote = m[2];
          const suffix = m[3];
          out.push(`${prefix}${quote}hermes-cli${quote}${suffix}`);
          changed = true;
          continue;
        }
      }
      out.push(line);
    }
    if (!changed) {
      // findLegacyToolsetEntry said yes but the rewrite regex missed —
      // shouldn't happen, but fail loudly rather than silently no-op.
      return {
        ok: false,
        message: "Detected legacy entry but rewrite did not match.",
      };
    }
    safeWriteFile(configFile, out.join("\n"));
    appendConfigFixLog({
      ts: Date.now(),
      issueCode: "LEGACY_TOOLSET_NAME",
      action: "autofix",
      from: "hermes",
      to: "hermes-cli",
      profile: profile || "default",
      detail: "toolsets[] entry",
    });
    return {
      ok: true,
      message: "Rewrote `- hermes` → `- hermes-cli` in config.yaml.",
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// Re-export for tests that exercise the check directly.
export { checkLegacyToolsetName, fixLegacyToolsetName };

/**
 * Path to the JSONL audit log of all config fixes. Exposed so the
 * Diagnose UI can offer "Show audit log" without reaching into the
 * filesystem from the renderer.
 */
export function configFixLogPath(): string {
  return join(HERMES_HOME, "logs", "config-fixes.log");
}

/**
 * Read the last N entries of the config-fix audit log. Returns an
 * empty array if the log doesn't exist. Best-effort — JSON parse
 * errors on individual lines are skipped.
 */
export function readConfigFixLog(maxEntries = 50): unknown[] {
  const file = configFixLogPath();
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    const tail = lines.slice(-maxEntries);
    const entries: unknown[] = [];
    for (const line of tail) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
    return entries;
  } catch {
    return [];
  }
}
