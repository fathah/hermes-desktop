import { describe, expect, it } from "vitest";

import { isTransientAuditFailure } from "../scripts/audit-production-dependencies.mjs";

describe("production dependency audit", () => {
  // @lat: [[desktop-updates#Stable and beta release channels#Release security and quality gates#Transient audit outages]]
  it.each([
    "npm warn audit 503 Service Unavailable",
    "npm error audit endpoint returned an error",
    "request failed with ECONNRESET",
    "getaddrinfo EAI_AGAIN registry.npmjs.org",
    "HTTP/1.1 502 Bad Gateway",
    "npm error code E503",
  ])("retries transient registry failures: %s", (message) => {
    expect(isTransientAuditFailure(message)).toBe(true);
  });

  it.each([
    "found 1 high severity vulnerability",
    "found 2 critical severity vulnerabilities",
    "npm audit report: vulnerable dependency",
    "https://github.com/advisories/GHSA-abcd-efgh-n529",
    "https://nvd.nist.gov/vuln/detail/CVE-2026-115570",
  ])("does not retry a reported vulnerability: %s", (message) => {
    expect(isTransientAuditFailure(message)).toBe(false);
  });

  it("does not retry findings containing network-looking advisory text", () => {
    // @lat: [[desktop-updates#Stable and beta release channels#Release security and quality gates#Audit findings take precedence]]
    const report = [
      "npm warn audit 503 Service Unavailable",
      "# npm audit report",
      "electron 44.0.0-alpha.1 - 44.9.0",
      "Severity: high",
      "Example advisory: HTTP 500 and ECONNRESET during request handling",
      "https://nvd.nist.gov/vuln/detail/CVE-2026-115570",
      "2 high severity vulnerabilities",
    ].join("\n");
    expect(isTransientAuditFailure(report)).toBe(false);
  });
});
