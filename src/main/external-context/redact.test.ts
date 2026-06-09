import { describe, it, expect } from "vitest";
import { redactExternalText, REDACTED, SECRET_PATTERNS } from "./redact";

describe("redactExternalText — pattern-based", () => {
  it("redacts an Anthropic sk-ant key and never leaks it", () => {
    const fakeKey =
      "" +
      [
        "sk-ant-a",
        "pi03-AbC",
        "dEf01234",
        "56789AbC",
        "dEf01234",
        "56789AbC",
        "dEf01-de",
        "adBEEF",
      ].join("") +
      "";
    const text = `here is the key ${fakeKey} use it`;
    const out = redactExternalText(text);
    expect(out).not.toContain(fakeKey);
    expect(out).not.toContain("sk-ant-api03");
    expect(out).toContain(REDACTED);
  });

  it("redacts generic sk- / sk-or- keys", () => {
    const out = redactExternalText(
      "OPENROUTER=" +
        ["sk-or-v1", "-0123456", "789abcde", "f0123456", "789abcde", "f"].join(
          "",
        ) +
        "",
    );
    expect(out).not.toContain("sk-or-v1-0123456789abcdef");
    expect(out).toContain(REDACTED);
  });

  it("redacts GitHub PATs (classic + fine-grained)", () => {
    const classic =
      "" +
      ["ghp_0123", "456789ab", "cdefABCD", "EF012345", "6789abcd", "ef"].join(
        "",
      ) +
      "";
    const fine =
      "" +
      [
        "github_p",
        "at_11ABC",
        "DEFG0123",
        "456789_a",
        "bcdefABC",
        "DEF01234",
        "56789abc",
        "d",
      ].join("") +
      "";
    const out = redactExternalText(`${classic} and ${fine}`);
    expect(out).not.toContain(classic);
    expect(out).not.toContain(fine);
  });

  it("redacts AWS access keys, Slack tokens and Google API keys", () => {
    const aws = "" + ["AKIAIOSF", "ODNN7EXA", "MPLE"].join("") + "";
    const slack =
      "" +
      [
        "xoxb-123",
        "45678901",
        "2-123456",
        "7890123-",
        "abcdEFGH",
        "ijklMNOP",
        "qrstUVwx",
      ].join("") +
      "";
    const google =
      "" +
      ["AIzaSyA0", "12345678", "9abcdefg", "hijklmno", "pqrstuvw"].join("") +
      "";
    const out = redactExternalText(`${aws} ${slack} ${google}`);
    expect(out).not.toContain(aws);
    expect(out).not.toContain(slack);
    expect(out).not.toContain(google);
  });

  it("redacts JWTs", () => {
    const jwt =
      "" +
      [
        "eyJhbGci",
        "OiJIUzI1",
        "NiIsInR5",
        "cCI6IkpX",
        "VCJ9.eyJ",
        "zdWIiOiI",
        "xMjM0NTY",
        "3ODkwIn0",
        ".dozjgNr",
        "yP4J3jVm",
        "NHl0w5N_",
        "XgL0n3I9",
        "PlFUP0TH",
        "sR8U",
      ].join("") +
      "";
    const out = redactExternalText(jwt);
    expect(out).not.toContain(jwt);
    expect(out).toBe(REDACTED);
  });

  it("redacts PEM private-key blocks", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEArandombase64stuffhere0123456789",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const out = redactExternalText(`secret:\n${pem}\nend`);
    expect(out).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(out).toContain(REDACTED);
  });

  it("redacts the value but keeps the key name in key=value assignments", () => {
    const out = redactExternalText('api_key = "abcd1234efgh5678ijkl"');
    expect(out).toContain("api_key");
    expect(out).not.toContain("abcd1234efgh5678ijkl");
    expect(out).toContain(REDACTED);
  });

  it("leaves benign prose untouched", () => {
    const text =
      "We decided to use Postgres and refactor the auth module next week.";
    expect(redactExternalText(text)).toBe(text);
  });
});

describe("redactExternalText — known secrets", () => {
  it("redacts an exact app-held secret over 8 chars", () => {
    const secret = "supersecretvalue-123456";
    const out = redactExternalText(`the remote key is ${secret}.`, [secret]);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it("ignores short known secrets to avoid trashing the text", () => {
    const out = redactExternalText("the cat sat on the mat", ["cat"]);
    expect(out).toBe("the cat sat on the mat");
  });
});

describe("redactExternalText — edge cases", () => {
  it("returns empty / non-string input unchanged", () => {
    expect(redactExternalText("")).toBe("");
    // @ts-expect-error deliberately testing a bad input
    expect(redactExternalText(null)).toBe(null);
  });

  it("exposes a non-empty pattern list", () => {
    expect(SECRET_PATTERNS.length).toBeGreaterThan(5);
  });
});
