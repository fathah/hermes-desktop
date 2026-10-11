import { describe, expect, it } from "vitest";

import { isTransientAuditFailure } from "../scripts/audit-production-dependencies.mjs";

describe("production dependency audit", () => {
  // @lat: [[desktop-updates#Stable and beta release channels#Release security and quality gates#Transient audit outages]]
  it.each([
    "npm warn audit 503 Service Unavailable",
    "npm error audit endpoint returned an error",
    "request failed with ECONNRESET",
    "getaddrinfo EAI_AGAIN registry.npmjs.org",
  ])("retries transient registry failures: %s", (message) => {
    expect(isTransientAuditFailure(message)).toBe(true);
  });

  it.each([
    "found 1 high severity vulnerability",
    "found 2 critical severity vulnerabilities",
    "npm audit report: vulnerable dependency",
  ])("does not retry a reported vulnerability: %s", (message) => {
    expect(isTransientAuditFailure(message)).toBe(false);
  });
});
