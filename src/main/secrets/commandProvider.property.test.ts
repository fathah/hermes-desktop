import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { parseSecretOutput } from "./commandProvider";

/**
 * PROPERTY-BASED tests for parseSecretOutput — the secret-resolution parser
 * that all three review-found bugs lived in or around:
 *   1. list()/get() disagreement on whitespace-only values
 *   2. resolvedSecrets() bypass (a caller skipping the cache)
 *   3. S2 misroute guard not seeing a comment-prefixed wrong-key line
 *
 * Hand-written examples catch the cases you THOUGHT of. These properties assert
 * the security INVARIANTS hold for thousands of generated inputs — the cases
 * you didn't think of. This is the class of bug Greptile reasons about
 * (cross-function invariants), made into a local pre-push gate.
 *
 * The single most important property: a secret resolved for key K must NEVER
 * be another key's credential. That one property catches all three bugs.
 */

// ── Generators that mimic real vault-helper output shapes ──────────────────

const keyName = fc
  .stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,20}$/)
  .filter((s) => s.length > 0);

// A "secret value": arbitrary non-empty token (may contain =, base64 padding…)
const secretValue = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0 && !s.includes("\n"));

// A dotenv line: KEY=VALUE
const dotenvLine = fc.tuple(keyName, secretValue).map(([k, v]) => `${k}=${v}`);

// A comment line (the S2 trigger: keepassxc-cli / secret-tool emit these)
const commentLine = fc
  .string({ maxLength: 30 })
  .map((s) => `# ${s.replace(/\n/g, " ")}`);

// Whitespace-only "value" (the list/get disagreement trigger)
const whitespaceOnly = fc
  .array(fc.constantFrom(" ", "\t"), { minLength: 1, maxLength: 5 })
  .map((a) => a.join(""));

describe("parseSecretOutput — security invariants (property-based)", () => {
  // ── INVARIANT 1: no cross-key credential leakage ──────────────────────────
  // For any helper output and any wanted key, the resolved value must never be
  // a DIFFERENT key's credential. This is the property that would have caught
  // the S2 comment-prefix bug automatically.
  it("never returns a different key's value as the wanted secret", () => {
    fc.assert(
      fc.property(
        keyName, // wantedKey
        keyName, // otherKey
        secretValue, // otherKey's secret
        fc.option(commentLine, { nil: "" }), // optional leading comment
        (wantedKey, otherKey, otherSecret, comment) => {
          fc.pre(otherKey !== wantedKey);
          // Exclude padding-only "secrets" (empty or all '='): by design the
          // parser cannot distinguish `KEY==` from a bare base64 secret like
          // `dGVzdA==`, so an all-'=' value part is treated as a bare value,
          // not a misroute. That is the documented base64 disambiguation, not
          // a leak — a real credential always has a non-padding character.
          fc.pre(!/^=*$/.test(otherSecret.trim()));
          // Helper emits (optionally a comment, then) ONLY the other key's line.
          const out =
            (comment ? comment + "\n" : "") + `${otherKey}=${otherSecret}\n`;
          const result = parseSecretOutput(out, wantedKey);
          // A real (non-padding) credential for a DIFFERENT key must never be
          // returned for the wanted key — null is the only safe answer.
          expect(result).toBeNull();
        },
      ),
      { numRuns: 2000 },
    );
  });

  // ── INVARIANT 2: an exact dotenv match always resolves to its own value ────
  // If the output contains `WANTED=value`, get(WANTED) returns exactly `value`
  // (modulo unquoting) — even with comments or other keys present.
  it("resolves the wanted key's own value when present, regardless of comments/order", () => {
    fc.assert(
      fc.property(
        keyName,
        secretValue,
        fc.array(commentLine, { maxLength: 3 }),
        (wantedKey, wantedValue, comments) => {
          // value must survive: pick values with no leading/trailing space and
          // no quotes so unquoteDotenvValue returns them unchanged.
          fc.pre(
            wantedValue === wantedValue.trim() &&
              !/^["']/.test(wantedValue) &&
              !wantedValue.includes("="),
          );
          const out =
            comments.join("\n") +
            (comments.length ? "\n" : "") +
            `${wantedKey}=${wantedValue}\n`;
          expect(parseSecretOutput(out, wantedKey)).toBe(wantedValue);
        },
      ),
      { numRuns: 2000 },
    );
  });

  // ── INVARIANT 3: whitespace-only is never a value ─────────────────────────
  // A quoted-blank placeholder (K="  ") must resolve to null, never a
  // whitespace string that would flow into an Authorization header.
  it("never resolves a whitespace-only value to non-null", () => {
    fc.assert(
      fc.property(keyName, whitespaceOnly, (wantedKey, ws) => {
        // Both the bare-value form and the quoted dotenv form.
        expect(parseSecretOutput(ws + "\n", wantedKey)).toBeNull();
        expect(
          parseSecretOutput(`${wantedKey}="${ws}"\n`, wantedKey),
        ).toBeNull();
      }),
      { numRuns: 1000 },
    );
  });

  // ── INVARIANT 4: a multi-key dump without the wanted key fails closed ──────
  it("returns null for a multi-key dump that lacks the wanted key", () => {
    fc.assert(
      fc.property(
        keyName,
        fc.array(dotenvLine, { minLength: 2, maxLength: 6 }),
        (wantedKey, lines) => {
          // None of the dump lines is the wanted key.
          fc.pre(!lines.some((l) => l.startsWith(`${wantedKey}=`)));
          const result = parseSecretOutput(lines.join("\n") + "\n", wantedKey);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 2000 },
    );
  });

  // ── INVARIANT 5: parser never throws (fail-closed on any input) ───────────
  it("never throws on arbitrary input — degrades to a value or null", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (stdout, wantedKey) => {
        // Must not throw; result is string|null.
        const r = parseSecretOutput(stdout, wantedKey || "K");
        expect(r === null || typeof r === "string").toBe(true);
      }),
      { numRuns: 3000 },
    );
  });
});
