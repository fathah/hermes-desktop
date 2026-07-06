import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "child_process";
import type { SecretsProvider } from "./provider";
import { getConfigValue } from "../config";

/**
 * Hard cap so a hung helper can never wedge a turn. Kept deliberately TIGHT (3s)
 * because resolution runs synchronously on the Electron MAIN process: a slow or
 * blocking helper freezes the UI for up to this duration. A configured `command`
 * helper MUST therefore be fast and NON-INTERACTIVE (e.g. `keepassxc-cli` against
 * an already-unlocked DB, `secret-tool lookup`, or `cat`-ing a tmpfs env file) —
 * NOT a helper that prompts for a touch/PIN at gateway-spawn time.
 *
 * FUTURE (durable fix, design (a)): make the SecretsProvider interface async
 * (`Promise<string | null>`) using `execFile` so a slow helper never blocks the
 * main process, lifting this constraint. Deferred because the async ripple
 * reaches `buildGatewayEnv` -> `startGatewayDetailed` (a sync exported fn) and
 * its callers in the gateway-lifecycle path; the blast radius exceeded the
 * benefit for an opt-in provider. See WORKFLOW.md / the secrets-provider review.
 */
const COMMAND_TIMEOUT_MS = 3_000;
/** Defensive cap on helper output (1 MiB) — a misbehaving command can't OOM us. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Strip a single layer of matching surrounding quotes from a dotenv value.
 * Requires length >= 2 so a lone quote (`"`) is left intact rather than
 * collapsing to empty, and `""`/`''` correctly yield an empty string. Shared by
 * the single-key parser and list() so both unquote identically.
 */
export function unquoteDotenvValue(raw: string): string {
  const t = raw.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Parse a `secret-fetch` command's stdout. Supports BOTH shapes (design (c)):
 *   - a bare value (single secret): the whole trimmed stdout is the value.
 *   - a dotenv blob (KEY=VALUE lines): when stdout has '=' lines, parse them and
 *     return the entry for `wantedKey`. This maps directly onto a vault that
 *     dumps an env file (mumbo's tmpfs workflow) as well as a per-key helper.
 *
 * A line is treated as a KEY=VALUE pair only when it matches an env-key shape
 * before the '='; otherwise the output is taken as a bare value.
 */
export function parseSecretOutput(
  stdout: string,
  wantedKey: string,
): string | null {
  const text = stdout.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

  // 1. Exact dotenv match wins: scan for a `wantedKey=...` line. This is
  //    deterministic and never returns another key's value.
  const dotenvLines = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && ENV_LINE.test(l));
  for (const line of dotenvLines) {
    const m = line.match(ENV_LINE)!;
    if (m[1] === wantedKey) {
      const value = unquoteDotenvValue(m[2]);
      // Whitespace-only (e.g. a quoted `K="  "` placeholder) is "no value":
      // it would otherwise flow into an Authorization header → guaranteed 401.
      return value.trim() !== "" ? value : null;
    }
  }

  // 2. The output is a multi-key dotenv dump that does NOT contain the wanted
  //    key → null, rather than mis-returning an unrelated line as a bare value.
  //    Only ≥2 env-shaped lines count as a dump: a SINGLE non-matching
  //    env-shaped line falls through to the bare-value branch, because a bare
  //    secret can itself match the KEY=VALUE shape (e.g. base64 with '='
  //    padding, "dGVzdA==") and must not be misclassified as a dump.
  if (dotenvLines.length > 1) return null;

  // 3. Otherwise treat the whole output as a single bare value (a per-key
  //    helper that printed just the secret). Trim first so whitespace-only
  //    output (a ' '/'\t' placeholder entry) resolves to null, never a "key".
  const value = text.trim();
  if (value === "") return null;

  // SECURITY (S2): a single env-shaped line for a DIFFERENT key must not be
  // returned as the wanted secret. A sloppy helper (e.g. `head -1 env-file`,
  // or a grep that matched the wrong line) emitting `OTHER_KEY=realvalue`
  // would otherwise flow — key name, '=' and the OTHER key's value — into an
  // Authorization header sent to the WANTED key's endpoint: cross-provider
  // credential leakage, not just a 401. Disambiguation from a bare base64
  // secret: base64 padding only ever produces an env-shaped line whose
  // "value" part is empty or all '=' (`dGVzdA==` → key `dGVzdA`, value `=`),
  // so a non-trivial value part after a non-matching key means a misrouted
  // dotenv entry → resolve null. (A bare secret that itself contains '=' with
  // a non-padding tail, e.g. `user=password`, is rejected by this rule —
  // such helpers must emit a dotenv line for the wanted key instead.)
  //
  // Test the EXTRACTED dotenv line, not the full output: `value` is the whole
  // trimmed stdout, which may begin with a comment (keepassxc-cli / secret-tool
  // emit a header line). A leading `#` makes `value.match(ENV_LINE)` (anchored
  // at ^, no multiline flag) return null, silently bypassing this guard and
  // leaking the comment+wrong-key line as the bare value. When exactly one
  // dotenv line was extracted (comments already stripped), check that line.
  const s2Target = dotenvLines.length === 1 ? dotenvLines[0] : value;
  const envShaped = s2Target.match(ENV_LINE);
  if (
    envShaped &&
    envShaped[1] !== wantedKey &&
    !/^=*$/.test(envShaped[2].trim())
  ) {
    return null;
  }
  return value;
}

/**
 * `command` secrets provider — resolves a secret by running a user-configured
 * helper command (e.g. `keepassxc-cli`, `secret-tool`, or a script that cats a
 * tmpfs env file). The command comes from `secrets.command` in config.yaml.
 *
 * Security model:
 *   - The command string is the USER'S OWN configuration (same trust level as
 *     the `.env` file they control), so it is run via `sh -c <command>`.
 *   - The requested key is passed to the child ONLY via the `HERMES_SECRET_KEY`
 *     environment variable — it is NEVER interpolated into the shell string, so
 *     a hostile key name (e.g. `"; rm -rf ~`) is inert data, not code.
 *   - Hard timeout + output cap; any failure (non-zero exit, timeout, empty)
 *     resolves to null rather than throwing.
 *   - Resolved values are never logged or written to disk.
 *   - The helper inherits the current process environment (so it can find PATH,
 *     HOME, DISPLAY, etc.) plus `HERMES_SECRET_KEY`. That means a helper can see
 *     secrets already present in the environment — acceptable because the helper
 *     is the user's own configured binary, but noted so the trust scope is explicit.
 *   - Used only for targeted single-key resolution and `list()` (which runs the
 *     helper at most once); it is NEVER called per-key in a loop, so a helper
 *     that blocks (e.g. on a vault unlock prompt) can't be spawned dozens of
 *     times for one message.
 *   - PLATFORM: resolution runs the helper via `/bin/sh -c`, so the `command`
 *     provider is POSIX-only (Linux/macOS). On Windows there is no `/bin/sh`;
 *     the helper would fail to spawn and every key degrades to null (logged).
 *     This is acceptable because the feature targets the vault/tmpfs workflow on
 *     Linux; Windows users stay on the default `env` provider. A future change
 *     could detect the platform and use `cmd /c`/PowerShell, but that is out of
 *     scope for this opt-in provider.
 */
/**
 * Spawn options shared by get() and list() — exported so the F6 regression
 * test can pin the stdio contract at the options layer (an inherited stderr
 * bypasses any in-process JS spy, so it can't be observed behaviorally).
 */
export function helperExecOptions(
  secretKey: string,
): ExecFileSyncOptionsWithStringEncoding {
  return {
    // Key passed as DATA via env — never interpolated into the command.
    env: { ...process.env, HERMES_SECRET_KEY: secretKey },
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    encoding: "utf-8",
    // F6: execFileSync's default stdio inherits stderr, streaming the helper's
    // diagnostics (which can carry secret material) straight into the Electron
    // main process's stderr. Pipe it instead and discard.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };
}

export class CommandSecretsProvider implements SecretsProvider {
  readonly id = "command";

  private command(profile?: string): string | null {
    const cmd = getConfigValue("secrets.command", profile);
    return cmd && cmd.trim() !== "" ? cmd : null;
  }

  get(key: string, profile?: string): string | null {
    const command = this.command(profile);
    if (!command) return null;
    try {
      const stdout = execFileSync(
        "/bin/sh",
        ["-c", command],
        helperExecOptions(key),
      );
      return parseSecretOutput(stdout, key);
    } catch (err) {
      // Non-zero exit, timeout, spawn failure — degrade to "no value". Log
      // ONLY structured fields (errno / exit status / signal), never
      // err.message: for execFileSync a non-zero exit embeds the full command
      // string and the helper's entire stderr in the message, either of which
      // can carry secret material.
      const e = err as NodeJS.ErrnoException & {
        status?: number;
        signal?: string;
      };
      console.warn(
        `[secrets:command] get(${key}) failed; resolving null: code=${e.code ?? e.status ?? "?"} signal=${e.signal ?? "none"}`,
      );
      return null;
    }
  }

  /**
   * Enumeration is not generally possible for a per-key helper, so this returns
   * the dotenv map ONLY when the helper (run once with no specific key) emits a
   * KEY=VALUE blob. A bare-value helper returns `{}` — `get()` still resolves
   * individual keys.
   */
  list(profile?: string): Record<string, string> {
    const command = this.command(profile);
    if (!command) return {};
    try {
      const stdout = execFileSync(
        "/bin/sh",
        ["-c", command],
        helperExecOptions(""),
      );
      const out: Record<string, string> = {};
      const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
      for (const raw of stdout.replace(/\r\n/g, "\n").split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const m = line.match(ENV_LINE);
        if (!m) continue;
        const value = unquoteDotenvValue(m[2]);
        // Whitespace-only entries (e.g. a quoted `K="  "` placeholder) are
        // "no value" — get()/parseSecretOutput already resolves them to null,
        // so list() must omit them too or the two disagree on whether a key
        // is configured (a quoted-blank vault entry would otherwise show as a
        // set key here but resolve empty on read).
        if (value.trim() === "") continue;
        out[m[1]] = value;
      }
      return out;
    } catch (err) {
      // Same rule as get(): structured fields only, never err.message (it
      // embeds the command string and the helper's stderr).
      const e = err as NodeJS.ErrnoException & {
        status?: number;
        signal?: string;
      };
      console.warn(
        `[secrets:command] list() failed; resolving {}: code=${e.code ?? e.status ?? "?"} signal=${e.signal ?? "none"}`,
      );
      return {};
    }
  }
}
